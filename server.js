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
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ---------- ADMIN ----------
app.get("/admin/dashboard", async (req, res) => {
  const orders = await db.collection("orders").get();
  const techs = await db.collection("technicians").get();

  let available = 0;
  let busy = 0;

  techs.forEach(doc => {
    if (doc.data().active) available++;
    else busy++;
  });

  const latest = orders.docs.slice(-5).map(d => {
    const data = d.data();
    return {
      service: data.serviceName || "غير محدد",
      status: data.status || "new"
    };
  });

  res.json({
    totalOrders: orders.size,
    totalTechs: techs.size,
    available,
    busy,
    latest
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
      text = msg.interactive.list_reply?.id;
    }

    // ---------- البداية ----------
    if (!userState[from] || text === "مرحبا") {
      const services = await getServices();
      userState[from] = "main";

      await sendList(from, "👋 اختر الخدمة", "الخدمات", [{
        title: "الخدمات",
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
      if (!service) return res.sendStatus(200);

      userData[from] = service;
      userState[from] = "type";

      await sendList(from, "⚡ اختر النوع", "الأنواع", [{
        title: "الأنواع",
        rows: service.types.map((t, i) => ({
          id: "type_" + i,
          title: t.name,
          description: `${t.price} ريال`
        }))
      }]);

      return res.sendStatus(200);
    }

    // ---------- اختيار نوع ----------
    if (userState[from] === "type") {
      const index = parseInt(text.replace("type_", ""));
      const type = userData[from].types[index];
      if (!type) return res.sendStatus(200);

      userData[from].selectedType = type;
      userState[from] = "confirm";

      await sendList(from, `🧾 ${type.name} - ${type.price} ريال`, "تأكيد", [{
        title: "تأكيد",
        rows: [
          { id: "yes", title: "✅ تأكيد" },
          { id: "no", title: "❌ إلغاء" }
        ]
      }]);

      return res.sendStatus(200);
    }

    // ---------- تأكيد ----------
    if (userState[from] === "confirm") {
      if (text === "yes") {
        userState[from] = "location";
        await sendMessage(from, "📍 أرسل موقعك");
      } else {
        delete userState[from];
        await sendMessage(from, "❌ تم الإلغاء");
      }
      return res.sendStatus(200);
    }

    // ---------- الموقع ----------
    if (userState[from] === "location") {
      if (msg.type !== "location") {
        await sendMessage(from, "📍 أرسل الموقع");
        return res.sendStatus(200);
      }

      const service = userData[from];

      await db.collection("orders").add({
        customer: from,
        serviceName: service.name,
        type: service.selectedType.name,
        price: service.selectedType.price,
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

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

app.listen(process.env.PORT || 3000);