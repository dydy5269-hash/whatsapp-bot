// =====================================
// WhatsApp Service System - FINAL v6
// Firebase + Dashboard + Full Control
// =====================================

const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// =====================================
// ENV VARIABLES
// =====================================

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const FIREBASE_KEY = process.env.FIREBASE_KEY;

if (!VERIFY_TOKEN) throw new Error("VERIFY_TOKEN missing");
if (!WHATSAPP_TOKEN) throw new Error("WHATSAPP_TOKEN missing");
if (!PHONE_NUMBER_ID) throw new Error("PHONE_NUMBER_ID missing");
if (!FIREBASE_KEY) throw new Error("FIREBASE_KEY missing");

// =====================================
// FIREBASE INIT
// =====================================

const serviceAccount = JSON.parse(
  Buffer.from(FIREBASE_KEY, "base64").toString("utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

console.log("Firebase connected");

// =====================================
// SEND WHATSAPP MESSAGE
// =====================================

async function sendWhatsApp(to, message) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.log("WhatsApp send error:", error.response?.data || error.message);
  }
}

// =====================================
// WEBHOOK VERIFY
// =====================================

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

// =====================================
// WEBHOOK RECEIVE
// =====================================

app.post("/webhook", async (req, res) => {

  try {

    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body?.trim();

    console.log("Message received:", text);

    if (text === "مرحبا") {

      const servicesSnap = await db.collection("services").get();

      if (servicesSnap.empty) {

        await sendWhatsApp(from, "لا توجد خدمات حاليا");

      } else {

        let msg = "اختر الخدمة:\n\n";

        servicesSnap.forEach(doc => {
          msg += `${doc.data().name}\n`;
        });

        await sendWhatsApp(from, msg);

      }

    } else {

      await createOrder(from, text);

    }

    res.sendStatus(200);

  } catch (error) {

    console.log(error);
    res.sendStatus(500);

  }

});

// =====================================
// CREATE ORDER
// =====================================

async function createOrder(userPhone, serviceName) {

  const techSnap = await db
    .collection("technicians")
    .where("service", "==", serviceName)
    .where("available", "==", true)
    .limit(1)
    .get();

  let technician = null;

  if (!techSnap.empty) {

    technician = techSnap.docs[0].data();

    await sendWhatsApp(
      technician.phone,
      `طلب جديد\nالخدمة: ${serviceName}\nالعميل: ${userPhone}`
    );

  }

  await db.collection("orders").add({

    phone: userPhone,
    service: serviceName,
    technician: technician?.name || null,
    technicianPhone: technician?.phone || null,
    status: technician ? "assigned" : "pending",
    createdAt: new Date(),

  });

  await sendWhatsApp(
    userPhone,
    technician
      ? "تم إرسال الطلب للفني"
      : "تم استلام الطلب، سيتم تعيين فني قريباً"
  );

}

// =====================================
// DASHBOARD ROUTES
// =====================================

// services

app.get("/api/services", async (req, res) => {

  const snap = await db.collection("services").get();

  const data = snap.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  res.json(data);

});

app.post("/api/services", async (req, res) => {

  const { name } = req.body;

  await db.collection("services").add({
    name,
    createdAt: new Date()
  });

  res.sendStatus(200);

});

// technicians

app.get("/api/technicians", async (req, res) => {

  const snap = await db.collection("technicians").get();

  const data = snap.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  res.json(data);

});

app.post("/api/technicians", async (req, res) => {

  const { name, phone, service } = req.body;

  await db.collection("technicians").add({
    name,
    phone,
    service,
    available: true,
    createdAt: new Date()
  });

  res.sendStatus(200);

});

// orders

app.get("/api/orders", async (req, res) => {

  const snap = await db.collection("orders")
    .orderBy("createdAt", "desc")
    .get();

  const data = snap.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  res.json(data);

});

// UPDATE ORDER STATUS

app.put("/api/orders/:id", async (req, res) => {

  try {

    const id = req.params.id;
    const status = req.body.status;

    const ref = db.collection("orders").doc(id);
    const doc = await ref.get();

    if (!doc.exists)
      return res.status(404).send("Not found");

    const order = doc.data();

    await ref.update({ status });

    if (status === "accepted") {

      await sendWhatsApp(
        order.phone,
        "تم قبول طلبك ✅ الفني في الطريق"
      );

    }

    if (status === "rejected") {

      await sendWhatsApp(
        order.phone,
        "تم رفض الطلب ❌"
      );

    }

    res.sendStatus(200);

  } catch (e) {

    console.log(e);
    res.sendStatus(500);

  }

});

// =====================================
// START SERVER
// =====================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
