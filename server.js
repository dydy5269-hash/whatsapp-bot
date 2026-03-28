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

// ---------- CONFIG ----------
const COMMISSION = 0.2;

// ---------- STATE ----------
const userState = {};
const userData = {};

// ---------- SAFE HELPERS ----------
function safeText(text) {
  if (!text) return "غير محدد";
  return text.toString().substring(0, 24);
}

function safePrice(price) {
  return price ? price : 0;
}

function normalizePhone(phone) {
  return phone.replace("+", "");
}

// ---------- SEND ----------
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
  } catch (err) {
    console.error("sendMessage:", err.response?.data || err.message);
  }
}

async function sendList(to, body, button, rows) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: body },
          action: {
            button,
            sections: [{ title: "القائمة", rows }]
          }
        }
      },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
  } catch (err) {
    console.error("sendList:", err.response?.data || err.message);
  }
}

// ---------- DATA ----------
async function getServices() {
  const snap = await db.collection("services").get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function getTech(serviceId) {
  const snap = await db
    .collection("technicians")
    .where("available", "==", true)
    .get();

  const techs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return techs.find(t => (t.services || []).includes(serviceId));
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

    if (msg.type === "text") text = msg.text.body.trim();
    else if (msg.type === "interactive") {
      text =
        msg.interactive?.list_reply?.id ||
        msg.interactive?.button_reply?.id ||
        "";
    }

    console.log("STATE:", userState[from], "TEXT:", text);

    // ===== START =====
    if (!userState[from] || text === "مرحبا" || text === "0") {
      userState[from] = "main";

      const services = await getServices();

      const rows = services.map(s => ({
        id: `service_${s.id}`,
        title: safeText(s.name)
      }));

      await sendList(from, "👋 اختر الخدمة:", "الخدمات", rows);
      return res.sendStatus(200);
    }

    // ===== SERVICE =====
    if (userState[from] === "main") {
      const services = await getServices();
      const id = text.replace("service_", "");

      const service = services.find(s => s.id === id);

      if (!service) {
        await sendMessage(from, "❌ اختيار غير صحيح");
        return res.sendStatus(200);
      }

      userData[from] = service;
      userState[from] = "type";

      const rows = (service.types || []).map((t, i) => ({
        id: `type_${i}`,
        title: safeText(t.name),
        description: `${safePrice(t.price)} ريال`
      }));

      await sendList(from, "⚡ اختر النوع:", "الأنواع", rows);
      return res.sendStatus(200);
    }

    // ===== TYPE =====
    if (userState[from] === "type") {
      const index = parseInt(text.replace("type_", ""));
      const type = userData[from]?.types?.[index];

      if (!type) {
        await sendMessage(from, "❌ اختيار غير صحيح");
        return res.sendStatus(200);
      }

      userData[from].selectedType = type;
      userState[from] = "confirm";

        await sendList(
         from,
  `🧾 تفاصيل الطلب:      

الخدمة: ${safeText(userData[from].name)}
النوع: ${safeText(type.name)}
السعر: ${safePrice(type.price)} ريال

هل تود المتابعة؟`,
  "تأكيد",
  [
    { id: "confirm_yes", title: "✅ متابعة" },
    { id: "confirm_no", title: "❌ إلغاء" }
  ]
);

return res.sendStatus(200);
    }

    // ===== LOCATION =====
    if (userState[from] === "location") {
      if (msg.type !== "location") {
        await sendMessage(from, "📍 أرسل الموقع");
        return res.sendStatus(200);
      }

      const loc = msg.location;
      const service = userData[from];

      const tech = await getTech(service.id);

      const order = await db.collection("orders").add({
        phone: from,
        serviceName: service.name,
        type: service.selectedType,
        technicianId: tech?.id || null,
        status: tech ? "pending_tech" : "pending",
        location: { lat: loc.latitude, lng: loc.longitude },
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      if (tech) {
        await sendMessage(
          tech.phone,
          `📥 طلب جديد\n${safeText(service.name)}`
        );

        await sendList(tech.phone, "قبول الطلب:", "تنفيذ", [
          { id: `accept_${order.id}`, title: "✅ قبول" },
          { id: `reject_${order.id}`, title: "❌ رفض" }
        ]);
      }

      await sendMessage(from, "🚀 تم إرسال الطلب");

      delete userState[from];
      delete userData[from];

      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("ERROR:", err);
    return res.sendStatus(200);
  }
});

// ---------- START ----------
app.listen(process.env.PORT || 3000, () => {
  console.log("Server running...");
});