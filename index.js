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

// ===== Check Technician =====
async function isTechnician(phone) {
  const snap = await db
    .collection("technicians")
    .where("phone", "==", phone)
    .get();

  if (!snap.empty) return snap.docs[0].data();
  return null;
}

// ===== Verify =====
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

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body?.trim();

    const techData = await isTechnician(from);

    // ===== Technician Info =====
    if (techData) {
      await sendMessage(
        from,
        `👨‍🔧 حسابك الفني

👤 الاسم: ${techData.name}
🔧 الخدمة: ${techData.service}
💰 الرصيد: ${techData.balance} ريال
⭐ التقييم: ${techData.rating}`
      );
    }

    // ===== Prevent Technician Request =====
    if (techData && userState[from] !== "tech_reply") {
      return res.sendStatus(200);
    }

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

      await sendMessage(from, "📍 أرسل موقعك");
      return res.sendStatus(200);
    }

    // ===== Receive Location =====
    if (userState[from] === "send_location") {
      if (!message.location) {
        await sendMessage(from, "📍 الرجاء إرسال الموقع");
        return res.sendStatus(200);
      }

      const service = userState[from + "_service"];

      const snapshot = await db
        .collection("technicians")
        .where("service", "==", service)
        .where("active", "==", true)
        .get();

      if (snapshot.empty) {
        await db.collection("waiting_requests").add({
          client: from,
          service,
          location: message.location,
          createdAt: new Date(),
        });

        await sendMessage(
          from,
          "😔 لا يوجد فني متاح حالياً\nسيتم إشعارك عند توفر فني"
        );

        userState[from] = "waiting";
        return res.sendStatus(200);
      }

      const tech = snapshot.docs[0].data();

      await db.collection("orders").add({
        client: from,
        technician: tech.phone,
        service,
        status: "pending",
        location: message.location,
        createdAt: new Date(),
      });

      await sendMessage(
        tech.phone,
        `📢 طلب جديد

🔧 ${service}

1️⃣ قبول
2️⃣ رفض`
      );

      await sendMessage(from, "✅ تم إرسال طلبك");

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

        await sendMessage(order.client, "✅ تم قبول طلبك");
        await sendMessage(from, "👍 تم القبول");

      } else if (text === "2") {
        await orderDoc.ref.update({ status: "rejected" });

        await sendMessage(order.client, "❌ تم رفض الطلب");
        await sendMessage(from, "❌ تم الرفض");
      }

      return res.sendStatus(200);
    }

    // ===== Waiting Client =====
    if (userState[from] === "waiting" && text === "1") {
      const reqSnap = await db
        .collection("waiting_requests")
        .where("client", "==", from)
        .get();

      if (!reqSnap.empty) {
        const reqData = reqSnap.docs[0].data();

        const techSnap = await db
          .collection("technicians")
          .where("service", "==", reqData.service)
          .where("active", "==", true)
          .get();

        if (!techSnap.empty) {
          const tech = techSnap.docs[0].data();

          await sendMessage(
            tech.phone,
            `📢 طلب جديد

🔧 ${reqData.service}

1️⃣ قبول
2️⃣ رفض`
          );

          await sendMessage(from, "✅ تم إعادة إرسال الطلب");
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// ===== Notify Waiting Clients =====
setInterval(async () => {
  const waiting = await db.collection("waiting_requests").get();

  for (const doc of waiting.docs) {
    const data = doc.data();

    const techSnap = await db
      .collection("technicians")
      .where("service", "==", data.service)
      .where("active", "==", true)
      .get();

    if (!techSnap.empty) {
      await sendMessage(
        data.client,
        "👨‍🔧 يوجد فني متاح الآن\nهل ترغب في إرسال الطلب؟\n1️⃣ نعم"
      );
    }
  }
}, 30000);

// ===== Start =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running");
});
