const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");
const path = require("path");

const app = express();
app.use(express.json());

/* ================================
   Firebase Setup
================================ */

let serviceAccount;

try {
  const decoded = Buffer.from(process.env.FIREBASE_KEY, "base64").toString("utf8");
  serviceAccount = JSON.parse(decoded);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  console.log("Firebase connected");

} catch (e) {
  console.error("Firebase error:", e);
}

const db = admin.firestore();

/* ================================
   WhatsApp Variables
================================ */

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

/* ================================
   Serve Dashboard
================================ */

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.send("WhatsApp Bot Running");
});

/* ================================
   Webhook Verify
================================ */

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

/* ================================
   Webhook Receive Message
================================ */

app.post("/webhook", async (req, res) => {

  try {

    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body;

    console.log("Message:", text);

    if (text === "مرحبا") {

      const servicesSnapshot = await db.collection("services").get();

      let list = "";

      servicesSnapshot.forEach(doc => {
        list += "• " + doc.data().name + "\n";
      });

      await sendMessage(from, "اختر الخدمة:\n\n" + list);

    } else {

      const techSnapshot = await db
        .collection("technicians")
        .where("service", "==", text)
        .where("available", "==", true)
        .get();

      if (techSnapshot.empty) {

        await sendMessage(from, "لا يوجد فني متاح حالياً");

      } else {

        const tech = techSnapshot.docs[0].data();

        await db.collection("orders").add({
          user: from,
          service: text,
          technician: tech.name,
          status: "pending",
          time: Date.now()
        });

        await sendMessage(from, "تم إرسال الطلب");

        await sendMessage(tech.phone, "طلب جديد: " + text);
      }
    }

    res.sendStatus(200);

  } catch (e) {

    console.error(e);
    res.sendStatus(500);
  }
});

/* ================================
   Send Message
================================ */

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
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

/* ================================
   IMPORTANT FOR RAILWAY
================================ */

const express = require("express");
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
  res.send("Bot is running");
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
