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

// ---------- GET TECH ----------
async function getTechnician(phone) {
  const snap = await db
    .collection("technicians")
    .where("phone", "in", [phone, "+" + phone])
    .get();

  if (!snap.empty) return snap.docs[0].data();
  return null;
}

// ---------- FIND TECH ----------
async function findAvailableTech(service) {
  const snap = await db
    .collection("technicians")
    .where("service", "==", service)
    .where("active", "==", true)
    .get();

  if (!snap.empty) return snap.docs[0].data();
  return null;
}

// ---------- VERIFY ----------
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

// ---------- WEBHOOK ----------
app.post("/webhook", async (req, res) => {
  try {
    const msg =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body || "";

    console.log("📩 MESSAGE:", text);

    const tech = await getTechnician(from);

    // ----- TECH -----
    if (tech) {
      if (userState[from] !== "tech_reply") {
        userState[from] = "tech_menu";

        await sendMessage(
          from,
          "👨‍🔧 حسابك\n\n" +
            "👤 الاسم: " +
            tech.name +
            "\n" +
            "🔧 الخدمة: " +
            tech.service +
            "\n" +
            "💰 الرصيد: " +
            tech.balance +
            "\n" +
            "⭐ التقييم: " +
            tech.rating +
            "\n\n" +
            "📌 أنت مسجل كفني\n" +
            "سيتم إرسال الطلبات لك تلقائياً"
        );

        return res.sendStatus(200);
      }
    }

    // ----- RESET -----
    if (text === "مرحبا") userState[from] = "menu";

    // ----- MENU -----
    if (!userState[from] || userState[from] === "menu") {
      userState[from] = "choose_service";

      await sendMessage(
        from,
        "👋 أهلاً بك في رؤية طاقة للخدمات 🇴🇲\n\n" +
          "اختر الخدمة:\n\n" +
          "1️⃣ كهرباء ⚡\n" +
          "2️⃣ سباكة 🚿\n" +
          "3️⃣ تكييف ❄️"
      );

      return res.sendStatus(200);
    }

    // ----- CHOOSE SERVICE -----
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

    // ----- LOCATION -----
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
          "😔 لا يوجد فني متاح حالياً\n" +
            "سيتم إشعارك عند توفر فني"
        );

        userState[from] = "done";
        return res.sendStatus(200);
      }

      await sendMessage(
        tech.phone,
        "📢 طلب جديد\n\n" +
          "🔧 الخدمة: " +
          userData[from].service +
          "\n" +
          "💰 السعر: 10 ريال\n\n" +
          "للرد:\n1️⃣ قبول\n2️⃣ رفض"
      );

      userState[tech.phone] = "tech_reply";
      userData[tech.phone] = { client: from };

      await sendMessage(
        from,
        "✅ تم إرسال طلبك بنجاح\n" +
          "سيتم التواصل معك قريباً"
      );

      userState[from] = "done";
      return res.sendStatus(200);
    }

    // ----- TECH REPLY -----
    if (userState[from] === "tech_reply") {
      const client = userData[from].client;

      if (text === "1") {
        await sendMessage(
          client,
          "📌 تم قبول طلبك\nالفني في الطريق 👨‍🔧"
        );
      } else {
        await sendMessage(client, "❌ تم رفض الطلب");
      }

      userState[from] = null;
      userState[client] = null;

      return res.sendStatus(200);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("🔥 ERROR:", err);
    res.sendStatus(200);
  }
});

// ---------- START ----------
app.listen(3000, () => {
  console.log("Server running...");
});
