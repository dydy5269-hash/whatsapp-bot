import express from "express";
import axios from "axios";
import admin from "firebase-admin";

const app = express();
app.use(express.json());

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY))
});
const db = admin.firestore();

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const userState = {};
const userData = {};

function normalizePhone(phone) {
  return phone.replace("+", "");
}

// ---------- SEND ----------
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

    // ===== START =====
    if (!userState[from] || text === "مرحبا") {
      userState[from] = "main_menu";

      const services = await getServices();

      await sendMessage(from, "👋 مرحباً بكم في *شركة رؤية طاقة* ⚡");

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
      const serviceId = text.replace("service_", "");

      const doc = await db.collection("services").doc(serviceId).get();
      const service = doc.data();

      userData[from] = {
        serviceId,
        serviceName: service.name,
        types: service.types
      };

      userState[from] = "service_type";

      await sendMessage(from, `⚡ قسم ${service.name}`);

      await sendButtons(
        from,
        "اختر نوع الخدمة:",
        service.types.map(t => ({
          id: "type_" + t.id,
          title: `${t.name} - ${t.price} ريال`
        }))
      );

      return res.sendStatus(200);
    }

    // ===== SELECT TYPE =====
    if (userState[from] === "service_type" && text.startsWith("type_")) {
      const typeId = text.replace("type_", "");

      const type = userData[from].types.find(t => t.id === typeId);

      userData[from].type = type;

      userState[from] = "confirm";

      await sendMessage(
        from,
        `🧾 تفاصيل الطلب

🔧 ${type.name} ${userData[from].serviceName}
💰 السعر: ${type.price} ريال`
      );

      await sendButtons(from, "تأكيد الطلب:", [
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

    return res.sendStatus(200);
  } catch (e) {
    console.log(e);
    return res.sendStatus(200);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running...");
});