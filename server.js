import express from "express";
import axios from "axios";
import admin from "firebase-admin";

const app = express();
app.use(express.json());

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
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
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
        action: {
          button: buttonText,
          sections: sections
        }
      }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

// ---------- DATABASE ----------
async function getServices() {
  const snap = await db.collection("services").get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function getTechnicianByPhone(phone) {
  const snap = await db
    .collection("technicians")
    .where("phone", "==", phone)
    .get();

  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function getTech(serviceId) {
  const snap = await db
    .collection("technicians")
    .where("services", "array-contains", serviceId)
    .where("active", "==", true)
    .get();

  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ---------- ADMIN ----------
app.get("/admin/technicians/stats", async (req, res) => {
  const snap = await db.collection("technicians").get();

  let total = 0;
  let available = 0;
  let busy = 0;

  snap.forEach(doc => {
    total++;
    if (doc.data().active) available++;
    else busy++;
  });

  res.json({ total, available, busy });
});

// ---------- VERIFY ----------
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.send(req.query["hub.challenge"]);
  }
  return res.sendStatus(403);
});

// ---------- WEBHOOK ----------
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = normalizePhone(msg.from);
    let incomingText = "";

    if (msg.type === "text") {
      incomingText = msg.text.body.trim();
    } else if (msg.type === "interactive") {
      incomingText =
        msg.interactive?.list_reply?.id ||
        msg.interactive?.button_reply?.id;
    }

    // ===== TECH ACCEPT/REJECT =====
    if (
      incomingText.startsWith("accept_") ||
      incomingText.startsWith("reject_")
    ) {
      const orderId = incomingText.split("_")[1];
      const ref = db.collection("orders").doc(orderId);
      const snap = await ref.get();
      if (!snap.exists) return res.sendStatus(200);

      const order = snap.data();

      if (incomingText.startsWith("accept_")) {
        await ref.update({ status: "accepted" });

        await db.collection("technicians").doc(order.technicianId).update({
          active: false
        });

        await sendMessage(order.customer, "👨‍🔧 الفني في الطريق 🚗");

        await sendList(
          from,
          "🚀 اختر الحالة:",
          "الحالة",
          [
            {
              title: "التحديث",
              rows: [
                { id: `onway_${orderId}`, title: "🚗 في الطريق" },
                { id: `arrived_${orderId}`, title: "📍 وصلت" },
                { id: `done_${orderId}`, title: "✔️ تم الإنجاز" }
              ]
            }
          ]
        );

        await sendMessage(from, "✅ تم قبول الطلب");
      }

      if (incomingText.startsWith("reject_")) {
        await ref.update({ status: "rejected" });
        await sendMessage(order.customer, "❌ تم رفض الطلب");
        await sendMessage(from, "❌ تم رفض الطلب");
      }

      return res.sendStatus(200);
    }

    // ===== STATUS UPDATES =====
    if (
      incomingText.startsWith("onway_") ||
      incomingText.startsWith("arrived_") ||
      incomingText.startsWith("done_")
    ) {
      const orderId = incomingText.split("_")[1];
      const ref = db.collection("orders").doc(orderId);
      const snap = await ref.get();
      if (!snap.exists) return res.sendStatus(200);

      const order = snap.data();

      if (incomingText.startsWith("onway_")) {
        await ref.update({ status: "on_the_way" });
        await sendMessage(order.customer, "🚗 الفني في الطريق");
        await sendMessage(from, "🚗 تم التحديث");
      }

      if (incomingText.startsWith("arrived_")) {
        await ref.update({ status: "arrived" });
        await sendMessage(order.customer, "📍 وصل الفني");
        await sendMessage(from, "📍 تم التحديث");
      }

      if (incomingText.startsWith("done_")) {
        await ref.update({ status: "done" });

        await db.collection("technicians").doc(order.technicianId).update({
          active: true
        });

        await sendMessage(order.customer, "✅ تم إنجاز الطلب");

        await sendList(
          order.customer,
          "⭐ قيّم الخدمة:",
          "تقييم",
          [
            {
              title: "التقييم",
              rows: [
                { id: `rate_5_${orderId}`, title: "⭐️⭐️⭐️⭐️⭐️" },
                { id: `rate_4_${orderId}`, title: "⭐️⭐️⭐️⭐️" },
                { id: `rate_3_${orderId}`, title: "⭐️⭐️⭐️" },
                { id: `rate_2_${orderId}`, title: "⭐️⭐️" },
                { id: `rate_1_${orderId}`, title: "⭐️" }
              ]
            }
          ]
        );

        await sendMessage(from, "✅ تم إنهاء الطلب");
      }

      return res.sendStatus(200);
    }

    // ===== RATING =====
    if (incomingText.startsWith("rate_")) {
      const parts = incomingText.split("_");
      const rating = parseInt(parts[1]);
      const orderId = parts[2];

      const ref = db.collection("orders").doc(orderId);
      const snap = await ref.get();
      if (!snap.exists) return res.sendStatus(200);

      const order = snap.data();

      await ref.update({ rating });

      const techRef = db.collection("technicians").doc(order.technicianId);
      const techSnap = await techRef.get();

      if (techSnap.exists) {
        const tech = techSnap.data();
        const newRating = ((tech.rating || 0) + rating) / 2;
        await techRef.update({ rating: newRating });
      }

      await sendMessage(from, "🙏 شكراً لتقييمك");
      return res.sendStatus(200);
    }

    // ===== START =====
    if (!userState[from] || incomingText === "مرحبا") {
      const tech = await getTechnicianByPhone(from);

      if (tech) {
        await sendMessage(
          from,
          `👨‍🔧 بياناتك:
الاسم: ${tech.name}
⭐ التقييم: ${tech.rating}
💰 الرصيد: ${tech.balance}`
        );
        return res.sendStatus(200);
      }

      userState[from] = "main";
      const services = await getServices();

      await sendList(
        from,
        "👋 اختر الخدمة:",
        "الخدمات",
        [
          {
            title: "القائمة",
            rows: services.map(s => ({
              id: "service_" + s.id,
              title: s.name.substring(0, 24)
            }))
          }
        ]
      );

      return res.sendStatus(200);
    }

    // ===== SERVICE =====
    if (userState[from] === "main") {
      const services = await getServices();
      const id = incomingText.replace("service_", "");
      const service = services.find(s => s.id === id);

      if (!service) {
        await sendMessage(from, "❌ خطأ");
        return res.sendStatus(200);
      }

      userData[from] = service;
      userState[from] = "type";

      await sendList(
        from,
        `⚡ ${service.name}`,
        "الأنواع",
        [
          {
            title: "الأنواع",
            rows: service.types.map((t, i) => ({
              id: "type_" + i,
              title: t.name.substring(0, 24),
              description: `${t.price} ريال`
            }))
          }
        ]
      );

      return res.sendStatus(200);
    }

    // ===== TYPE =====
    if (userState[from] === "type") {
      const index = parseInt(incomingText.replace("type_", ""));
      const type = userData[from].types[index];

      if (!type) {
        await sendMessage(from, "❌ خطأ");
        return res.sendStatus(200);
      }

      userData[from].selectedType = type;
      userState[from] = "confirm";

      await sendList(
        from,
        `🧾 ${type.name}\n💰 ${type.price}`,
        "تأكيد",
        [
          {
            title: "تأكيد",
            rows: [
              { id: "confirm_yes", title: "✅ تأكيد" },
              { id: "confirm_no", title: "❌ إلغاء" }
            ]
          }
        ]
      );

      return res.sendStatus(200);
    }

    // ===== CONFIRM =====
    if (userState[from] === "confirm") {
      if (incomingText === "confirm_no") {
        delete userState[from];
        await sendMessage(from, "❌ تم الإلغاء");
        return res.sendStatus(200);
      }

      if (incomingText === "confirm_yes") {
        userState[from] = "location";
        await sendMessage(from, "📍 أرسل موقعك");
        return res.sendStatus(200);
      }
    }

    // ===== LOCATION =====
    if (userState[from] === "location") {
      if (msg.type !== "location") {
        await sendMessage(from, "📍 أرسل الموقع");
        return res.sendStatus(200);
      }

      const service = userData[from];
      const tech = await getTech(service.id);

      if (!tech) {
        await sendMessage(from, "❌ لا يوجد فني متاح");
        return res.sendStatus(200);
      }

      const orderRef = await db.collection("orders").add({
        customer: from,
        serviceName: service.name,
        type: service.selectedType,
        technicianId: tech.id,
        status: "pending",
        location: msg.location,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      const orderId = orderRef.id;

      await sendMessage(
        tech.phone,
        `📥 طلب جديد
${service.name}
${service.selectedType.name}
${service.selectedType.price} ريال`
      );

      await sendList(
        tech.phone,
        "اختر الإجراء:",
        "تنفيذ",
        [
          {
            title: "الطلب",
            rows: [
              { id: `accept_${orderId}`, title: "✅ قبول" },
              { id: `reject_${orderId}`, title: "❌ رفض" }
            ]
          }
        ]
      );

      await sendMessage(from, "🚀 تم إرسال الطلب");

      delete userState[from];
      delete userData[from];

      return res.sendStatus(200);
    }

    return res.sendStatus(200);

  } catch (err) {
    console.log(err.response?.data || err);
    return res.sendStatus(200);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running...");
});