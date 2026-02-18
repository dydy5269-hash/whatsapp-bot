const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());
app.use(express.static("public"));

/* =========================
   ENV
========================= */

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

console.log("SYSTEM READY");

/* =========================
   SEND MESSAGE
========================= */

async function sendMessage(phone, text) {

  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: phone,
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );

}

/* =========================
   GET SERVICES
========================= */

async function getServices() {

  const snapshot = await db.collection("services")
    .where("active", "==", true)
    .get();

  let text = "اختر الخدمة:\n";

  snapshot.forEach(doc => {

    const s = doc.data();

    text += `${doc.id} - ${s.name} (${s.price} ر.ع)\n`;

  });

  return text;

}

/* =========================
   FIND TECHNICIAN
========================= */

async function findAvailableTechnician() {

  const snapshot = await db.collection("technicians")
    .where("active", "==", true)
    .where("balance", ">", 0)
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  return snapshot.docs[0];

}

/* =========================
   CREATE ORDER
========================= */

async function createOrder(customerPhone, serviceId) {

  const serviceDoc =
    await db.collection("services").doc(serviceId).get();

  if (!serviceDoc.exists) {

    await sendMessage(customerPhone, "الخدمة غير موجودة");

    return;

  }

  const techDoc = await findAvailableTechnician();

  if (!techDoc) {

    await sendMessage(customerPhone,
      "لا يوجد فني متاح حالياً"
    );

    return;

  }

  const service = serviceDoc.data();
  const tech = techDoc.data();

  const orderRef =
    await db.collection("orders").add({

      customerPhone,
      serviceId,
      technicianId: techDoc.id,
      technicianPhone: tech.phone,
      price: service.price,
      status: "pending",
      createdAt: Date.now()

    });

  await sendMessage(customerPhone,
    "تم إرسال الطلب إلى الفني"
  );

  await sendMessage(tech.phone,
    `طلب جديد\nالخدمة: ${service.name}\nاكتب ACCEPT ${orderRef.id}`
  );

}

/* =========================
   ACCEPT ORDER
========================= */

async function acceptOrder(phone, orderId) {

  const orderRef =
    db.collection("orders").doc(orderId);

  const orderDoc = await orderRef.get();

  if (!orderDoc.exists) return;

  const order = orderDoc.data();

  if (order.technicianPhone !== phone) return;

  const techRef =
    db.collection("technicians").doc(order.technicianId);

  const techDoc = await techRef.get();

  const tech = techDoc.data();

  if (tech.balance <= 0) {

    await sendMessage(phone,
      "رصيدك انتهى. يرجى تعبئة الرصيد"
    );

    return;

  }

  // خصم 1 ريال عمولة
  await techRef.update({

    balance: tech.balance - 1

  });

  await orderRef.update({

    status: "accepted"

  });

  await sendMessage(order.customerPhone,
    "تم قبول الطلب من الفني"
  );

}

/* =========================
   COMPLETE ORDER
========================= */

async function completeOrder(phone, orderId) {

  const orderRef =
    db.collection("orders").doc(orderId);

  const orderDoc = await orderRef.get();

  if (!orderDoc.exists) return;

  const order = orderDoc.data();

  if (order.technicianPhone !== phone) return;

  await orderRef.update({

    status: "completed"

  });

  await sendMessage(order.customerPhone,
    "تم إنهاء الخدمة"
  );

}

/* =========================
   WEBHOOK VERIFY
========================= */

app.get("/webhook", (req, res) => {

  if (
    req.query["hub.verify_token"] === VERIFY_TOKEN
  ) {

    res.send(req.query["hub.challenge"]);

  }
  else {

    res.sendStatus(403);

  }

});

/* =========================
   RECEIVE MESSAGE
========================= */

app.post("/webhook", async (req, res) => {

  try {

    const msg =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!msg) return res.sendStatus(200);

    const phone = msg.from;
    const text = msg.text?.body;

    console.log(phone, text);

    if (text === "مرحبا") {

      const services = await getServices();

      await sendMessage(phone, services);

    }
    else if (text.startsWith("ACCEPT")) {

      const id = text.split(" ")[1];

      await acceptOrder(phone, id);

    }
    else if (text.startsWith("DONE")) {

      const id = text.split(" ")[1];

      await completeOrder(phone, id);

    }
    else {

      await createOrder(phone, text);

    }

    res.sendStatus(200);

  }
  catch (e) {

    console.error(e);

    res.sendStatus(500);

  }

});

/* =========================
   START
========================= */

const PORT = process.env.PORT || 8080;

app.listen(PORT, () =>
  console.log("SERVER RUNNING")
);
