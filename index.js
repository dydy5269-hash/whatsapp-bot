import express from "express";
import axios from "axios";
import admin from "firebase-admin";

const app = express();
app.use(express.json());

// ===== Firebase =====
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ===== Variables =====
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const userState = {};

// ===== Send Message =====
async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// ===== Webhook Verify =====
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ===== Webhook Receive =====
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body?.trim();

    // ===== Reset =====
    if (text === "مرحبا") {
      userState[from] = "menu";
    }

    // ===== Menu =====
    if (!userState[from] || userState[from] === "menu") {
      userState[from] = "choose_service";

      await sendMessage(
        from,
        `👋 أهلاً بك في رؤية طاقة للخدمات 🇴🇲
إدارة عمانية لخدمتكم دائماً

اختر الخدمة:
1️⃣ كهرباء
2️⃣ سباكة
3️⃣ تكييف`
      );

      return res.sendStatus(200);
    }

    // ===== Choose Service =====
    if (userState[from] === "choose_service") {
      let service = "";

      if (text === "1") service = "كهرباء";
      else if (text === "2") service = "سباكة";
      else if (text === "3") service = "تكييف";
      else {
        await sendMessage(from, "❌ اختيار غير صحيح");
        return res.sendStatus(200);
      }

      userState[from + "_service"] = service;
      userState[from] = "send_location";

      await sendMessage(from, "📍 أرسل موقعك من فضلك");
      return res.sendStatus(200);
    }

    // ===== Receive Location =====
    if (userState[from] === "send_location") {
      if (!message.location) {
        await sendMessage(from, "📍 الرجاء إرسال الموقع");
        return res.sendStatus(200);
      }

      const service = userState[from + "_service"];

      // ===== Get Technician =====
      const snapshot = await db
        .collection("technicians")
        .where("service", "==", service)
        .where("active", "==", true)
        .get();

      if (snapshot.empty) {
        await sendMessage(from, "😔 لا يوجد فني متاح حالياً");
        userState[from] = "menu";
        return res.sendStatus(200);
      }

      const techDoc = snapshot.docs[0];
      const tech = techDoc.data();
      const technicianPhone = tech.phone;

      // ===== Save Order =====
      const orderRef = await db.collection("orders").add({
        client: from,
        technician: technicianPhone,
        service: service,
        status: "pending",
        location: message.location,
        createdAt: new Date(),
      });

      // ===== Send to Technician =====
      await sendMessage(
        technicianPhone,
        `📢 طلب جديد

🔧 الخدمة: ${service}

1️⃣ قبول
2️⃣ رفض`
      );

      await sendMessage(from, "✅ تم إرسال الطلب للفني");

      userState[from] = "waiting";
      return res.sendStatus(200);
    }

    // ===== Technician Response =====
    const ordersSnapshot = await db
      .collection("orders")
      .where("technician", "==", from)
      .where("status", "==", "pending")
      .get();

    if (!ordersSnapshot.empty) {
      const orderDoc = ordersSnapshot.docs[0];
      const order = orderDoc.data();

      if (text === "1") {
        await orderDoc.ref.update({ status: "accepted" });

        await sendMessage(
          order.client,
          "✅ تم قبول طلبك، الفني في الطريق 🚗"
        );

        await sendMessage(from, "👍 تم قبول الطلب");

      } else if (text === "2") {
        await orderDoc.ref.update({ status: "rejected" });

        await sendMessage(
          order.client,
          "❌ تم رفض الطلب، سيتم البحث عن فني آخر"
        );

        await sendMessage(from, "❌ تم رفض الطلب");
      }
    }

    // ===== Fallback =====
    else {
      await sendMessage(from, "❗ الرجاء اختيار من القائمة");
      userState[from] = "menu";
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// ===== Start Server =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running");
});
