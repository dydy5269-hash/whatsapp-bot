const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "12345";
const TOKEN = "EAANB4MVrO8QBQmtvGF5Nr2ZBG89TaVRKaCZAb6bChTMZCw9yRpx53oQKdeMmExhkA0QnoZCPJuyLZCoBOTmFazZAkraIE41doBDWKnxZAeZBsdYeu0KtxyW9EZCffPYWZA3hZBnbjFnPyVU8WLyZC4KGZCfX2TQQ6k3kJqsGyc93ssGFz7SUdJCmcI4SHWj3CFofFsOZBUSWHRq5kPkGT8TFmXuqnAhonj3dAnWNsO58fpS4cxa99ueneudLYhm2vCgZBZBZCW7QU8DGZC6dRlnnZBiOUTlxx6EQnMOMQZDZD";
const PHONE_NUMBER_ID = "1373391824533735";

// Webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Receive messages
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (body.entry) {
      const message = body.entry[0].changes[0].value.messages[0];
      const from = message.from;

      await axios.post(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: from,
          text: { body: "مرحبا 👋 تم استلام رسالتك" }
        },
        {
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );
    }

    res.sendStatus(200);
  } catch (error) {
    console.error(error);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running...");
});

