const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");

const app = express();
app.use(express.json());
app.use(express.static("public"));

/* Firebase init */

let serviceAccount;

try {
  const decoded = Buffer.from(process.env.FIREBASE_KEY, "base64").toString("utf8");
  serviceAccount = JSON.parse(decoded);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  console.log("Firebase connected");
} catch (e) {
  console.log("Firebase error", e);
}

const db = admin.firestore();

/* WhatsApp config */

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

/* webhook verify */

app.get("/webhook", (req, res) => {

  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    res.send(challenge);
  } else {
    res.sendStatus(403);
  }
});

/* receive messages */

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

    console.log("Message:", text);

    if (text === "مرحبا") {

      const servicesSnapshot = await db.collection("services").get();

      let services = [];

      servicesSnapshot.forEach(doc => {
        services.push(doc.data().name);
      });

      await sendList(from, services);

    } else {

      const techSnapshot = await db
        .collection("technicians")
        .where("service", "==", text)
        .get();

      if (techSnapshot.empty) {

        await sendText(from, "لا يوجد فني متاح حالياً");

      } else {

        const tech = techSnapshot.docs[0].data();

        await db.collection("orders").add({

          phone: from,
          service: text,
          technician: tech.name,
          technicianPhone: tech.phone,
          status: "pending",
          createdAt: new Date()

        });

        await sendText(from, "تم ارسال طلبك بنجاح");
      }
    }

    res.sendStatus(200);

  } catch (e) {

    console.log(e);
    res.sendStatus(500);
  }

});

/* send text */

async function sendText(to, body) {

  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body }
    },
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

/* send list */

async function sendList(to, services) {

  const rows = services.map(service => ({
    id: service,
    title: service
  }));

  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text: "اختر الخدمة"
        },
        action: {
          button: "عرض",
          sections: [
            {
              title: "الخدمات",
              rows
            }
          ]
        }
      }
    },
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

/* start server */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
