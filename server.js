import express from "express";
import axios from "axios";
import admin from "firebase-admin";

const app = express();
app.use(express.json());
app.use(express.static("public"));

// ---------- FIREBASE ----------
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY))
  });
}
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
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
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
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
}

// ---------- DATABASE ----------
async function getServices() {
  const snap = await db.collection("services").get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function getTechnicianByPhone(phone) {
  const snap = await db.collection("technicians").where("phone", "==", phone).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ---------- SMART DISTRIBUTION ----------
async function getTech(serviceId, customerLocation = null) {
  const snap = await db
    .collection("technicians")
    .where("services", "array-contains", serviceId)
    .where("active", "==", true)
    .get();

  if (snap.empty) return null;

  let techs = snap.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  // ترتيب حسب التقييم
  techs.sort((a, b) => (b.rating || 0) - (a.rating || 0));

  return techs[0];
}

// ---------- ADMIN ----------
app.get("/admin/dashboard", async (req, res) => {
  const ordersSnap = await db.collection("orders").orderBy("createdAt", "desc").get();
  const techSnap = await db.collection("technicians").get();

  let available = 0;
  let busy = 0;

  const technicians = techSnap.docs.map(doc => {
    const t = doc.data();
    if (t.active) available++;
    else busy++;
    return { id: doc.id, ...t };
  });

  const orders = ordersSnap.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      serviceName: d.serviceName || "غير محدد",
      status: d.status || "new",
      price: d.price || 0,
      customer: d.customer || ""
    };
  });

  res.json({
    totalOrders: orders.length,
    totalTechs: technicians.length,
    available,
    busy,
    orders,
    technicians
  });
});

// ---------- VERIFY ----------
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
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
      text = msg.interactive.list_reply?.id || msg.interactive.button_reply?.id;
    }

    // ===== TECH LOGIN =====
    const tech = await getTechnicianByPhone(from);
    if (tech && text === "مرحبا") {
      await sendMessage(from, `👨‍🔧 ${tech.name}\n⭐ ${tech.rating}\n💰 ${tech.balance}`);
      return res.sendStatus(200);
    }

    // ===== START =====
    if (!userState[from] || text === "مرحبا") {
      userState[from] = "main";
      const services = await getServices();

      await sendList(from, "👋 اختر الخدمة التي توفرها رؤية طاقة للخدمات للعملائها بادارة عمانيه ", "الخدمات", [{
        title: "القائمة",
        rows: services.map(s => ({
          id: "service_" + s.id,
          title: s.name.substring(0, 24)
        }))
      }]);

      return res.sendStatus(200);
    }

    // ===== SERVICE =====
    if (userState[from] === "main") {
      const services = await getServices();
      const id = text.replace("service_", "");
      const service = services.find(s => s.id === id);

      userData[from] = service;
      userState[from] = "type";

      await sendList(from, service.name, "الأنواع", [{
        title: "اختر",
        rows: service.types.map((t, i) => ({
          id: "type_" + i,
          title: t.name.substring(0, 24)
        }))
      }]);

      return res.sendStatus(200);
    }

    // ===== TYPE =====
    if (userState[from] === "type") {
      const index = parseInt(text.replace("type_", ""));
      const type = userData[from].types[index];

      userData[from].selectedType = type;
      userState[from] = "confirm";

      await sendList(from, `${type.name}\n${type.price} ريال`, "تأكيد", [{
        title: "تأكيد",
        rows: [
          { id: "confirm_yes", title: "✅ تأكيد" },
          { id: "confirm_no", title: "❌ إلغاء" }
        ]
      }]);

      return res.sendStatus(200);
    }

    // ===== CONFIRM =====
    if (userState[from] === "confirm") {
      if (text === "confirm_no") {
        delete userState[from];
        return sendMessage(from, "❌ تم الإلغاء");
      }

      if (text === "confirm_yes") {
        userState[from] = "location";
        return sendMessage(from, "📍 أرسل موقعك");
      }
    }

    // ===== LOCATION =====
    if (userState[from] === "location") {
      if (msg.type !== "location") {
        return sendMessage(from, "📍 أرسل الموقع");
      }

      const service = userData[from];
      const tech = await getTech(service.id, msg.location);

      if (!tech) return sendMessage(from, "❌ لا يوجد فني");

      const orderRef = await db.collection("orders").add({
        customer: from,
        serviceName: service.name || "غير محدد",
        price: service.selectedType?.price || 0,
        technicianId: tech.id,
        status: "pending",
        location: msg.location,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      const orderId = orderRef.id;

      await sendMessage(
        tech.phone,
        `📥 طلب جديد\n${service.name}\n${service.selectedType.name}`
      );

      await sendList(tech.phone, "اختر", "تنفيذ", [{
        title: "الطلب",
        rows: [
          { id: `accept_${orderId}`, title: "✅ قبول" },
          { id: `reject_${orderId}`, title: "❌ رفض" }
        ]
      }]);

      await sendMessage(from, "🚀 تم إرسال الطلب");

      delete userState[from];
      delete userData[from];

      return res.sendStatus(200);
    }

    // ===== ACCEPT =====
    if (text.startsWith("accept_")) {
      const orderId = text.split("_")[1];
      const ref = db.collection("orders").doc(orderId);
      const order = (await ref.get()).data();

      await ref.update({ status: "accepted" });
      await db.collection("technicians").doc(order.technicianId).update({ active: false });

      await sendMessage(order.customer, "🚗 الفني في الطريق");

      return res.sendStatus(200);
    }

    // ===== DONE =====
    if (text.startsWith("done_")) {
      const orderId = text.split("_")[1];
      const ref = db.collection("orders").doc(orderId);
      const order = (await ref.get()).data();

      await ref.update({ status: "done" });
      await db.collection("technicians").doc(order.technicianId).update({ active: true });

      await sendMessage(order.customer, "✅ تم الانتهاء");

      return res.sendStatus(200);
    }

    return res.sendStatus(200);

  } catch (err) {
    console.log(err);
    return res.sendStatus(200);
  }
});

// ---------- START ----------
app.listen(process.env.PORT || 3000, () => {
  console.log("Server running...");
});