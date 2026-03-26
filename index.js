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
const PROFIT_PERCENT = 0.15;

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
async function getTechnician(phone) {
  const snap = await db
    .collection("technicians")
    .where("phone", "==", phone)
    .get();

  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  return null;
}

// ===== Verify =====
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  if (
    req.query["hub.mode"] &&
    req.query["hub.verify_token"] === VERIFY_TOKEN
  ) {
    res.send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body?.trim();

    const tech = await getTechnician(from);

    // ===== Technician Block =====
    if (tech) {
      await sendMessage(
        from,
        `👨‍🔧 حسابك

👤 ${tech.name}
🔧 ${tech.service}
💰 الرصيد: ${tech.balance}
⭐ التقييم: ${tech.rating}`
      );
    }

    if (tech && userState[from] !== "tech_reply") {
      return res.sendStatus(200);
    }

    // ===== Reset =====
    if (text === "مرحبا") userState[from] = "menu";

    // ===== Menu =====
    if (!userState[from] || userState[from] === "menu") {
      userState[from] = "choose_service";

      await sendMessage(
        from,
        `👋 أهلاً بك في رؤية طاقة

1️⃣ كهرباء
2️⃣ سباكة
3️⃣ تكييف`
      );

      return res.sendStatus(200);
    }

    // ===== Choose Service =====
    if (userState[from] === "choose_service") {
      const map = { "1": "كهرباء", "2": "سباكة", "3": "تكييف" };
      const service = map[text];

      if (!service) {
        await sendMessage(from, "❌ اختيار غير صحيح");
        return res.sendStatus(200);
      }

      userState[from + "_service"] = service;
      userState[from] = "location";

      await sendMessage(from, "📍 أرسل موقعك");
      return res.sendStatus(200);
    }

    // ===== Location =====
    if (userState[from] === "location") {
      if (!message.location) {
        await sendMessage(from, "📍 أرسل الموقع");
        return res.sendStatus(200);
      }

      const service = userState[from + "_service"];

      const snap = await db
        .collection("technicians")
        .where("service", "==", service)
        .where("active", "==", true)
        .get();

      let selected = null;

      snap.forEach(doc => {
        const t = doc.data();
        if (t.phone !== from && t.balance > 0 && !selected) {
          selected = { id: doc.id, ...t };
        }
      });

      if (!selected) {
        await sendMessage(from, "😔 لا يوجد فني متاح حالياً");
        return res.sendStatus(200);
      }

      await db.collection("orders").add({
        client: from,
        technician: selected.phone,
        techId: selected.id,
        service,
        price: 10,
        status: "pending",
        location: message.location,
        createdAt: new Date(),
      });

      await sendMessage(
        selected.phone,
        `📢 طلب جديد

🔧 ${service}
💰 السعر: 10 ريال

1️⃣ قبول
2️⃣ رفض`
      );

      await sendMessage(from, "✅ تم إرسال الطلب");
      userState[from] = "waiting";

      return res.sendStatus(200);
    }

    // ===== Technician Response =====
    const orders = await db
      .collection("orders")
      .where("technician", "==", from)
      .where("status", "==", "pending")
      .get();

    if (!orders.empty) {
      const doc = orders.docs[0];
      const order = doc.data();

      if (text === "1") {
        const techRef = db.collection("technicians").doc(order.techId);
        const techDoc = await techRef.get();
        const balance = techDoc.data().balance;

        const fee = order.price * PROFIT_PERCENT;

        if (balance < fee) {
          await sendMessage(from, "❌ رصيدك غير كافي");
          return res.sendStatus(200);
        }

        await techRef.update({
          balance: balance - fee,
        });

        await doc.ref.update({ status: "accepted" });

        await sendMessage(order.client, "✅ تم قبول الطلب");
        await sendMessage(from, `💰 تم خصم ${fee} ريال`);

      } else if (text === "2") {
        await doc.ref.update({ status: "rejected" });
        await sendMessage(order.client, "❌ تم رفض الطلب");
      }

      return res.sendStatus(200);
    }

    res.sendStatus(200);
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// ===== Start =====
app.listen(process.env.PORT || 3000);
