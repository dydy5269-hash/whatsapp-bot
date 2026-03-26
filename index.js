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
  return res.sendStatus(403);
});

// ---------- WEBHOOK ----------
app.post("/webhook", async (req, res) => {
  try {
    const msg =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body || "";

    // ===== TECH REPLY =====
    if (userState[from] === "tech_reply") {
      const data = userData[from];
      const client = data?.client;
      const techData = data?.tech;
      const location = data?.location;

      if (client && techData) {
        if (text === "1") {
          // 👇 رسالة للعميل
          await sendMessage(
            client,
            `✅ تم قبول طلبك

👨‍🔧 الفني: ${techData.name}
🔧 الخدمة: ${techData.service}
⭐ التقييم: ${techData.rating}

📞 سيتواصل معك قريباً`
          );

          // 👇 رسالة للفني (مع الموقع)
          await sendMessage(
            from,
            `📍 بيانات العميل

📞 الرقم: ${client}
📌 الموقع: https://maps.google.com/?q=${location.latitude},${location.longitude}

⭐ تواصل مع العميل الآن`
          );
        } else {
          await sendMessage(client, "❌ تم رفض الطلب");
        }

        userState[from] = null;
        userData[from] = null;
      }

      return res.sendStatus(200);
    }

    // ===== CHECK TECH =====
    const tech = await getTechnician(from);

    if (tech) {
      if (!userState[from]) {
        userState[from] = "tech_menu";

        await sendMessage(
          from,
          `👨‍🔧 حسابك

👤 الاسم: ${tech.name}
🔧 الخدمة: ${tech.service}
⭐ التقييم: ${tech.rating}

📌 أنت فني`
        );
      }

      return res.sendStatus(200);
    }

    // ===== RESET =====
    if (text === "مرحبا") userState[from] = "menu";

    // ===== MENU =====
    if (!userState[from] || userState[from] === "menu") {
      userState[from] = "choose_service";

      await sendMessage(
        from,
        `👋 أهلاً بك في رؤية طاقة

اختر الخدمة:
1️⃣ كهرباء
2️⃣ سباكة
3️⃣ تكييف`
      );

      return res.sendStatus(200);
    }

    // ===== CHOOSE SERVICE =====
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

    // ===== LOCATION =====
    if (userState[from] === "location") {
      if (!msg.location) return res.sendStatus(200);

      userData[from].location = msg.location;

      const availableTech = await findAvailableTech(
        userData[from].service
      );

      if (!availableTech) {
        await db.collection("waiting_requests").add({
          phone: from,
          ...userData[from]
        });

        await sendMessage(
          from,
          "😔 لا يوجد فني حالياً\nسيتم إشعارك عند توفر فني"
        );

        userState[from] = null;
        return res.sendStatus(200);
      }

      await sendMessage(
        availableTech.phone,
        `📢 طلب جديد

🔧 ${userData[from].service}
💰 السعر: 10 ريال

1️⃣ قبول
2️⃣ رفض`
      );

      userState[availableTech.phone] = "tech_reply";
      userData[availableTech.phone] = {
        client: from,
        tech: availableTech,
        location: msg.location
      };

      await sendMessage(from, "✅ تم إرسال طلبك");

      userState[from] = null;

      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.log("ERROR:", err);
    return res.sendStatus(200);
  }
});

// ---------- START ----------
app.listen(process.env.PORT || 3000, () => {
  console.log("Server running...");
});
