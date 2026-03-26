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
  try {
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
  } catch (e) {
    console.log("SEND ERROR:", e.response?.data || e.message);
  }
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
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

// ---------- WEBHOOK ----------
app.post("/webhook", async (req, res) => {
  try {
    const msg =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body || "";

    console.log("MSG:", text);

    const tech = await getTechnician(from);

    // ===== الفني =====
    if (tech) {
      if (userState[from] !== "tech_reply") {
        userState[from] = "tech_menu";

        await sendMessage(
          from,
          `👨‍🔧 حسابك

👤 الاسم: ${tech.name}
🔧 الخدمة: ${tech.service}
💰 الرصيد: ${tech.balance}
⭐ التقييم: ${tech.rating}

📌 أنت مسجل كفني
سيتم إرسال الطلبات لك`
        );

        return res.sendStatus(200);
      }
    }

    // ===== reset =====
    if (text === "مرحبا") userState[from] = "menu";

    // ===== menu =====
    if (!userState[from] || userState[from] === "menu") {
      userState[from] = "choose_service";

      await sendMessage(
        from,
        `👋 أهلاً بك في رؤية طاقة للخدمات

اختر الخدمة:
1️⃣ كهرباء
2️⃣ سباكة
3️⃣ تكييف`
      );

      return res.sendStatus(200);
    }

    // ===== اختيار الخدمة =====
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

      await sendMessage(from, "📍 أرسل موقعك");
      return res.sendStatus(200);
    }

    // ===== الموقع =====
    if (userState[from] === "location") {
      if (!msg.location) {
        await sendMessage(from, "📍 أرسل الموقع من فضلك");
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
          "😔 لا يوجد فني حالياً\nسيتم إشعارك عند توفر فني"
        );

        return res.sendStatus(200);
      }

      await sendMessage(
        tech.phone,
        `📢 طلب جديد

🔧 ${userData[from].service}
💰 السعر: 10 ريال

1️⃣ قبول
2️⃣ رفض`
      );

      userState[tech.phone] = "tech_reply";
      userData[tech.phone] = { client: from };

      await sendMessage(
        from,
        "✅ تم إرسال طلبك"
      );

      return res.sendStatus(200);
    }

    // ===== رد الفني =====
    if (userState[from] === "tech_reply") {
      const client = userData[from].client;

      if (text === "1") {
        await sendMessage(client, "✅ الفني في الطريق");
      } else {
        await sendMessage(client, "❌ تم رفض الطلب");
      }

      userState[from] = null;
      userState[client] = null;

      return res.sendStatus(200);
    }

    res.sendStatus(200);
  } catch (err) {
    console.log("ERROR:", err);
    res.sendStatus(200);
  }
});

// ---------- START ----------
app.listen(3000, () => {
  console.log("Server running...");
});
