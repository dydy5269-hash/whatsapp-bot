import express from "express";
import axios from "axios";
import admin from "firebase-admin";

const app = express();
app.use(express.json());

// ---------- FIREBASE ----------
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY))
  });
}
const db = admin.firestore();

// ---------- ENV ----------
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// ---------- STATE ----------
const userState = {};
const userData = {};

// ---------- HELPERS ----------
function normalizePhone(phone) {
  return phone.replace("+", "");
}

async function sendMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        text: { body: text }
      },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
  } catch (e) {
    console.log(e.response?.data || e.message);
  }
}

async function sendButtons(to, text, buttons) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text },
        action: {
          buttons: buttons.slice(0, 3).map(b => ({
            type: "reply",
            reply: { id: b.id, title: b.title }
          }))
        }
      }
    },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
}

// ---------- SERVICES ----------
async function getServices() {
  const snap = await db.collection("services").get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ---------- TECH ----------
async function findAvailableTech(service) {
  const snap = await db
    .collection("technicians")
    .where("service", "==", service)
    .where("active", "==", true)
    .get();

  if (snap.empty) return null;

  return snap.docs[0];
}

// ---------- VERIFY ----------
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

// ---------- WEBHOOK ----------
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = normalizePhone(msg.from);

    let text = "";
    if (msg.type === "text") text = msg.text.body;
    else if (msg.type === "interactive") {
      text =
        msg.interactive.button_reply?.id ||
        msg.interactive.list_reply?.id ||
        msg.interactive.list_reply?.title;
    }

    // ===== TECH ACCEPT / REJECT =====
    if (userState[from] === "tech_reply") {
      const data = userData[from];

      if (text === "accept") {
        await sendMessage(
          data.client,
          `✅ تم قبول طلبك\n👨‍🔧 الفني: ${data.tech.name}\n📞 ${data.tech.phone}`
        );

        await sendButtons(from, "اختر الحالة:", [
          { id: "on_way", title: "🚗 في الطريق" },
          { id: "arrived", title: "📍 وصلت" },
          { id: "finish", title: "✅ إنهاء الخدمة" }
        ]);

        userState[from] = "working";
        userState[data.client] = "waiting";
      }

      if (text === "reject") {
        await sendMessage(data.client, "❌ تم رفض الطلب");
        userState[from] = null;
      }

      return res.sendStatus(200);
    }

    // ===== TECH STATUS =====
    if (userState[from] === "working") {
      const data = userData[from];

      if (text === "on_way") {
        await sendMessage(data.client, "🚗 الفني في الطريق");
      }

      if (text === "arrived") {
        await sendMessage(data.client, "📍 الفني وصل");
      }

      if (text === "finish") {
        const commission = data.price * 0.15;

        await data.techRef.update({
          balance: admin.firestore.FieldValue.increment(-commission)
        });

        const updated = (await data.techRef.get()).data();

        if (updated.balance < 2 && updated.balance >= 1) {
          await sendMessage(from, "⚠️ رصيدك منخفض");
        }

        if (updated.balance < 1) {
          await data.techRef.update({ active: false });
          await sendMessage(from, "⛔ تم إيقاف حسابك");
        }

        await sendMessage(data.client, "🎉 تم إنهاء الخدمة");

        userState[from] = null;
        userState[data.client] = "rating";
      }

      return res.sendStatus(200);
    }

    // ===== RATING =====
    if (userState[from] === "rating") {
      await sendMessage(from, "💙 شكراً لتقييمك");
      userState[from] = null;
      return res.sendStatus(200);
    }

    // ===== START =====
    if (!userState[from] || text === "مرحبا") {
      userState[from] = "main";

      const services = await getServices();

      await sendButtons(
        from,
        "👋 مرحباً\nاختر الخدمة:",
        services.map(s => ({
          id: "service_" + s.id,
          title: s.name
        }))
      );

      return res.sendStatus(200);
    }

    // ===== SERVICE =====
    if (userState[from] === "main") {
      const services = await getServices();
      const service = services.find(
        s => text === "service_" + s.id || text === s.name
      );

      if (!service) return res.sendStatus(200);

      userData[from] = {
        serviceName: service.name,
        types: service.types
      };

      userState[from] = "type";

      await sendButtons(
        from,
        `⚡ ${service.name}`,
        service.types.map((t, i) => ({
          id: "type_" + i,
          title: t.name
        }))
      );

      return res.sendStatus(200);
    }

    // ===== TYPE =====
    if (userState[from] === "type") {
      const index = parseInt(text.replace("type_", ""));
      const type = userData[from].types[index];

      if (!type) return res.sendStatus(200);

      userData[from].selectedType = type;
      userState[from] = "confirm";

      await sendButtons(
        from,
        `🧾 ${type.name}\n💰 ${type.price} ريال`,
        [
          { id: "confirm", title: "تأكيد" },
          { id: "cancel", title: "إلغاء" }
        ]
      );

      return res.sendStatus(200);
    }

    // ===== CONFIRM =====
    if (userState[from] === "confirm") {
      if (text === "cancel") {
        userState[from] = null;
        return res.sendStatus(200);
      }

      if (text === "confirm") {
        userState[from] = "location";
        await sendMessage(from, "📍 أرسل موقعك");
      }

      return res.sendStatus(200);
    }

    // ===== LOCATION =====
    if (userState[from] === "location") {
      if (!msg.location) {
        await sendMessage(from, "📍 أرسل الموقع");
        return res.sendStatus(200);
      }

      const techDoc = await findAvailableTech(userData[from].serviceName);

      if (!techDoc) {
        await sendMessage(from, "🚫 لا يوجد فني");
        return res.sendStatus(200);
      }

      const tech = techDoc.data();

      await sendMessage(
        tech.phone,
        `📥 طلب جديد\n👤 ${from}\n🔧 ${userData[from].selectedType.name}`
      );

      await sendButtons(tech.phone, "قبول الطلب:", [
        { id: "accept", title: "قبول" },
        { id: "reject", title: "رفض" }
      ]);

      userData[tech.phone] = {
        client: from,
        tech,
        techRef: techDoc.ref,
        price: userData[from].selectedType.price
      };

      userState[tech.phone] = "tech_reply";
      userState[from] = "waiting";

      await sendMessage(from, "🚀 تم إرسال الطلب");

      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  } catch (e) {
    console.log(e);
    return res.sendStatus(200);
  }
});

app.listen(process.env.PORT || 3000, () =>
  console.log("Server running...")
);