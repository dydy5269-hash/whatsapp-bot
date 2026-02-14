const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");

const app = express();
app.use(express.json());

/*
=============================
تحميل Firebase من Railway
=============================
*/

let serviceAccount;

try {
  if (!process.env.FIREBASE_KEY) {
    throw new Error("FIREBASE_KEY not found");
  }

  const decoded = Buffer.from(process.env.FIREBASE_KEY, "base64").toString("utf8");
  serviceAccount = JSON.parse(decoded);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log("Firebase connected");

} catch (error) {
  console.error("Firebase error:", error.message);
}

/*
=============================
Webhook verification
=============================
*/

const VERIFY_TOKEN = "123456";

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

/*
=============================
Receive messages
=============================
*/

app.post("/webhook", async (req, res) => {

  try {

    const body = req.body;

    if (
      body.entry &&
      body.entry[0].changes &&
      body.entry[0].changes[0].value.messages
    ) {

      const message = body.entry[0].changes[0].value.messages[0];
      const from = message.from;
      const text = message.text.body;

      console.log("Message received:", text);

      // save to firebase
      await admin.firestore().collection("messages").add({
        from,
        text,
        createdAt: new Date(),
      });

      // reply message
      await sendMessage(from, "تم استلام رسالتك: " + text);

    }

    res.sendStatus(200);

  } catch (error) {
    console.error(error);
    res.sendStatus(500);
  }

});

/*
=============================
Send message function
=============================
*/

const WHATSAPP_TOKEN = "EAANB4MVrO8QBQvgjC56EljrypSBxulTZA2XCYkEXIXFAiqH1ODahbxRFw4zI2AZBwTEBI4kP4YD9GN2NQqNZCF7WMKAcQZBZCItZBJSSDzpMbYDh1qlpR273q9DVZCE1gVlEbap7r4wibyvZBLoBCx23oWNKZCUCd5IsnWv4pr77EtRojDQZA8ZADxhemVPGmUts6ofwUWQJmVfjRQDWg7TBZATKBwgKMGHwciVz6rVrzawnEJNjf2Q5fBMBThUTnEtiy0ZAQi7JqiF6eExJ1wri8tnc8zE4ZB";
const PHONE_NUMBER_ID = "962759303589757";

async function sendMessage(to, text) {

  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: to,
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

}

/*
=============================
Start server
=============================
*/

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
