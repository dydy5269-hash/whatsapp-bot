const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());
app.use(express.static("public"));

/* ==========================
   ENV VARIABLES
========================== */

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const FIREBASE_KEY = process.env.FIREBASE_KEY;

/* ==========================
   FIREBASE INIT (FIXED)
========================== */

if (!FIREBASE_KEY) {
  console.error("FIREBASE_KEY missing");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(FIREBASE_KEY))
});

const db = admin.firestore();

/* ==========================
   WEBHOOK VERIFICATION
========================== */

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook Verified");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

/* ==========================
   RECEIVE WHATSAPP MESSAGE
========================== */

app.post("/webhook", async (req, res) => {
  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const customerPhone = message.from;
    const text = message.text?.body || "طلب بدون نص";

    console.log("Incoming:", text);

    const orderRef = await db.collection("orders").add({
      customerPhone,
      text,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await assignOrder(orderRef.id, customerPhone, text);

    res.sendStatus(200);

  } catch (err) {
    console.error("Webhook Error:", err.response?.data || err.message);
    res.sendStatus(500);
  }
});

/* ==========================
   ASSIGN ORDER
========================== */

async function assignOrder(orderId, customerPhone, text) {
  const snapshot = await db.collection("technicians")
    .where("balance", ">", 0)
    .limit(1)
    .get();

  if (snapshot.empty) {
    await sendMessage(customerPhone, "لا يوجد فني متاح حالياً ❌");
    return;
  }

  const techDoc = snapshot.docs[0];
  const tech = techDoc.data();
  const techId = techDoc.id;

  await db.collection("technicians")
    .doc(techId)
    .update({ balance: tech.balance - 1 });

  await db.collection("orders")
    .doc(orderId)
    .update({
      technicianId: techId,
      technicianPhone: tech.phone,
      status: "assigned"
    });

  await sendMessage(
    tech.phone,
    `🚨 طلب جديد\n\nالعميل: ${customerPhone}\nالوصف: ${text}`
  );

  await sendMessage(
    customerPhone,
    "✅ تم تعيين فني لطلبك"
  );
}

/* ==========================
   SEND MESSAGE (SAFE)
========================== */

async function sendMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text }
      },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (err) {
    console.error("Send Error:", err.response?.data || err.message);
  }
}

/* ==========================
   API ROUTES
========================== */

app.get("/api/orders", async (req, res) => {
  const snapshot = await db.collection("orders").get();
  res.json(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
});

app.get("/api/technicians", async (req, res) => {
  const snapshot = await db.collection("technicians").get();
  res.json(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
});

app.post("/api/technicians", async (req, res) => {
  await db.collection("technicians").add(req.body);
  res.sendStatus(200);
});

app.post("/api/services", async (req, res) => {
  await db.collection("services").add(req.body);
  res.sendStatus(200);
});

app.post("/api/parts", async (req, res) => {
  await db.collection("parts").add(req.body);
  res.sendStatus(200);
});

/* ==========================
   START SERVER
========================== */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("SYSTEM READY ON PORT", PORT);
});
