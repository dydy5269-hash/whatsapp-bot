import express from "express";
import fetch from "node-fetch";
import admin from "firebase-admin";

const app = express();
app.use(express.json());

const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const userState = {};
const techState = {};

const mainMenu =
  "أهلاً 👋\nاختر الخدمة:\n1️⃣ كهرباء\n2️⃣ سباكة\n3️⃣ تكييف\n\n0️⃣ رجوع للقائمة";

app.get("/", (req, res) => {
  res.send("Server is working 🔥");
});

app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    const message =
      body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (message) {
      const from = message.from;
      const userText = message.text?.body?.toLowerCase();
      const location = message.location;

      let reply = "";

      // 🔥 رد الفني (قبول/رفض)
      if (techState[from]) {
        const orderId = techState[from].orderId;

        if (userText === "1") {
          await db.collection("orders").doc(orderId).update({
            status: "accepted",
          });

          const order = await db.collection("orders").doc(orderId).get();
          const data = order.data();

          await sendMessage(
            data.phone,
            "تم قبول طلبك من الفني ✅\nسيتم التواصل معك قريباً"
          );

          reply = "تم قبول الطلب ✅";
          delete techState[from];
        } else if (userText === "2") {
          await db.collection("orders").doc(orderId).update({
            status: "rejected",
          });

          const order = await db.collection("orders").doc(orderId).get();
          const data = order.data();

          await sendMessage(
            data.phone,
            "تم رفض الطلب 😔\nسيتم البحث عن فني آخر"
          );

          reply = "تم رفض الطلب ❌";
          delete techState[from];
        } else {
          reply = "اختر:\n1️⃣ قبول\n2️⃣ رفض";
        }
      }

      // 🔄 رجوع
      else if (userText === "0") {
        userState[from] = { step: "choose_service" };
        reply = mainMenu;
      }

      // بداية
      else if (!userState[from]) {
        if (userText === "مرحبا") {
          userState[from] = { step: "choose_service" };
          reply = mainMenu;
        } else {
          reply = "اكتب مرحبا 👋 أو 0";
        }
      }

      // اختيار الخدمة
      else if (userState[from].step === "choose_service") {
        if (userText === "1") {
          userState[from] = { step: "location", service: "كهرباء" };
          reply = "أرسل موقعك 📍\n0️⃣ رجوع";
        } else if (userText === "2") {
          userState[from] = { step: "location", service: "سباكة" };
          reply = "أرسل موقعك 📍\n0️⃣ رجوع";
        } else if (userText === "3") {
          userState[from] = { step: "location", service: "تكييف" };
          reply = "أرسل موقعك 📍\n0️⃣ رجوع";
        } else {
          reply = mainMenu;
        }
      }

      // الموقع + إرسال للفني
      else if (userState[from].step === "location") {
        if (location) {
          const lat = location.latitude;
          const lng = location.longitude;
          const service = userState[from].service;

          const orderRef = await db.collection("orders").add({
            phone: from,
            service,
            location: { lat, lng },
            status: "pending",
            createdAt: new Date(),
          });

          const techSnapshot = await db
            .collection("technicians")
            .where("service", "==", service)
            .where("active", "==", true)
            .limit(1)
            .get();

          if (!techSnapshot.empty) {
            const tech = techSnapshot.docs[0].data();

            techState[tech.phone] = {
              orderId: orderRef.id,
            };

            await sendMessage(
              tech.phone,
              `طلب جديد 🔥\nالخدمة: ${service}\n` +
                `الموقع:\nhttps://maps.google.com/?q=${lat},${lng}\n\n` +
                "1️⃣ قبول\n2️⃣ رفض"
            );

            reply = "تم إرسال الطلب للفني ✅";
          } else {
            reply = "لا يوجد فني متاح 😔";
          }

          userState[from] = { step: "done" };
        } else {
          reply = "أرسل موقعك 📍";
        }
      }

      else {
        reply = "طلبك مسجل ✅\n0️⃣ طلب جديد";
      }

      await sendMessage(from, reply);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error(error);
    res.sendStatus(500);
  }
});

// 🔥 دالة إرسال
async function sendMessage(to, text) {
  await fetch(
    `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to,
        text: { body: text },
      }),
    }
  );
}

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
