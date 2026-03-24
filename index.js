import express from "express";
import fetch from "node-fetch";

const app = express();

app.use(express.json());

// 🧠 تخزين مؤقت بسيط
const userState = {};

app.get("/", (req, res) => {
  res.send("Server is working 🔥");
});

app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    const message =
      body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (message) {
      const from = message.from;
      const userText = message.text?.body?.toLowerCase();

      let reply = "";

      // 📌 إذا أول مرة
      if (!userState[from]) {
        if (userText === "مرحبا") {
          userState[from] = { step: "choose_service" };

          reply =
            "أهلاً 👋\nاختر الخدمة:\n1️⃣ كهرباء\n2️⃣ سباكة\n3️⃣ تكييف";
        } else {
          reply = "اكتب مرحبا 👋";
        }
      }

      // 📌 اختيار الخدمة
      else if (userState[from].step === "choose_service") {
        if (userText === "1") {
          userState[from] = { step: "done", service: "كهرباء" };
          reply = "تم اختيار خدمة الكهرباء ⚡";
        } else if (userText === "2") {
          userState[from] = { step: "done", service: "سباكة" };
          reply = "تم اختيار خدمة السباكة 🚿";
        } else if (userText === "3") {
          userState[from] = { step: "done", service: "تكييف" };
          reply = "تم اختيار خدمة التكييف ❄️";
        } else {
          reply = "اختر رقم صحيح (1 أو 2 أو 3)";
        }
      }

      // 📌 بعد الاختيار
      else if (userState[from].step === "done") {
        reply = `تم تسجيل طلبك (${userState[from].service}) ✅`;
      }

      await fetch(
        `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: from,
            text: { body: reply },
          }),
        }
      );
    }

    res.sendStatus(200);
  } catch (error) {
    console.error(error);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
