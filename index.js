const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

/*
========================
الإعدادات
========================
*/

const VERIFY_TOKEN = "123456";

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

/*
========================
Firebase
========================
*/

const decoded = Buffer.from(
  process.env.FIREBASE_KEY,
  "base64"
).toString("utf8");

const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

console.log("Firebase ready");

/*
========================
Webhook Verify
========================
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
========================
Webhook Receive
========================
*/

app.post("/webhook", async (req, res) => {

  try {

    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;

    /*
    نص
    */

    if (message.type === "text") {

      const text = message.text.body;

      if (text === "مرحبا") {

        await sendMenu(from);

      }

    }

    /*
    ضغط زر
    */

    if (message.type === "interactive") {

      const button =
        message.interactive.button_reply.id;

      await handleButtons(from, button);

    }

    res.sendStatus(200);

  } catch (e) {

    console.log(e);

    res.sendStatus(200);

  }

});

/*
========================
قائمة الخدمات
========================
*/

async function sendMenu(user) {

  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: user,
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: "اختر الخدمة"
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
========================
معالجة الأزرار
========================
*/

async function handleButtons(phone, id) {

  /*
  قبول الطلب
  */

  if (id.startsWith("accept_")) {

    const orderId = id.replace("accept_", "");

    const order = await db
      .collection("orders")
      .doc(orderId)
      .get();

    const data = order.data();

    await order.ref.update({

      status: "accepted"

    });

    await sendText(
      data.user,
      "تم قبول طلبك من الفني"
    );

    await sendText(
      phone,
      "تم قبول الطلب"
    );

    return;

  }

  /*
  رفض الطلب
  */

  if (id.startsWith("reject_")) {

    const orderId = id.replace("reject_", "");

    const order = await db
      .collection("orders")
      .doc(orderId)
      .get();

    const data = order.data();

    await order.ref.update({

      status: "rejected"

    });

    await sendText(
      data.user,
      "تم رفض الطلب"
    );

    await sendText(
      phone,
      "تم رفض الطلب"
    );

    return;

  }

  /*
  طلب خدمة
  */

  const techSnapshot = await db
    .collection("technicians")
    .where("service", "==", id)
    .where("available", "==", true)
    .limit(1)
    .get();

  if (techSnapshot.empty) {

    await sendText(phone,
      "لا يوجد فني متاح");

    return;

  }

  const tech = techSnapshot.docs[0].data();

  /*
  إنشاء الطلب
  */

  const orderRef = await db
    .collection("orders")
    .add({

      user: phone,
      technician: tech.phone,
      service: id,
      status: "pending",
      time: Date.now()

    });

  /*
  إرسال للفني مع أزرار
  */

  await sendTechnicianButtons(
    tech.phone,
    orderRef.id,
    id,
    phone
  );

  await sendText(
    phone,
    "تم إرسال الطلب للفني"
  );

}

/*
========================
إرسال أزرار للفني
========================
*/

async function sendTechnicianButtons(
  techPhone,
  orderId,
  service,
  userPhone
) {

  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: techPhone,
      type: "interactive",
      interactive: {

        type: "button",

        body: {
          text:
`طلب جديد

الخدمة: ${service}
العميل: ${userPhone}`
        },

        action: {

          buttons: [

            {
              type: "reply",
              reply: {
                id: "accept_" + orderId,
                title: "قبول"
              }
            },

            {
              type: "reply",
              reply: {
                id: "reject_" + orderId,
                title: "رفض"
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
========================
رسالة نص
========================
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
========================
تشغيل
========================
*/

app.listen(process.env.PORT || 3000, () => {

  console.log("Running V4");

});
