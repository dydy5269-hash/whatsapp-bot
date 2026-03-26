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

// ---------------- SEND MESSAGE ----------------
async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: to,
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

// ---------------- GET TECH ----------------
async function getTechnician(phone) {
  const snapshot = await db
    .collection("technicians")
    .where("phone", "in", [phone, "+" + phone])
    .get();

  if (!snapshot.empty) {
    return snapshot.docs[0].data();
  }
  return null;
}

// ---------------- FIND AVAILABLE TECH ----------------
async function findAvailableTech(service) {
  const snapshot = await db
    .collection("technicians")
    .where("service", "==", service)
    .where("active", "==", true)
    .get();

  if (!snapshot.empty) {
    return snapshot.docs[0].data();
  }
  return null;
}

// ---------------- WEBHOOK VERIFY ----------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ---------------- WEBHOOK ----------------
app.post("/webhook", async (req, res) => {
  const msg =
    req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (!msg) return res.sendStatus(200);

  const from = msg.from;
  const text = msg.text?.body || "";

  const tech = await getTechnician(from);

   if (tech) {
  //اذا الفني يكتب عادي (مو رد على طلب )
    if (tech && userState[from] !== "tech_reply") {
      userState[from] = "tech_menu";
      await sendMessage(
  from,
  "👨‍🔧 حسابك\n\n" +
  "👤 الاسم: " + tech.name + "\n" +
  "🔧 الخدمة: " + tech.service + "\n" +
  "💰 الرصيد: " + tech.balance + "\n" +
  "⭐ التقييم: " + tech.rating
);
        انت مسجل كفني سيتمارسال الطلبات لك تلقائيا
    );
    return res.sendStatus(200);
    }
  }

  // ----- Reset -----
  if (text === "مرحبا") userState[from] = "menu";

  // ----- Menu -----
  if (!userState[from] || userState[from] === "menu") {
    userState[from] = "choose_service";

    await sendMessage(
      from,
      `👋 أهلاً بك في رؤية طاقة للخدمات 🇴🇲

اختر الخدمة:

1️⃣ كهرباء ⚡
2️⃣ سباكة 🚿
3️⃣ تكييف ❄️`
    );

    return res.sendStatus(200);
  }

  // ----- Choose Service -----
  if (userState[from] === "choose_service") {
    const map = {
      "1": "كهرباء",
      "2": "سباكة",
      "3": "تكييف"
    };

    const service = map[text];

    if (!service) {
      await sendMessage(from, "❌ اختيار غير صحيح");
      return res.sendStatus(200);
    }

    userData[from] = { service };
    userState[from] = "location";

    await sendMessage(from, "📍 أرسل موقعك من فضلك");
    return res.sendStatus(200);
  }

  // ----- Location -----
  if (userState[from] === "location") {
    if (!msg.location) {
      await sendMessage(from, "📍 الرجاء إرسال الموقع");
      return res.sendStatus(200);
    }

    userData[from].location = msg.location;

    const tech = await findAvailableTech(userData[from].service);

    if (!tech) {
      await db.collection("waiting_requests").add({
        phone: from,
        ...userData[from]
      });

      await sendMessage(
        from,
        `😔 لا يوجد فني متاح حالياً
سيتم إشعارك عند توفر فني`
      );

      userState[from] = "done";
      return res.sendStatus(200);
    }

    await sendMessage(
      tech.phone,
      `📢 طلب جديد

🔧 الخدمة: ${userData[from].service}
💰 السعر: 10 ريال

للرد:
1️⃣ قبول
2️⃣ رفض`
    );

    userState[tech.phone] = "tech_reply";
    userData[tech.phone] = { client: from };

    await sendMessage(
      from,
      `✅ تم إرسال طلبك بنجاح
سيتم التواصل معك قريباً`
    );

    userState[from] = "done";
    return res.sendStatus(200);
  }

  // ----- Tech Reply -----
  if (userState[from] === "tech_reply") {
    const client = userData[from].client;

    if (text === "1") {
      await sendMessage(
        client,
        `📌 تم قبول طلبك
الفني في الطريق 👨‍🔧`
      );
    } else {
      await sendMessage(
        client,
        `❌ تم رفض الطلب`
      );
    }

    userState[from] = null;
    userState[client] = null;

    return res.sendStatus(200);
  }

  res.sendStatus(200);
});

// ---------------- START SERVER ----------------
app.listen(3000, () => {
  console.log("Server running...");
});
