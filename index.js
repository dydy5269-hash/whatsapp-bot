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

async function sendList(to, bodyText, options) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: bodyText },
        action: {
          button: "اختيار",
          sections: [
            {
              title: "القائمة",
              rows: options.map(o => ({
                id: o.id,
                title: o.title
              }))
            }
          ]
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

    if (msg.type === "text") {
      text = msg.text.body;
    } else if (msg.type === "interactive") {
      if (msg.interactive?.button_reply?.id) {
        text = msg.interactive.button_reply.id;
      } else if (msg.interactive?.list_reply?.id) {
        text = msg.interactive.list_reply.id;
      }
    }

    console.log("TEXT:", text);
    console.log("STATE:", userState[from]);

    // ===== START =====
    if (!userState[from] || text === "مرحبا") {
      userState[from] = "main";

      const services = await getServices();

      await sendList(
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
    if (userState[from] === "main") {
      const services = await getServices();

      let service =
        services.find(s => text === "service_" + s.id) ||
        services.find(s => text === s.name);

      if (!service) return res.sendStatus(200);

      userData[from] = {
        serviceName: service.name,
        types: service.types
      };

      userState[from] = "type";

      await sendList(
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
    if (userState[from] === "type") {
      const id = text.replace("type_", "");

      const type = userData[from].types.find(t => t.id === id);

      if (!type) {
        await sendMessage(from, "❌ اختيار غير صحيح");
        return res.sendStatus(200);
      }

      userData[from].type = type;
      userState[from] = "confirm";

      await sendList(
        from,
        `🧾 ${type.name}\n💰 ${type.price} ريال`,
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
        userState[from] = "main";
        await sendMessage(from, "❌ تم الإلغاء");
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

      await sendMessage(from, "🚀 تم إرسال الطلب");
      userState[from] = "done";

      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.log(err.response?.data || err);
    return res.sendStatus(200);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running...");
});