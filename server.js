import express from "express";
import path from "path";
import axios from "axios";

const app = express();
app.use(express.json());

// ---------- ENV ----------
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// ---------- STATIC ----------
app.use(express.static(path.join(process.cwd(), "public")));

app.get("/", (req, res) => {
  res.send("🔥 Server is running");
});

// ---------- VERIFY ----------
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

// ---------- SEND MESSAGE ----------
async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
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

// ---------- WEBHOOK ----------
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body || "";

    console.log("📩 Message:", text);

    // 🔥 رد تلقائي
    await sendMessage(from, "🔥 تم استلام رسالتك: " + text);

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error:", err.response?.data || err.message);
    res.sendStatus(200);
  }
});

// ---------- START ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});