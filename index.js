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
          buttons: buttons.slice(0, 3).map(btn => ({
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
async function findAvailableTech(service) {
  const snap = await db
    .collection("technicians")
    .where("service", "==", service)
    .where("active", "==", true)
    .get();

  if (snap.empty) return null;

  return snap.docs[0].data();
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
    else if (msg.type === "interactive") {
      if (msg.interactive?.button_reply) {
        text = msg.interactive.button_reply.id;
      } else if (msg.interactive?.list_reply) {
        text = msg.interactive.list_reply.id;
      }
    }

    // ===== START =====
    if (!userState[from] || text === "مرحبا") {
      userState[from] = "main_menu";

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

    // ===== SELECT SERVICE =====
    if (userState[from] === "main_menu" && text.startsWith("service_")) {
      const id = text.replace("service_", "");
      const doc = await db.collection("services").doc(id).get();

      if (!doc.exists) {
        await sendMessage(from, "❌ الخدمة غير موجودة");
        return res.sendStatus(200);
      }

      const service = doc.data();

      if (!service.types || !Array.isArray(service.types)) {
        await sendMessage(from, "❌ لا توجد أنواع");
        return res.sendStatus(200);
      }

      userData[from] = {
        serviceName: service.name,
        types: service.types
      };

      userState[from] = "type";

      await sendButtons(
        from,
        `⚡ ${service.name}\nاختر النوع:`,
        service.types.map(t => ({
          id: "type_" + t.id,
          title: `${t.name} - ${t.price} ريال`
        }))
      );

      return res.sendStatus(200);
    }

    // ===== SELECT TYPE =====
    if (userState[from] === "type" && text.startsWith("type_")) {
      const id = text.replace("type_", "");

      const type = userData[from].types.find(t => t.id === id);

      if (!type) {
        await sendMessage(from, "❌ اختيار غير صحيح");
        return res.sendStatus(200);
      }

      userData[from].type = type;
      userState[from] = "confirm";

      await sendButtons(
        from,
        `🧾 ${type.name} ${userData[from].serviceName}\n💰 ${type.price} ريال`,
        [
          { id: "confirm", title: "✅ تأكيد" },
          { id: "cancel", title: "❌ إلغاء" }
        ]
      );

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

      const tech = await findAvailableTech(userData[from].serviceName);

      if (!tech) {
        await sendMessage(from, "🚫 لا يوجد فني");
        return res.sendStatus(200);
      }

      await sendMessage(from, "🚀 تم إرسال الطلب");

      userState[from] = "waiting";

      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  } catch (e) {
    console.log(e);
    return res.sendStatus(200);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running...");
});