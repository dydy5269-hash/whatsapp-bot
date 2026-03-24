import express from "express";
import fetch from "node-fetch";

const app = express();

app.use(express.json());

// test route
app.get("/", (req, res) => {
  res.send("Server is working 🔥");
});

// webhook verification (Meta)
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified ✅");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// webhook receive messages
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    console.log("Incoming:", JSON.stringify(body, null, 2));

    const message =
      body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (message) {
      const from = message.from;

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
            text: { body: "تم الاستلام ✅" },
          }),
        }
      );

      console.log("Reply sent ✅");
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Error:", error);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
