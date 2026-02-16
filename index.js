const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");

const app = express();
app.use(express.json());

/*
==================================
Firebase init from Railway ENV
==================================
*/

let serviceAccount;

try {
  if (!process.env.FIREBASE_KEY) {
    throw new Error("FIREBASE_KEY not found");
  }

  const decoded = Buffer.from(process.env.FIREBASE_KEY, "base64").toString("utf8");
  serviceAccount = JSON.parse(decoded);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  console.log("Firebase connected");

} catch (err) {
  console.error("Firebase error:", err.message);
}

const db = admin.firestore();

/*
==================================
WhatsApp settings
==================================
*/

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_ID;

const VERIFY_TOKEN = "123456";

/*
==================================
Webhook verify
==================================
*/

app.get("/webhook", (req, res) => {

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }

});

/*
==================================
Receive WhatsApp messages
==================================
*/

app.post("/webhook", async (req, res) => {

  try {

    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body || "";

    console.log("Message:", text);

    if (text === "مرحبا") {

      await sendMenu(from);

    } else {

      await createRequest(from, text);

    }

    res.sendStatus(200);

  } catch (err) {
    console.log(err);
    res.sendStatus(500);
  }

});

/*
==================================
Send menu
==================================
*/

async function sendMenu(to) {

  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: {
        body:
          "اختر الخدمة:\n\n" +
          "كهرباء ⚡\n" +
          "سباكة 🚿\n" +
          "تكييف ❄️"
      }
    },
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );

}

/*
==================================
Create request
==================================
*/

async function createRequest(userPhone, service) {

  const ref = await db.collection("requests").add({
    phone: userPhone,
    service: service,
    status: "pending",
    createdAt: Date.now()
  });

  await sendText(userPhone, "تم استلام طلبك ✅");

}

/*
==================================
Send text
==================================
*/

async function sendText(to, text) {

  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );

}

/*
==================================
Dashboard page
==================================
*/

app.get("/dashboard", async (req, res) => {

  const snapshot = await db
    .collection("requests")
    .orderBy("createdAt", "desc")
    .get();

  let html = `
  <html>
  <head>
  <title>لوحة التحكم</title>
  </head>
  <body>
  <h2>الطلبات</h2>
  <table border="1" cellpadding="10">
  <tr>
  <th>الهاتف</th>
  <th>الخدمة</th>
  <th>الحالة</th>
  <th>تغيير الحالة</th>
  </tr>
  `;

  snapshot.forEach(doc => {

    const data = doc.data();

    html += `
    <tr>
    <td>${data.phone}</td>
    <td>${data.service}</td>
    <td>${data.status}</td>
    <td>
      <a href="/accept/${doc.id}">قبول</a> |
      <a href="/reject/${doc.id}">رفض</a>
    </td>
    </tr>
    `;

  });

  html += "</table></body></html>";

  res.send(html);

});

/*
==================================
Accept request
==================================
*/

app.get("/accept/:id", async (req, res) => {

  const id = req.params.id;

  await db.collection("requests").doc(id).update({
    status: "accepted"
  });

  res.redirect("/dashboard");

});

/*
==================================
Reject request
==================================
*/

app.get("/reject/:id", async (req, res) => {

  const id = req.params.id;

  await db.collection("requests").doc(id).update({
    status: "rejected"
  });

  res.redirect("/dashboard");

});

/*
==================================
Start server
==================================
*/

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
