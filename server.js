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
        action: { button: buttonText, sections }
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

async function sendLocation(to, lat, lng) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "location",
      location: { latitude: lat, longitude: lng }
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
  const snap = await db.collection("technicians").where("phone", "==", phone).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function getBestTechnician(serviceId) {
  const snap = await db
    .collection("technicians")
    .where("services", "array-contains", serviceId)
    .where("active", "==", true)
    .get();

  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

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
    let text = "";

    if (msg.type === "text") text = msg.text.body.trim();
    else if (msg.type === "interactive") {
      text = msg.interactive?.list_reply?.id || msg.interactive?.button_reply?.id;
    }

    // ===== الفني =====
    const techCheck = await getTechnicianByPhone(from);
    if (techCheck && text === "مرحبا") {
      await sendMessage(from,
        `👨‍🔧 ${techCheck.name}\n⭐ ${techCheck.rating}\n💰 ${techCheck.balance}`
      );
      return res.sendStatus(200);
    }

    // ===== البداية =====
    if (!userState[from] || text === "مرحبا") {
      userState[from] = "main";
      const services = await getServices();

      await sendList(from, "اختر الخدمة", "الخدمات", [{
        title: "القائمة",
        rows: services.map(s => ({
          id: "service_" + s.id,
          title: s.name.substring(0, 24)
        }))
      }]);

      return res.sendStatus(200);
    }

    // ===== اختيار الخدمة =====
    if (userState[from] === "main") {
      const services = await getServices();
      const id = text.replace("service_", "");
      const service = services.find(s => s.id === id);

      userData[from] = service;
      userState[from] = "type";

      await sendList(from, service.name, "الأنواع", [{
        title: "اختيار",
        rows: service.types.map((t, i) => ({
          id: "type_" + i,
          title: t.name.substring(0, 24),
          description: `${t.price} ريال`
        }))
      }]);

      return res.sendStatus(200);
    }

    // ===== النوع =====
    if (userState[from] === "type") {
      const index = parseInt(text.replace("type_", ""));
      const type = userData[from].types[index];

      userData[from].selectedType = type;
      userState[from] = "confirm";

      await sendList(from,
        `${type.name}\n${type.price} ريال`,
        "تأكيد",
        [{
          title: "تأكيد",
          rows: [
            { id: "yes", title: "✅ تأكيد" },
            { id: "no", title: "❌ إلغاء" }
          ]
        }]
      );

      return res.sendStatus(200);
    }

    // ===== تأكيد =====
    if (userState[from] === "confirm") {
      if (text === "no") {
        delete userState[from];
        return res.sendStatus(200);
      }

      if (text === "yes") {
        userState[from] = "location";
        await sendMessage(from, "📍 أرسل موقعك");
        return res.sendStatus(200);
      }
    }

    // ===== الموقع =====
    if (userState[from] === "location") {
      if (msg.type !== "location") return res.sendStatus(200);

      const service = userData[from];
      const tech = await getBestTechnician(service.id);

      if (!tech) {
        await sendMessage(from, "❌ لا يوجد فني");
        return res.sendStatus(200);
      }

      const orderRef = await db.collection("orders").add({
        customer: from,
        serviceName: service.name,
        type: service.selectedType.name,
        price: service.selectedType.price,
        technicianId: tech.id,
        status: "pending",
        location: {
          latitude: msg.location.latitude,
          longitude: msg.location.longitude
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      const orderId = orderRef.id;

      await sendMessage(tech.phone,
        `📥 طلب جديد\n${service.name}\n${service.selectedType.name}\n💰 ${service.selectedType.price}`
      );

      await sendList(tech.phone, "تنفيذ الطلب", "اختر", [{
        title: "طلب",
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

    // ===== قبول الطلب =====
    if (text.startsWith("accept_")) {
  try {
    const id = text.split("_")[1];

    const ref = db.collection("orders").doc(id);
    const snap = await ref.get();

    if (!snap.exists) {
      console.log("❌ order not found");
      return res.sendStatus(200);
    }

    const order = snap.data();
    console.log("ORDER:", order);

    await ref.update({ status: "accepted" });

    const techRef = db.collection("technicians").doc(order.technicianId);
    const techSnap = await techRef.get();

    if (!techSnap.exists) {
      console.log("❌ tech not found");
      return res.sendStatus(200);
    }

    const tech = techSnap.data();
    console.log("TECH:", tech);

    // تحديث الفني
    await techRef.update({ active: false });

    // ===== إرسال للفني (بيانات العميل) =====
    const customerPhone = order.customer;

    if (!customerPhone) {
      console.log("❌ customer phone missing");
    } else {
      await sendMessage(
        tech.phone,
        `📍 طلب جديد\n📱 رقم العميل: ${customerPhone}`
      );
    }

    // ===== إرسال الموقع =====
    if (order.location && order.location.latitude) {
      await sendLocation(
        tech.phone,
        order.location.latitude,
        order.location.longitude
      );
    } else {
      console.log("❌ location missing", order.location);
    }

    // ===== إرسال للعميل (بيانات الفني) =====
    await sendMessage(
      order.customer,
      `👨‍🔧 تم تعيين فني\n${tech.name}\n📱 ${tech.phone}\n🚗 في الطريق`
    );

    return res.sendStatus(200);

  } catch (err) {
    console.log("❌ ACCEPT ERROR:", err);

      return res.sendStatus(200);
    }

    // ===== إنهاء + خصم =====
    if (text.startsWith("done_")) {
      const id = text.split("_")[1];
      const ref = db.collection("orders").doc(id);
      const snap = await ref.get();
      const order = snap.data();

      await ref.update({ status: "done" });

      const techRef = db.collection("technicians").doc(order.technicianId);
      const tech = (await techRef.get()).data();

      const commission = order.price * 0.2;
      const newBalance = (tech.balance || 0) - commission;

      await techRef.update({
        balance: newBalance,
        active: true
      });

      await sendMessage(order.customer, "✅ تم الإنجاز");
      await sendMessage(tech.phone,
        `💰 تم خصم ${commission}\nرصيدك: ${newBalance}`
      );

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