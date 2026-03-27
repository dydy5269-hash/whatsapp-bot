import express from "express";
import axios from "axios";
import admin from "firebase-admin";

const app = express();
app.use(express.json());

// ---------- FIREBASE ----------
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY))
});
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
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

async function sendButtons(to, bodyText, buttons) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText },
        action: {
          buttons: buttons.map(btn => ({
            type: "reply",
            reply: { id: btn.id, title: btn.title }
          }))
        }
      }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

// ---------- SERVICES ----------
async function getServices() {
  const snap = await db.collection("services").get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// ---------- TECH ----------
async function getTechnician(phone) {
  const p = normalizePhone(phone);
  const snap = await db
    .collection("technicians")
    .where("phone", "in", [p, "+" + p])
    .get();

  if (!snap.empty) return snap.docs[0].data();
  return null;
}

async function findAvailableTech(service) {
  const snap = await db
    .collection("technicians")
    .where("service", "==", service)
    .where("active", "==", true)
    .get();

  if (snap.empty) return null;

  const techs = snap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(t => (t.balance || 0) >= 1);

  return techs.length ? techs[0] : null;
}

// ---------- VERIFY ----------
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.send(req.query["hub.challenge"]);
  }
  return res.sendStatus(403);
});

// ---------- WEBHOOK ----------
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = normalizePhone(msg.from);

    let text = "";
    if (msg.type === "text") text = msg.text?.body;
    else if (msg.type === "interactive")
      text = msg.interactive?.button_reply?.id;

    // ===== TECH ACCEPT =====
    if (userState[from] === "tech_reply") {
      const data = userData[from];
      const clientPhone = data.client.phone;
      const tech = data.tech;
      const location = data.location;

      if (text === "accept") {
        await sendMessage(
          clientPhone,
          `🚀 تم تأكيد طلبك

👨‍🔧 الفني: ${tech.name}
📞 ${tech.phone}
⭐ ${tech.rating}`
        );

        await sendMessage(
          tech.phone,
          `📥 تفاصيل الطلب

👤 ${clientPhone}
🔧 ${data.service}
💰 ${data.price} ريال
📍 https://maps.google.com/?q=${location.latitude},${location.longitude}`
        );

        await sendButtons(tech.phone, "اختر الحالة:", [
          { id: "on_way", title: "🚗 في الطريق" },
          { id: "arrived", title: "📍 وصلت" },
          { id: "finish", title: "✅ إنهاء الخدمة" }
        ]);

        userState[from] = "working";
        userState[clientPhone] = "waiting";
      }

      if (text === "reject") {
        await sendMessage(clientPhone, "❌ تم رفض الطلب");
        userState[from] = null;
      }

      return res.sendStatus(200);
    }

    // ===== STATUS =====
    if (userState[from] === "working") {
      const data = userData[from];
      const clientPhone = data.client.phone;

      if (text === "on_way") {
        await sendMessage(clientPhone, "🚗 الفني في الطريق");
      }

      if (text === "arrived") {
        await sendMessage(clientPhone, "📍 الفني وصل");
      }

      if (text === "finish") {
        const tech = data.tech;
        const price = data.price;
        const commission = price * 0.15;

        const snap = await db
          .collection("technicians")
          .where("phone", "in", [tech.phone, "+" + tech.phone])
          .get();

        if (!snap.empty) {
          const doc = snap.docs[0];
          const t = doc.data();

          let newBalance = (t.balance || 0) - commission;

          await doc.ref.update({ balance: newBalance });

          if (newBalance < 2 && newBalance >= 1) {
            await sendMessage(
              tech.phone,
              `⚠️ رصيدك منخفض (${newBalance.toFixed(2)} ريال)`
            );
          }

          if (newBalance < 1) {
            await doc.ref.update({ active: false });

            await sendMessage(
              tech.phone,
              `⛔ تم إيقاف حسابك (${newBalance.toFixed(2)} ريال)`
            );
          }
        }

        await sendMessage(
          clientPhone,
          `✅ تم إنهاء الخدمة

⭐ قيم الخدمة من 1 إلى 5`
        );

        userState[clientPhone] = "rating";
        userState[from] = null;
      }

      return res.sendStatus(200);
    }

    // ===== RATING =====
    if (userState[from] === "rating") {
      await sendMessage(from, "💙 شكراً لتقييمك");
      userState[from] = "main_menu";
      return res.sendStatus(200);
    }

    // ===== CHECK TECH =====
    const tech = await getTechnician(from);

    if (tech && !userState[from]) {
      userState[from] = "tech_menu";

      await sendMessage(
        tech.phone,
        `👨‍🔧 حسابك

👤 ${tech.name}
🔧 ${tech.service}
⭐ ${tech.rating}
💰 ${tech.balance || 0} ريال`
      );

      return res.sendStatus(200);
    }

    // ===== START =====
    if (!userState[from] || text === "مرحبا") {
      userState[from] = "main_menu";

      const services = await getServices();

      await sendMessage(from, "👋 مرحباً بكم في *رؤية طاقة* ⚡");

      await sendButtons(
        from,
        "اختر الخدمة:",
        services.map(s => ({
          id: "service_" + s.id,
          title: s.name
        }))
      );

      return res.sendStatus(200);
    }

    // ===== SELECT SERVICE =====
    if (userState[from] === "main_menu" && text.startsWith("service_")) {
      const id = text.replace("service_", "");
      const doc = await db.collection("services").doc(id).get();
      const service = doc.data();

      userData[from] = {
        serviceName: service.name,
        types: service.types
      };

      userState[from] = "type";

      await sendButtons(
        from,
        "اختر النوع:",
        service.types.map(t => ({
          id: "type_" + t.id,
          title: `${t.name} - ${t.price} ريال`
        }))
      );

      return res.sendStatus(200);
    }

    // ===== TYPE =====
    if (userState[from] === "type" && text.startsWith("type_")) {
      const id = text.replace("type_", "");
      const type = userData[from].types.find(t => t.id === id);

      userData[from].type = type;
      userState[from] = "confirm";

      await sendMessage(
        from,
        `🧾 ${type.name} ${userData[from].serviceName}
💰 ${type.price} ريال`
      );

      await sendButtons(from, "تأكيد:", [
        { id: "confirm", title: "✅ تأكيد" },
        { id: "cancel", title: "❌ إلغاء" }
      ]);

      return res.sendStatus(200);
    }

    // ===== CONFIRM =====
    if (userState[from] === "confirm") {
      if (text === "cancel") {
        userState[from] = "main_menu";
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

      userData[from].location = msg.location;

      const tech = await findAvailableTech(userData[from].serviceName);

      if (!tech) {
        await sendMessage(from, "🚫 لا يوجد فني");
        return res.sendStatus(200);
      }

      const techPhone = normalizePhone(tech.phone);

      await sendMessage(
        tech.phone,
        `📥 طلب جديد

👤 ${from}
🔧 ${userData[from].type.name} ${userData[from].serviceName}
💰 ${userData[from].type.price} ريال`
      );

      await sendButtons(tech.phone, "اختر:", [
        { id: "accept", title: "✅ قبول" },
        { id: "reject", title: "❌ رفض" }
      ]);

      userData[techPhone] = {
        client: { phone: from },
        tech,
        service: `${userData[from].type.name} ${userData[from].serviceName}`,
        price: userData[from].type.price,
        location: msg.location
      };

      userState[techPhone] = "tech_reply";

      await sendMessage(from, "🚀 تم إرسال الطلب");
      userState[from] = null;

      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  } catch (e) {
    console.log(e);
    return res.sendStatus(200);
  }
});

// ---------- START ----------
app.listen(process.env.PORT || 3000, () => {
  console.log("Server running...");
});