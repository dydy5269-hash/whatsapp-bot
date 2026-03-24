import express from "express";
import fetch from "node-fetch";
import admin from "firebase-admin";

const app = express();
app.use(express.json());

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY))
});

const db = admin.firestore();

const users = {};

async function getServices() {
  const snapshot = await db.collection("services")
    .where("active", "==", true)
    .orderBy("order")
    .get();

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
}

async function sendMessage(to, text) {
  await fetch(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to,
      text: { body: text }
    })
  });
}

app.get("/webhook", (req, res) => {
  const verify_token = process.env.VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === verify_token) {
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body;

    if (!users[from]) users[from] = { step: "start" };

    let step = users[from].step;

    if (step === "start") {
      const services = await getServices();

      let menu = "مرحبا بك في روية طاقة ⚡\nاختر الخدمة:\n\n";

      services.forEach((s, i) => {
        menu += `${i + 1}️⃣ ${s.name}\n`;
      });

      users[from] = {
        step: "service",
        services
      };

      await sendMessage(from, menu);
    }

    else if (step === "service") {
      const services = users[from].services;
      const selected = services[text - 1];

      if (!selected) {
        await sendMessage(from, "❌ اختر رقم صحيح");
        return res.sendStatus(200);
      }

      users[from].selectedService = selected;
      users[from].step = "confirm";

      await sendMessage(from, `تم اختيار: ${selected.name}\n\nأرسل موقعك أو اكتب نعم للتأكيد`);
    }

    else if (step === "confirm") {
      await db.collection("orders").add({
        user: from,
        service: users[from].selectedService.name,
        status: "pending",
        createdAt: new Date()
      });

      await sendMessage(from, "✅ تم استلام طلبك، سيتم التواصل معك قريباً");

      users[from] = { step: "start" };
    }

    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
