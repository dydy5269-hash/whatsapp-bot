import express from "express";
import axios from "axios";
import admin from "firebase-admin";

const app = express();
app.use(express.json());
app.use(express.static("public"));

// ---------- FIREBASE ----------
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY))
});
const db = admin.firestore();

// ---------- ENV ----------
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// ---------- STATE ----------
const userState = {};
const userData = {};

// ---------- HELPERS ----------
function normalizePhone(phone) {
  return phone.replace("+", "");
}

async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: text }
    },
    {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    }
  );
}

async function sendList(to, bodyText, buttonText, sections) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: bodyText },
        action: { button: buttonText, sections }
      }
    },
    {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    }
  );
}

// ---------- DB ----------
async function getServices() {
  const snap = await db.collection("services").get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getTechnicianByPhone(phone) {
  const snap = await db.collection("technicians").where("phone", "==", phone).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// 🔥 جلب كل الفنيين المناسبين
async function getAllTechs(serviceId) {
  const snap = await db.collection("technicians")
    .where("services", "array-contains", serviceId)
    .where("active", "==", true)
    .get();

  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ---------- ADMIN ----------
app.get("/admin/dashboard", async (req, res) => {
  const ordersSnap = await db.collection("orders").get();
  const techSnap = await db.collection("technicians").get();

  let available = 0;
  let busy = 0;

  techSnap.forEach(doc => {
    if (doc.data().active) available++;
    else busy++;
  });

  res.json({
    totalOrders: ordersSnap.size,
    totalTechs: techSnap.size,
    available,
    busy
  });
});

// ---------- VERIFY ----------
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN)
    return res.send(req.query["hub.challenge"]);
  return res.sendStatus(403);
});

// ---------- WEBHOOK ----------
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = normalizePhone(msg.from);
    let text = "";

    if (msg.type === "text") text = msg.text.body.trim();
    else if (msg.type === "interactive") {
      text =
        msg.interactive?.list_reply?.id ||
        msg.interactive?.button_reply?.id;
    }

    // ---------- تحديث موقع الفني ----------
    if (msg.type === "location") {
      const tech = await getTechnicianByPhone(from);
      if (tech) {
        await db.collection("technicians").doc(tech.id).update({
          location: {
            lat: msg.location.latitude,
            lng: msg.location.longitude
          }
        });
      }
    }

    // ---------- قبول ----------
    if (text.startsWith("accept_")) {
      const id = text.split("_")[1];
      const ref = db.collection("orders").doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.sendStatus(200);

      const order = snap.data();

      if (order.status !== "pending") {
        await sendMessage(from, "❌ تم أخذ الطلب");
        return res.sendStatus(200);
      }

      await ref.update({ status: "accepted" });

      await db.collection("technicians").doc(order.technicianId).update({
        active: false
      });

      await sendMessage(order.customer, "🚗 الفني في الطريق");

      await sendList(
        from,
        "اختر الحالة",
        "حالة",
        [{
          title: "التحديث",
          rows: [
            { id: `onway_${id}`, title: "🚗 في الطريق" },
            { id: `arrived_${id}`, title: "📍 وصلت" },
            { id: `done_${id}`, title: "✅ تم" }
          ]
        }]
      );

      return res.sendStatus(200);
    }

    // ---------- حالات ----------
    if (text.startsWith("onway_") || text.startsWith("arrived_") || text.startsWith("done_")) {
      const id = text.split("_")[1];
      const ref = db.collection("orders").doc(id);
      const snap = await ref.get();
      const order = snap.data();

      if (text.startsWith("onway_")) {
        await ref.update({ status: "on_the_way" });
        await sendMessage(order.customer, "🚗 في الطريق");
      }

      if (text.startsWith("arrived_")) {
        await ref.update({ status: "arrived" });
        await sendMessage(order.customer, "📍 وصل الفني");
      }

      if (text.startsWith("done_")) {
        await ref.update({ status: "done" });

        await db.collection("technicians").doc(order.technicianId).update({
          active: true
        });

        // 💰 عمولة
        const commission = order.price * 0.1;
        await db.collection("technicians").doc(order.technicianId).update({
          balance: admin.firestore.FieldValue.increment(-commission)
        });

        await sendMessage(order.customer, "⭐ قيّم الخدمة");

        await sendList(order.customer, "التقييم", "اختر", [{
          title: "التقييم",
          rows: [
            { id: `rate_5_${id}`, title: "⭐⭐⭐⭐⭐" },
            { id: `rate_4_${id}`, title: "⭐⭐⭐⭐" }
          ]
        }]);
      }

      return res.sendStatus(200);
    }

    // ---------- تقييم ----------
    if (text.startsWith("rate_")) {
      await sendMessage(from, "🙏 شكراً");
      return res.sendStatus(200);
    }

    // ---------- البداية ----------
    if (!userState[from] || text === "مرحبا") {
      const services = await getServices();

      userState[from] = "main";

      await sendList(from, "اختر خدمة", "خدمات", [{
        title: "القائمة",
        rows: services.map(s => ({
          id: "service_" + s.id,
          title: s.name
        }))
      }]);

      return res.sendStatus(200);
    }

    // ---------- اختيار خدمة ----------
    if (userState[from] === "main") {
      const services = await getServices();
      const service = services.find(s => s.id === text.replace("service_", ""));

      userData[from] = service;
      userState[from] = "confirm";

      await sendList(from, "تأكيد؟", "تأكيد", [{
        title: "تأكيد",
        rows: [
          { id: "yes", title: "✅ نعم" },
          { id: "no", title: "❌ لا" }
        ]
      }]);

      return res.sendStatus(200);
    }

    // ---------- تأكيد ----------
    if (userState[from] === "confirm") {
      if (text === "yes") {
        userState[from] = "location";
        await sendMessage(from, "📍 أرسل الموقع");
      } else {
        delete userState[from];
      }
      return res.sendStatus(200);
    }

    // ---------- الموقع ----------
    if (userState[from] === "location") {
      if (msg.type !== "location") return res.sendStatus(200);

      const service = userData[from];
      const techs = await getAllTechs(service.id);

      if (techs.length === 0) {
        await sendMessage(from, "❌ لا يوجد فني");
        return res.sendStatus(200);
      }

      const orderRef = await db.collection("orders").add({
        customer: from,
        serviceName: service.name,
        price: service.types?.[0]?.price || 0,
        technicianId: techs[0].id,
        status: "pending"
      });

      const orderId = orderRef.id;

      // 🚀 إرسال لجميع الفنيين
      for (const tech of techs) {
        await sendList(
          tech.phone,
          `📥 طلب جديد ${service.name}`,
          "تنفيذ",
          [{
            title: "الطلب",
            rows: [
              { id: `accept_${orderId}`, title: "✅ قبول" }
            ]
          }]
        );
      }

      await sendMessage(from, "🚀 تم إرسال الطلب");

      delete userState[from];
      delete userData[from];

      return res.sendStatus(200);
    }

    return res.sendStatus(200);

  } catch (err) {
    console.log(err);
    return res.sendStatus(200);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running...");
});