const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");

const app = express();
app.use(express.json());

/*
================================
Firebase Init
================================
*/

let serviceAccount;

try {
  if (!process.env.FIREBASE_KEY) {
    throw new Error("FIREBASE_KEY not found");
  }

  const decoded = Buffer.from(
    process.env.FIREBASE_KEY,
    "base64"
  ).toString("utf8");

  serviceAccount = JSON.parse(decoded);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log("Firebase connected");
} catch (e) {
  console.error(e);
}

const db = admin.firestore();

/*
================================
WhatsApp Config
================================
*/

const TOKEN =
  "PUT_YOUR_TOKEN_HERE";

const PHONE_NUMBER_ID =
  "PUT_YOUR_PHONE_NUMBER_ID_HERE";

/*
================================
Send WhatsApp Message
================================
*/

async function sendWhatsApp(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (e) {
    console.log("Send error", e.response?.data);
  }
}

/*
================================
Webhook Verify
================================
*/

app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = "123456";

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    res.send(challenge);
  } else {
    res.sendStatus(403);
  }
});

/*
================================
Webhook Receive
================================
*/

app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body;

    console.log("Message:", from, text);

    await handleUserMessage(from, text);

    res.sendStatus(200);
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

/*
================================
Handle Message Logic
================================
*/

async function handleUserMessage(phone, text) {
  text = text.trim();

  // مرحبا
  if (text === "مرحبا") {
    await sendWhatsApp(
      phone,
      "اختر الخدمة:\n\nكهرباء\nسباكة\nتكييف"
    );
    return;
  }

  // check services
  const services = await db
    .collection("services")
    .where("active", "==", true)
    .get();

  let found = null;

  services.forEach((doc) => {
    if (doc.data().name === text) {
      found = doc.data();
    }
  });

  if (!found) return;

  // create request
  const requestRef = await db.collection("requests").add({
    phone: phone,
    service: text,
    status: "pending",
    createdAt: Date.now(),
  });

  // find technician
  const techSnap = await db
    .collection("technicians")
    .where("service", "==", text)
    .where("active", "==", true)
    .limit(1)
    .get();

  if (techSnap.empty) {
    await sendWhatsApp(
      phone,
      "لا يوجد فني متاح حالياً"
    );
    return;
  }

  const tech = techSnap.docs[0];

  await requestRef.update({
    technicianId: tech.id,
  });

  const techData = tech.data();

  await sendWhatsApp(
    techData.phone,
    `طلب جديد\n\nالخدمة: ${text}\nالعميل: ${phone}\n\nاكتب:\nقبول\nاو\nرفض`
  );

  await sendWhatsApp(
    phone,
    "تم إرسال الطلب للفني"
  );
}

/*
================================
Technician Reply
================================
*/

app.post("/technician-reply", async (req, res) => {
  const phone = req.body.phone;
  const text = req.body.text;

  const techSnap = await db
    .collection("technicians")
    .where("phone", "==", phone)
    .limit(1)
    .get();

  if (techSnap.empty) return res.send("no tech");

  const techId = techSnap.docs[0].id;

  const requestSnap = await db
    .collection("requests")
    .where("technicianId", "==", techId)
    .where("status", "==", "pending")
    .limit(1)
    .get();

  if (requestSnap.empty) return res.send("no request");

  const request = requestSnap.docs[0];

  if (text === "قبول") {
    await request.ref.update({
      status: "accepted",
    });

    await sendWhatsApp(
      request.data().phone,
      "تم قبول طلبك من الفني"
    );
  }

  if (text === "رفض") {
    await request.ref.update({
      status: "رفض",
    });

    await sendWhatsApp(
      request.data().phone,
      "تم رفض الطلب"
    );
  }

  res.send("ok");
}

/*
================================
Dashboard
================================
*/

app.get("/dashboard", async (req, res) => {
  const snap = await db.collection("requests").get();

  let html = `
  <h1>لوحة التحكم</h1>
  <table border="1">
  <tr>
  <th>الهاتف</th>
  <th>الخدمة</th>
  <th>الحالة</th>
  </tr>
  `;

  snap.forEach((doc) => {
    const d = doc.data();

    html += `
    <tr>
    <td>${d.phone}</td>
    <td>${d.service}</td>
    <td>${d.status}</td>
    </tr>
    `;
  });

  html += "</table>";

  res.send(html);
});

/*
================================
Start Server
================================
*/

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running");
});
