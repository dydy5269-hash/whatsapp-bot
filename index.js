import express from "express";
import fetch from "node-fetch";
import admin from "firebase-admin";

const app = express();
app.use(express.json());

const mainMenu =
`👋 أهلاً بك في *رؤية طاقة للخدمات* 🇴🇲
إدارة عمانية لخدمتكم دائماً

اختر الخدمة:
1️⃣ كهرباء
2️⃣ سباكة
3️⃣ تكييف

0️⃣ رجوع`;

let userState = {};
let techState = {};

// Firebase
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY))
});
const db = admin.firestore();

// إرسال واتساب
async function sendMessage(to, text) {
  await fetch(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      text: { body: text }
    })
  });
}

// Webhook
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body?.trim();

    let reply = "";

    // ✅ RESET عند مرحبا
    if (text === "مرحبا" || text === "0") {
      userState[from] = { step: "choose" };
      reply = mainMenu;
      await sendMessage(from, reply);
      return res.sendStatus(200);
    }

    // ======================
    // 👤 المستخدم
    // ======================

    if (!userState[from]) {
      userState[from] = { step: "choose" };
      reply = mainMenu;
    }

    else if (userState[from].step === "choose") {

      if (text === "1") userState[from].service = "كهرباء";
      else if (text === "2") userState[from].service = "سباكة";
      else if (text === "3") userState[from].service = "تكييف";
      else {
        reply = mainMenu;
        await sendMessage(from, reply);
        return res.sendStatus(200);
      }

      userState[from].step = "location";
      reply = "📍 أرسل موقعك";
    }

    else if (userState[from].step === "location") {

      if (!msg.location) {
        reply = "📍 أرسل الموقع من فضلك";
        await sendMessage(from, reply);
        return res.sendStatus(200);
      }

      const location = msg.location;

      // 🔍 البحث عن فني
      const techSnap = await db.collection("technicians")
        .where("service", "==", userState[from].service)
        .where("active", "==", true)
        .limit(1)
        .get();

      if (techSnap.empty) {
        reply = "😔 لا يوجد فني متاح حالياً";
      } else {
        const tech = techSnap.docs[0];
        const techData = tech.data();

        // ✅ شرط الرصيد
        if ((techData.balance || 0) < 2) {
          reply = "😔 لا يوجد فني متاح حالياً";
        } else {

          const orderRef = await db.collection("orders").add({
            phone: from,
            service: userState[from].service,
            location,
            status: "pending",
            total: 0,
            createdAt: new Date(),
            technicianId: tech.id
          });

          // إرسال للفني
          await sendMessage(
            techData.phone,
            `📥 طلب جديد\nالخدمة: ${userState[from].service}\nID: ${orderRef.id}\n\n1️⃣ قبول`
          );

          techState[techData.phone] = {
            orderId: orderRef.id,
            step: "new"
          };

          reply = "✅ تم إرسال الطلب للفني";
          userState[from].step = "done";
        }
      }
    }

    else if (userState[from].step === "done") {
      reply = "طلبك قيد التنفيذ 🔄\n\n0️⃣ طلب جديد";
    }

    // ======================
    // 👨‍🔧 الفني
    // ======================

    if (techState[from]) {

      const state = techState[from];

      if (text === "1" && state.step === "new") {
        await db.collection("orders").doc(state.orderId).update({
          status: "accepted"
        });

        state.step = "work";
        reply = "🚧 ابدأ العمل\nاكتب done عند الانتهاء";
      }

      else if (text === "done") {

        const orderRef = db.collection("orders").doc(state.orderId);
        const order = (await orderRef.get()).data();

        const total = order.total || 10;

        // 💰 حساب العمولة
        const commission = total * 0.15;

        // 💳 خصم من الرصيد
        const techRef = db.collection("technicians").doc(order.technicianId);
        const tech = (await techRef.get()).data();

        const newBalance = (tech.balance || 0) - commission;

        await techRef.update({
          balance: newBalance
        });

        await orderRef.update({
          status: "completed",
          commission
        });

        // 📩 إشعار العميل
        await sendMessage(
          order.phone,
          `✅ تم إنهاء الطلب\n💵 الإجمالي: ${total}`
        );

        // ⚠️ تنبيه الفني
        if (newBalance <= 1) {
          await sendMessage(
            tech.phone,
            "⚠️ رصيدك منخفض، يرجى التعبئة"
          );
        }

        reply = "✅ تم إنهاء الطلب";

        // ✅ RESET بعد انتهاء الطلب
        delete userState[order.phone];
        delete techState[from];
      }
    }

    // ======================
    // fallback
    // ======================

    if (!reply) {
      userState[from] = { step: "choose" };
      reply = mainMenu;
    }

    await sendMessage(from, reply);
    res.sendStatus(200);

  } catch (err) {
    console.log(err);
    res.sendStatus(500);
  }
});

// تشغيل السيرفر
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server running"));
