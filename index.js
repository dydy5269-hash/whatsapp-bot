const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");

const app = express();
app.use(bodyParser.json());

/*
========================
CONFIG
========================
*/

const VERIFY_TOKEN = "12345";

const TOKEN =
  "EAANB4MVrO8QBQn3sbt7SafPkIswPKxEtMIhkYZAJ1XVAWuE44EI6N9DOidNDs6BaxHX65xRgXQuQZBS7AqpHNRK2JgVtMlRgyHn0VXigfTIIwZBpg8ufOKI7Og1AjHnHPZCBfQuGPjpw0yCfeQwbYuum1HxhxVZCk75DBwSvrxIqaUWZBXOR5lye3DwO48G9YfZALtqnZB8e7sK8saaAhZBX89YY8NbHtGa8MkMmvSWwlVPFIggGKjp1g1gZAjLHZAo3cZBdMQSEVMm3NOZAcb3FErEx2efsD";

const PHONE_NUMBER_ID =
  "962759303589757";

// رقم الفني
const TECHNICIAN_PHONE = "96899258043";

/*
========================
FIREBASE INIT
========================
*/

const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

/*
========================
SEND MESSAGE FUNCTION
========================
*/

async function sendMessage(to, message) {
  await axios.post(
    `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: to,
      text: { body: message },
    },
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

/*
========================
WEBHOOK VERIFY
========================
*/

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

/*
========================
WEBHOOK RECEIVE
========================
*/

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (
      body.entry &&
      body.entry[0].changes &&
      body.entry[0].changes[0].value.messages
    ) {
      const message =
        body.entry[0].changes[0].value.messages[0];

      const from = message.from;
      const text =
        message.text?.body?.toLowerCase() || "";

      let reply = "";

      /*
      ========================
      القائمة الرئيسية
      ========================
      */

      if (
        text === "مرحبا" ||
        text === "menu" ||
        text === "القائمة"
      ) {
        reply =
          "✨ مرحبا بك في طاقة للخدمات الهندسية\n\n" +
          "اختر الخدمة:\n\n" +
          "1️⃣ طلب خدمة\n" +
          "2️⃣ عرض الأسعار\n" +
          "3️⃣ تواصل مع الدعم";

        await sendMessage(from, reply);
      }

      /*
      ========================
      طلب خدمة
      ========================
      */

      else if (text === "1" || text === "طلب خدمة") {
        reply =
          "🛠️ اختر نوع الخدمة:\n\n" +
          "⚡ كهرباء\n" +
          "🚿 سباكة\n" +
          "🔥 تبديل غاز";

        await sendMessage(from, reply);
      }

      /*
      ========================
      كهرباء
      ========================
      */

      else if (text.includes("كهرباء")) {
        reply =
          "🛠️ أسعار الكهرباء:\n\n" +
          "• تركيب إنارة: 3 ر.ع\n" +
          "• تركيب مروحة: 5 ر.ع\n" +
          "• صيانة مفتاح: 2 ر.ع\n\n" +
          "📍 أرسل موقعك الآن";

        await sendMessage(from, reply);

        await db.collection("orders").add({
          customerPhone: from,
          service: "electricity",
          status: "waiting_location",
          createdAt: new Date(),
        });
      }

      /*
      ========================
      سباكة
      ========================
      */

      else if (text.includes("سباكة")) {
        reply =
          "🛠️ أسعار السباكة:\n\n" +
          "• تبديل حنفية: 3 ر.ع\n" +
          "• تبديل عوامة: 5 ر.ع\n\n" +
          "📍 أرسل موقعك الآن";

        await sendMessage(from, reply);

        await db.collection("orders").add({
          customerPhone: from,
          service: "plumbing",
          status: "waiting_location",
          createdAt: new Date(),
        });
      }

      /*
      ========================
      غاز
      ========================
      */

      else if (text.includes("غاز")) {
        reply =
          "🛠️ أسعار الغاز:\n\n" +
          "• تبديل غاز: 3.2 ر.ع\n" +
          "• تركيب جديد: 28 ر.ع\n\n" +
          "📍 أرسل موقعك الآن";

        await sendMessage(from, reply);

        await db.collection("orders").add({
          customerPhone: from,
          service: "gas",
          status: "waiting_location",
          createdAt: new Date(),
        });
      }

      /*
      ========================
      استلام الموقع
      ========================
      */

      else if (message.location) {
        const location =
          message.location.latitude +
          "," +
          message.location.longitude;

        await db.collection("orders").add({
          customerPhone: from,
          location: location,
          status: "pending",
          createdAt: new Date(),
        });

        await sendMessage(
          from,
          "✅ تم استلام الموقع\nجارٍ إرسال الطلب للفني"
        );

        await sendMessage(
          TECHNICIAN_PHONE,
          "🔔 طلب جديد\n\n" +
            "العميل: " +
            from +
            "\nالموقع:\n" +
            location +
            "\n\nاكتب موافق أو رفض"
        );
      }

      /*
      ========================
      موافقة الفني
      ========================
      */

      else if (from === TECHNICIAN_PHONE && text === "موافق") {
        await sendMessage(
          TECHNICIAN_PHONE,
          "✅ تم قبول الطلب"
        );

        const snapshot = await db
          .collection("orders")
          .orderBy("createdAt", "desc")
          .limit(1)
          .get();

        const order = snapshot.docs[0].data();

        await sendMessage(
          order.customerPhone,
          "👨‍🔧 تم قبول طلبك\nالفني في الطريق"
        );
      }

      /*
      ========================
      انتهاء الخدمة
      ========================
      */

      else if (from === TECHNICIAN_PHONE && text === "تم") {
        const snapshot = await db
          .collection("orders")
          .orderBy("createdAt", "desc")
          .limit(1)
          .get();

        const order = snapshot.docs[0].data();

        await sendMessage(
          order.customerPhone,
          "⭐ تم إنهاء الخدمة\nقيم من 1 إلى 5"
        );
      }

      /*
      ========================
      التقييم
      ========================
      */

      else if (
        text === "1" ||
        text === "2" ||
        text === "3" ||
        text === "4" ||
        text === "5"
      ) {
        await sendMessage(
          from,
          "🙏 شكراً لتقييمك"
        );
      }

      else {
        await sendMessage(
          from,
          "اكتب مرحبا لعرض القائمة"
        );
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

/*
========================
SERVER
========================
*/

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
