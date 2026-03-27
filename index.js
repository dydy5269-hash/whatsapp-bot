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
    else if (msg.type === "interactive") {
      if (msg.interactive?.button_reply) {
        text = msg.interactive.button_reply.id;
      } else if (msg.interactive?.list_reply) {
        text = msg.interactive.list_reply.id;
      }
    }

    // ===== BLOCK ONLY WHEN WAITING =====
    if (
      userState[from] === "waiting" &&
      text !== "cancel_order" &&
      text !== "resume"
    ) {
      await sendButtons(from, "⚠️ عندك طلب قيد التنفيذ", [
        { id: "resume", title: "🔄 متابعة" },
        { id: "cancel_order", title: "❌ إلغاء" }
      ]);
      return res.sendStatus(200);
    }

    // ===== CANCEL =====
    if (text === "cancel_order") {
      userState[from] = "cancel_reason";
      await sendMessage(from, "✍️ اكتب سبب الإلغاء");
      return res.sendStatus(200);
    }

    if (userState[from] === "cancel_reason") {
      userState[from] = null;
      userData[from] = null;

      await sendMessage(from, `❌ تم إلغاء الطلب\n📝 السبب: ${text}`);
      return res.sendStatus(200);
    }

    if (text === "resume") {
      await sendMessage(from, "🔄 طلبك قيد التنفيذ");
      return res.sendStatus(200);
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

    // ===== SERVICE =====
    if (userState[from] === "main_menu" && text.startsWith("service_")) {
      const id = text.replace("service_", "");
      const doc = await db.collection("services").doc(id).get();

      if (!doc.exists) {
        await sendMessage(from, "❌ الخدمة غير موجودة");
        return res.sendStatus(200);
      }

      const service = doc.data();

      if (!service.types || !Array.isArray(service.types)) {
        await sendMessage(from, "❌ لا توجد أنواع لهذه الخدمة");
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

    // ===== TYPE =====
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

      userData[from].location = msg.location;

      const tech = await findAvailableTech(userData[from].serviceName);

      if (!tech) {
        await sendMessage(from, "🚫 لا يوجد فني");
        return res.sendStatus(200);
      }

      const techPhone = normalizePhone(tech.phone);

      await sendMessage(
        tech.phone,
        `📥 طلب جديد\n👤 ${from}\n🔧 ${userData[from].type.name}\n💰 ${userData[from].type.price}`
      );

      await sendButtons(tech.phone, "اختر:", [
        { id: "accept", title: "✅ قبول" },
        { id: "reject", title: "❌ رفض" }
      ]);

      userData[techPhone] = {
        client: { phone: from },
        tech,
        service: userData[from].serviceName,
        price: userData[from].type.price,
        location: msg.location
      };

      userState[techPhone] = "tech_reply";
      userState[from] = "waiting";

      await sendMessage(from, "🚀 تم إرسال الطلب");

      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  } catch (e) {
    console.log("ERROR:", e);
    return res.sendStatus(200);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running...");
});