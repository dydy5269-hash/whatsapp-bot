import express from "express";
import path from "path";

const app = express();
app.use(express.json());

// عرض ملفات HTML
app.use(express.static(path.join(process.cwd(), "public")));

// اختبار السيرفر
app.get("/", (req, res) => {
  res.send("🔥 Server is running");
});

// ---------- WEBHOOK VERIFY ----------
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "12345";

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// ---------- WEBHOOK RECEIVE ----------
app.post("/webhook", (req, res) => {
  console.log("📩 Incoming webhook:", JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});