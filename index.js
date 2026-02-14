const express = require("express");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

/*
====================================
تحميل مفتاح Firebase من Railway
====================================
*/

let serviceAccount;

try {

  if (!process.env.FIREBASE_KEY) {
    throw new Error("FIREBASE_KEY not found");
  }

  // فك Base64
  const decoded = Buffer.from(process.env.FIREBASE_KEY, "base64").toString("utf8");

  serviceAccount = JSON.parse(decoded);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  console.log("✅ Firebase connected");

} catch (error) {

  console.log("❌ Firebase error:", error.message);
  process.exit(1);

}

const db = admin.firestore();

/*
====================================
Webhook
====================================
*/

app.post("/webhook", async (req, res) => {

  try {

    const message = req.body.message;
    const from = req.body.from;

    if (!message) {
      return res.sendStatus(200);
    }

    console.log("Message:", message);

    /*
    ===========================
    طلب خدمة كهرباء
    ===========================
    */

    if (message === "كهرباء") {

      await db.collection("orders").add({

        customerPhone: from,
        service: "electricity",
        status: "pending",
        createdAt: new Date()

      });

      console.log("Order saved");

    }

    res.sendStatus(200);

  } catch (error) {

    console.log("Webhook error:", error);

    res.sendStatus(500);

  }

});

/*
====================================
تشغيل السيرفر
====================================
*/

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log("Server running on port", PORT);

});
