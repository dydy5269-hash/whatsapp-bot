const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

/*
=========================
Firebase
=========================
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

/*
=========================
WhatsApp config
=========================
*/

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_ID;


/*
=========================
ارسال رسالة نص
=========================
*/

async function sendText(to, text) {

  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`
      }
    }
  );

}


/*
=========================
ارسال ازرار
=========================
*/

async function sendButtons(to) {

  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
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
                id: "electricity",
                title: "كهرباء ⚡"
              }
            },
            {
              type: "reply",
              reply: {
                id: "plumbing",
                title: "سباكة 🚿"
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
        Authorization: `Bearer ${TOKEN}`
      }
    }
  );

}


/*
=========================
ارسال للفني
=========================
*/

async function sendTechnician(techPhone, orderId, location) {

  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: techPhone,
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text:
            `طلب جديد\n\nالموقع:\n${location}`
        },
        action: {
          buttons: [
            {
              type: "reply",
              reply: {
                id: `accept_${orderId}`,
                title: "قبول"
              }
            },
            {
              type: "reply",
              reply: {
                id: `رفض_${orderId}`,
                title: "رفض"
              }
            }
          ]
        }
      }
    },
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`
      }
    }
  );

}


/*
=========================
Webhook
=========================
*/

app.post("/webhook", async (req, res) => {

  try {

    const msg =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!msg) return res.sendStatus(200);

    const from = msg.from;

    /*
    =====================
    ارسال القائمة
    =====================
    */

    if (msg.text?.body === "مرحبا") {

      await sendButtons(from);

    }

    /*
    =====================
    اختيار زر
    =====================
    */

    if (msg.type === "interactive") {

      const id =
        msg.interactive.button_reply.id;

      /*
      =====================
      اختيار الخدمة
      =====================
      */

      if (
        id === "electricity" ||
        id === "plumbing" ||
        id === "ac"
      ) {

        await sendText(
          from,
          "ارسل موقعك"
        );

        await db.collection("temp")
          .doc(from)
          .set({
            service: id
          });

      }

      /*
      =====================
      قبول الفني
      =====================
      */

      if (id.startsWith("accept_")) {

        const orderId =
          id.replace("accept_", "");

        const order =
          await db.collection("orders")
          .doc(orderId).get();

        const data = order.data();

        await db.collection("orders")
          .doc(orderId)
          .update({
            status: "accepted"
          });

        await sendText(
          data.customerPhone,
          "تم قبول طلبك"
        );

      }

    }

    /*
    =====================
    استقبال الموقع
    =====================
    */

    if (msg.location) {

      const temp =
        await db.collection("temp")
        .doc(from)
        .get();

      const service =
        temp.data().service;

      const location =
        `https://maps.google.com/?q=${msg.location.latitude},${msg.location.longitude}`;

      const orderRef =
        await db.collection("orders")
        .add({
          customerPhone: from,
          service,
          location,
          status: "pending"
        });

      await sendText(
        from,
        "تم ارسال الطلب"
      );

      /*
      =====================
      البحث عن الفني
      =====================
      */

      const tech =
        await db.collection("technicians")
        .where("service","==",service)
        .where("status","==","available")
        .limit(1)
        .get();

      if (!tech.empty) {

        const techPhone =
          tech.docs[0].data().phone;

        await sendTechnician(
          techPhone,
          orderRef.id,
          location
        );

      }

    }

    res.sendStatus(200);

  }
  catch(err) {

    console.log(err.message);

    res.sendStatus(200);

  }

});


/*
=========================
تشغيل
=========================
*/

app.listen(3000, () =>
  console.log("Running V3")
);
