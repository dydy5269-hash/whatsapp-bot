// ================================
// WhatsApp Bot v5 FINAL
// Firebase + Dashboard + Orders
// ================================

const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ================================
// ENV VARIABLES
// ================================

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const FIREBASE_KEY = process.env.FIREBASE_KEY;

// ================================
// CHECK VARIABLES
// ================================

if (!VERIFY_TOKEN) throw new Error("VERIFY_TOKEN missing");
if (!WHATSAPP_TOKEN) throw new Error("WHATSAPP_TOKEN missing");
if (!PHONE_NUMBER_ID) throw new Error("PHONE_NUMBER_ID missing");
if (!FIREBASE_KEY) throw new Error("FIREBASE_KEY missing");

// ================================
// FIREBASE INIT
// ================================

const serviceAccount = JSON.parse(
  Buffer.from(FIREBASE_KEY, "base64").toString("utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

console.log("Firebase connected");

// ================================
// SEND WHATSAPP MESSAGE
// ================================

async function sendWhatsApp(to, message) {
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
}

// ================================
// SEND SERVICES LIST
// ================================

async function sendServices(to) {
  const snapshot = await db.collection("services").get();

  if (snapshot.empty) {
    await sendWhatsApp(to, "لا توجد خدمات حاليا");
    return;
  }

  let msg = "اختر الخدمة:\n\n";

  snapshot.forEach(doc => {
    const s = doc.data();
    msg += `${s.name}\n`;
  });

  await sendWhatsApp(to, msg);
}

// ================================
// FIND TECHNICIAN
// ================================

async function findTechnician(serviceName) {
  const snapshot = await db.collection("technicians")
    .where("service", "==", serviceName)
    .get();

  if (snapshot.empty) return null;

  return snapshot.docs[0].data();
}

// ================================
// CREATE ORDER
// ================================

async function createOrder(userPhone, serviceName) {

  const tech = await findTechnician(serviceName);

  if (!tech) {
    await sendWhatsApp(userPhone, "لا يوجد فني متاح حاليا");
    return;
  }

  const orderRef = await db.collection("orders").add({
    userPhone,
    technicianPhone: tech.phone,
    service: serviceName,
    status: "pending",
    createdAt: new Date()
  });

  await sendWhatsApp(userPhone,
    "تم إرسال طلبك، بانتظار موافقة الفني"
  );

  await sendWhatsApp(tech.phone,
    `طلب جديد:\nالخدمة: ${serviceName}\nالعميل: ${userPhone}\n\nاكتب:\naccept ${orderRef.id}\nأو\nreject ${orderRef.id}`
  );
}

// ================================
// ACCEPT ORDER
// ================================

async function acceptOrder(orderId, techPhone) {

  const ref = db.collection("orders").doc(orderId);
  const doc = await ref.get();

  if (!doc.exists) return;

  const order = doc.data();

  if (order.technicianPhone !== techPhone) return;

  await ref.update({
    status: "accepted"
  });

  await sendWhatsApp(order.userPhone,
    "تم قبول طلبك، الفني في الطريق"
  );
}

// ================================
// REJECT ORDER
// ================================

async function rejectOrder(orderId, techPhone) {

  const ref = db.collection("orders").doc(orderId);
  const doc = await ref.get();

  if (!doc.exists) return;

  const order = doc.data();

  if (order.technicianPhone !== techPhone) return;

  await ref.update({
    status: "rejected"
  });

  await sendWhatsApp(order.userPhone,
    "تم رفض الطلب"
  );
}

// ================================
// WEBHOOK VERIFY
// ================================

app.get("/webhook", (req, res) => {

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    res.send(challenge);
  } else {
    res.sendStatus(403);
  }

});

// ================================
// WEBHOOK RECEIVE
// ================================

app.post("/webhook", async (req, res) => {

  try {

    const msg =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body?.toLowerCase();

    console.log("Message:", text);

    if (text === "مرحبا") {
      await sendServices(from);
    }

    else if (text.startsWith("accept")) {

      const orderId = text.split(" ")[1];
      await acceptOrder(orderId, from);

    }

    else if (text.startsWith("reject")) {

      const orderId = text.split(" ")[1];
      await rejectOrder(orderId, from);

    }

    else {

      await createOrder(from, text);

    }

    res.sendStatus(200);

  } catch (e) {

    console.error(e);
    res.sendStatus(500);

  }

});

// ================================
// DASHBOARD
// ================================

app.get("/dashboard", async (req, res) => {

  const snapshot = await db.collection("orders").get();

  let html = `
  <h2>لوحة التحكم</h2>
  <table border="1" cellpadding="10">
  <tr>
  <th>الخدمة</th>
  <th>العميل</th>
  <th>الفني</th>
  <th>الحالة</th>
  </tr>
  `;

  snapshot.forEach(doc => {

    const d = doc.data();

    html += `
    <tr>
    <td>${d.service}</td>
    <td>${d.userPhone}</td>
    <td>${d.technicianPhone}</td>
    <td>${d.status}</td>
    </tr>
    `;
  });

  html += "</table>";

  res.send(html);

});

// ================================
// START SERVER
// ================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
