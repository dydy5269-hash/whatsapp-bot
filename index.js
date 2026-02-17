const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const admin = require("firebase-admin");
const path = require("path");

const app = express();

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// ================= FIREBASE =================

const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

console.log("Firebase connected");

// ================= WHATSAPP VARS =================

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// ================= WEBHOOK VERIFY =================

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

// ================= RECEIVE MESSAGE =================

app.post("/webhook", async (req, res) => {

  try {

    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body || "";

    console.log("Message:", text);

    // Save order to Firebase
    const orderRef = await db.collection("orders").add({

      phone: from,
      text: text,
      status: "pending",
      createdAt: new Date(),

    });

    // send confirmation
    await sendMessage(from,
      "✅ تم استلام طلبك بنجاح\n" +
      "رقم الطلب: " + orderRef.id
    );

    // send to technician
    await notifyTechnicians(orderRef.id, text, from);

    res.sendStatus(200);

  } catch (error) {

    console.error(error);
    res.sendStatus(500);

  }

});

// ================= SEND MESSAGE =================

async function sendMessage(to, text) {

  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: to,
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

// ================= NOTIFY TECHNICIANS =================

async function notifyTechnicians(orderId, serviceText, customerPhone) {

  const snapshot = await db.collection("technicians").get();

  snapshot.forEach(async (doc) => {

    const tech = doc.data();

    await sendMessage(
      tech.phone,
      "🔧 طلب جديد\n\n" +
      "الخدمة: " + serviceText + "\n" +
      "رقم العميل: " + customerPhone + "\n\n" +
      "للقبول ارسل:\n" +
      "accept " + orderId + "\n\n" +
      "للرفض ارسل:\n" +
      "reject " + orderId
    );

  });

}

// ================= DASHBOARD API =================

// get services
app.get("/api/services", async (req, res) => {

  const snapshot = await db.collection("services").get();

  let list = [];

  snapshot.forEach(doc => {
    list.push({ id: doc.id, ...doc.data() });
  });

  res.json(list);

});

// add service
app.post("/api/services", async (req, res) => {

  const { name } = req.body;

  await db.collection("services").add({
    name
  });

  res.json({ success: true });

});

// get technicians
app.get("/api/technicians", async (req, res) => {

  const snapshot = await db.collection("technicians").get();

  let list = [];

  snapshot.forEach(doc => {
    list.push({ id: doc.id, ...doc.data() });
  });

  res.json(list);

});

// add technician
app.post("/api/technicians", async (req, res) => {

  const { name, phone, service } = req.body;

  await db.collection("technicians").add({
    name,
    phone,
    service
  });

  res.json({ success: true });

});

// get orders
app.get("/api/orders", async (req, res) => {

  const snapshot = await db.collection("orders")
    .orderBy("createdAt", "desc")
    .get();

  let list = [];

  snapshot.forEach(doc => {
    list.push({ id: doc.id, ...doc.data() });
  });

  res.json(list);

});

// ================= DASHBOARD PAGE =================

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public/dashboard.html"));
});

// ================= START SERVER =================

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {

  console.log("Server running on port", PORT);

});
