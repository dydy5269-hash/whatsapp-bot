import express from "express";
import fetch from "node-fetch";
import admin from "firebase-admin";

const app = express();

// مهم جداً
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// اختبار السيرفر
app.get("/", (req, res) => {
  res.send("Server is working ✅");
});

// Firebase
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY))
});

const db = admin.firestore();

// webhook verification
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// webhook receive
app.post("/webhook", async (req, res) => {
  try {
    console.log("🔥 Incoming webhook:", JSON.stringify(req.body));

    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body;

    await fetch(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: from,
        text: { body: "تم الاستلام ✅" }
      })
    });

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ ERROR:", err);
    res.sendStatus(500);
  }
});

// PORT مهم
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});
