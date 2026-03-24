import express from "express";
import fetch from "node-fetch";
import admin from "firebase-admin";

const app = express();

app.use(express.json());

// 🔥 Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// 🧠 تخزين مؤقت
const userState = {};

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

      // بداية
      if (!userState[from]) {
        if (userText === "مرحبا") {
          userState[from] = { step: "choose_service" };
          reply =
            "أهلاً 👋\nاختر الخدمة:\n1️⃣ كهرباء\n2️⃣ سباكة\n3️⃣ تكييف";
        } else {
          reply = "اكتب مرحبا 👋";
        }
      }

      // اختيار الخدمة
      else if (userState[from].step === "choose_service") {
        if (userText === "1") {
          userState[from] = { step: "location", service: "كهرباء" };
          reply = "أرسل موقعك 📍";
        } else if (userText === "2") {
          userState[from] = { step: "location", service: "سباكة" };
          reply = "أرسل موقعك 📍";
        } else if (userText === "3") {
          userState[from] = { step: "location", service: "تكييف" };
          reply = "أرسل موقعك 📍";
        } else {
          reply = "اختر رقم صحيح (1 أو 2 أو 3)";
        }
      }

      // استقبال الموقع + حفظ الطلب + إرسال للفني 🔥
      else if (userState[from].step === "location") {
        if (location) {
          const lat = location.latitude;
          const lng = location.longitude;

          const service = userState[from].service;

          // 🔥 حفظ الطلب
          const orderRef = await db.collection("orders").add({
            phone: from,
            service: service,
            location: { lat, lng },
            status: "new",
            createdAt: new Date(),
          });

          // 🔥 جلب فني متاح
          const techSnapshot = await db
            .collection("technicians")
            .where("service", "==", service)
            .where("active", "==", true)
            .limit(1)
            .get();

          if (!techSnapshot.empty) {
            const tech = techSnapshot.docs[0].data();

            // 🔥 إرسال الطلب للفني
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
                  to: tech.phone,
                  text: {
                    body:
                      `طلب جديد 🔥\nالخدمة: ${service}\n` +
                      `موقع العميل:\nhttps://maps.google.com/?q=${lat},${lng}`,
                  },
                }),
              }
            );

            reply =
              `تم إرسال طلبك للفني ✅\nالخدمة: ${service}\nسيتم التواصل معك قريباً`;
          } else {
            reply = "لا يوجد فني متاح حالياً 😔";
          }

          userState[from] = { step: "done" };
        } else {
          reply = "أرسل موقعك باستخدام زر 📍";
        }
      }

      // بعد الانتهاء
      else if (userState[from].step === "done") {
        reply = "طلبك مسجل بالفعل ✅";
      }

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
            to: from,
            text: { body: reply },
          }),
        }
      );
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Error:", error);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
