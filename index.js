const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

/*
==============================
الإعدادات
==============================
*/

const VERIFY_TOKEN = "123456";

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

/*
==============================
Firebase setup
==============================
*/

let serviceAccount;

try {

  const decoded = Buffer.from(
    process.env.FIREBASE_KEY,
    "base64"
  ).toString("utf8");

  serviceAccount = JSON.parse(decoded);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  console.log("Firebase connected");

} catch (e) {

  console.log("Firebase error", e);

}

const db = admin.firestore();

/*
==============================
Webhook verification
==============================
*/

app.get("/webhook", (req, res) => {

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {

    res.status(200).send(challenge);

  } else {

    res.sendStatus(403);

  }

});

/*
==============================
استقبال الرسائل
==============================
*/

app.post("/webhook", async (req, res) => {

  try {

    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;

    /*
    ==============================
    رسالة نص
    ==============================
    */

    if (message.type === "text") {

      const text = message.text.body;

      if (text === "مرحبا") {

        await sendMenu(from);

      }

    }

    /*
    ==============================
    اختيار من القائمة
    ==============================
    */

    if (message.type === "interactive") {

      const id =
        message.interactive.button_reply.id;

      await handleService(from, id);

    }

    res.sendStatus(200);

  } catch (e) {

    console.log(e);

    res.sendStatus(200);

  }

});

/*
==============================
إرسال القائمة
==============================
*/

async function sendMenu(to) {

  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: to,
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: "اختر الخدمة المطلوبة"
        },
        action: {
          buttons: [

            {
              type: "reply",
              reply: {
                id: "electric",
                title: "كهرباء ⚡"
              }
            },

            {
              type: "reply",
              reply: {
                id: "plumbing",
                title: "سباكة 🚰"
              }
            },

            {
              type: "reply",
              reply: {
                id: "ac",
                title: "تكييف ❄️"
              }
            }

          ]
        }
      }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );

}

/*
==============================
معالجة الخدمة
==============================
*/

async function handleService(userPhone, service) {

  const snapshot = await db
    .collection("technicians")
    .where("service", "==", service)
    .where("available", "==", true)
    .limit(1)
    .get();

  if (snapshot.empty) {

    await sendText(userPhone,
      "لا يوجد فني متاح حالياً");

    return;

  }

  const tech = snapshot.docs[0].data();

  /*
  حفظ الطلب
  */

  await db.collection("orders").add({

    user: userPhone,
    technician: tech.phone,
    service: service,
    status: "new",
    time: Date.now()

  });

  /*
  إرسال للفني
  */

  await sendText(
    tech.phone,
    `طلب جديد

الخدمة: ${service}
رقم العميل: ${userPhone}`
  );

  /*
  تأكيد للعميل
  */

  await sendText(
    userPhone,
    "تم إرسال الطلب للفني"
  );

}

/*
==============================
إرسال رسالة نص
==============================
*/

async function sendText(to, text) {

  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
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

/*
==============================
تشغيل السيرفر
==============================
*/

app.listen(process.env.PORT || 3000, () => {

  console.log("Running V3");

});
