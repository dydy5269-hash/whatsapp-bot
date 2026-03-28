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

// ---------- CHECK TECH ----------
async function isTechnician(phone) {
  const snap = await db.collection("technicians").where("phone", "==", phone).get();
  return !snap.empty;
}

// ---------- CHECK ACTIVE ORDER ----------
async function getActiveOrder(phone) {
  const snap = await db.collection("orders")
    .where("phone", "==", phone)
    .where("status", "in", ["pending", "accepted"])
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
    let text = msg.type === "text" ? msg.text.body.trim() : "";

    // ===== منع الفني =====
    if (await isTechnician(from)) {
      await sendMessage(from, "🚫 لا يمكنك طلب خدمة لأنك مسجل كفني");
      return res.sendStatus(200);
    }

    // ===== فحص طلب موجود =====
    const activeOrder = await getActiveOrder(from);

    if (!userState[from] && activeOrder) {
      userState[from] = "existing_order";

      await sendMessage(
        from,
        "⚠️ لديك طلب قيد التنفيذ\n\n1️⃣ متابعة الطلب\n2️⃣ إلغاء الطلب"
      );

      userData[from] = { orderId: activeOrder.id };

      return res.sendStatus(200);
    }

    // ===== التعامل مع الطلب الحالي =====
    if (userState[from] === "existing_order") {
      if (text === "1") {
        await sendMessage(from, "📦 طلبك قيد التنفيذ حالياً");
        delete userState[from];
        return res.sendStatus(200);
      }

      if (text === "2") {
        userState[from] = "cancel_reason";
        await sendMessage(from, "✍️ اكتب سبب الإلغاء:");
        return res.sendStatus(200);
      }
    }

    // ===== سبب الإلغاء =====
    if (userState[from] === "cancel_reason") {
      const orderId = userData[from].orderId;

      await db.collection("orders").doc(orderId).update({
        status: "cancelled",
        cancelReason: text,
        cancelledAt: admin.firestore.FieldValue.serverTimestamp()
      });

      await sendMessage(from, "❌ تم إلغاء الطلب\nشكراً لك");

      delete userState[from];
      delete userData[from];

      return res.sendStatus(200);
    }

    // ===== البداية =====
    if (!userState[from] || text === "مرحبا") {
      userState[from] = "main";

      await sendMessage(
        from,
        "👋 مرحبا\nاختر الخدمة:\n\n1️⃣ كهرباء\n2️⃣ سباكة\n3️⃣ تكييف"
      );

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