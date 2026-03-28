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
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: text }
    },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
}

// ---------- SERVICES ----------
async function getServices() {
  const snap = await db.collection("services").get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// ---------- CHECK TECH ----------
async function isTechnician(phone) {
  const snap = await db.collection("technicians").where("phone", "==", phone).get();
  return !snap.empty;
}

// ---------- CHECK ACTIVE ORDER ----------
async function hasActiveOrder(phone) {
  const snap = await db.collection("orders")
    .where("phone", "==", phone)
    .where("status", "in", ["pending", "accepted"])
    .get();
  return !snap.empty;
}

// ---------- FIND TECH ----------
async function findTech(service) {
  const snap = await db.collection("technicians")
    .where("service", "==", service)
    .where("active", "==", true)
    .limit(1)
    .get();

  if (snap.empty) return null;

  return { id: snap.docs[0].id, ...snap.docs[0].data() };
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
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = normalizePhone(msg.from);
    let text = "";

    if (msg.type === "text") {
      text = msg.text.body.trim();
    }

    console.log("TEXT:", text, "STATE:", userState[from]);

    // ===== منع الفني =====
    if (await isTechnician(from)) {
      await sendMessage(from, "🚫 لا يمكنك طلب خدمة لأنك مسجل كفني");
      return res.sendStatus(200);
    }

    // ===== البداية =====
    if (!userState[from] || text === "مرحبا") {
      if (await hasActiveOrder(from)) {
        await sendMessage(from, "⚠️ لديك طلب قيد التنفيذ");
        return res.sendStatus(200);
      }

      userState[from] = "service";

      const services = await getServices();

      let msgText = "👋 مرحبا\nاختر الخدمة:\n\n";
      services.forEach((s, i) => {
        msgText += `${i + 1}️⃣ ${s.name}\n`;
      });

      userData[from] = { services };

      await sendMessage(from, msgText);
      return res.sendStatus(200);
    }

    // ===== اختيار الخدمة =====
    if (userState[from] === "service") {
      const index = parseInt(text) - 1;
      const service = userData[from].services[index];

      if (!service) {
        await sendMessage(from, "❌ اختر رقم صحيح");
        return res.sendStatus(200);
      }

      userData[from].service = service;
      userState[from] = "type";

      let msgText = `⚡ ${service.name}\nاختر النوع:\n\n`;

      service.types.forEach((t, i) => {
        msgText += `${i + 1}️⃣ ${t.name} - ${t.price} ريال\n`;
      });

      await sendMessage(from, msgText);
      return res.sendStatus(200);
    }

    // ===== اختيار النوع =====
    if (userState[from] === "type") {
      const index = parseInt(text) - 1;
      const type = userData[from].service.types[index];

      if (!type) {
        await sendMessage(from, "❌ اختر رقم صحيح");
        return res.sendStatus(200);
      }

      userData[from].type = type;
      userState[from] = "confirm";

      await sendMessage(
        from,
        `🧾 ${type.name}\n💰 ${type.price} ريال\n\n1️⃣ تأكيد\n2️⃣ إلغاء`
      );

      return res.sendStatus(200);
    }

    // ===== تأكيد =====
    if (userState[from] === "confirm") {
      if (text === "2") {
        delete userState[from];
        delete userData[from];
        await sendMessage(from, "❌ تم الإلغاء");
        return res.sendStatus(200);
      }

      if (text === "1") {
        userState[from] = "location";
        await sendMessage(from, "📍 أرسل موقعك");
      }

      return res.sendStatus(200);
    }

    // ===== الموقع =====
    if (userState[from] === "location") {
      if (msg.type !== "location") {
        await sendMessage(from, "📍 أرسل الموقع");
        return res.sendStatus(200);
      }

      const tech = await findTech(userData[from].service.name);

      if (!tech) {
        await sendMessage(from, "🚫 لا يوجد فني متاح");
        return res.sendStatus(200);
      }

      // حفظ الطلب
      await db.collection("orders").add({
        phone: from,
        service: userData[from].service.name,
        type: userData[from].type,
        technicianId: tech.id,
        status: "pending",
        location: {
          lat: msg.location.latitude,
          lng: msg.location.longitude
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // إرسال للفني
      await sendMessage(
        tech.phone,
        `📥 طلب جديد\n${userData[from].service.name}\n${userData[from].type.name}\n\n1️⃣ قبول\n2️⃣ رفض`
      );

      await sendMessage(from, "🚀 تم إرسال طلبك");

      delete userState[from];
      delete userData[from];

      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.log(err);
    return res.sendStatus(200);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running...");
});