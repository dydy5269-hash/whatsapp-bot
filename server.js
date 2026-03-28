import express from "express";
import path from "path";
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
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// ---------- STATE ----------
const state = {};
const data = {};

// ---------- STATIC ----------
app.use(express.static(path.join(process.cwd(), "public")));

app.get("/", (req, res) => {
  res.send("🔥 Server is running");
});

// ---------- SEND ----------
async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: text }
    },
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
}

// ---------- BUTTONS ----------
async function sendButtons(to, text, buttons) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text },
        action: {
          buttons: buttons.map(b => ({
            type: "reply",
            reply: { id: b.id, title: b.title }
          }))
        }
      }
    },
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
}

// ---------- DISTANCE ----------
function distance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------- GET SERVICES ----------
async function getServices() {
  const snap = await db.collection("services").get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ---------- GET NEAREST TECH ----------
async function getNearestTech(serviceId, lat, lng) {
  const snap = await db.collection("technicians")
    .where("service", "==", serviceId)
    .where("active", "==", true)
    .get();

  let nearest = null;
  let minDist = 9999;

  snap.forEach(doc => {
    const t = doc.data();
    if (!t.lat || !t.lng) return;

    const d = distance(lat, lng, t.lat, t.lng);

    if (d < minDist) {
      minDist = d;
      nearest = t;
    }
  });

  return nearest;
}

// ---------- WEBHOOK ----------
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text =
      msg.text?.body ||
      msg.interactive?.button_reply?.id ||
      "";

    // ---------- START ----------
    if (!state[from] || text === "مرحبا") {
      state[from] = "service";

      const services = await getServices();

      await sendButtons(
        from,
        "اختر الخدمة:",
        services.map(s => ({
          id: s.id,
          title: s.name
        }))
      );

      return res.sendStatus(200);
    }

    // ---------- SERVICE ----------
    if (state[from] === "service") {
      const services = await getServices();
      const s = services.find(x => x.id === text);

      if (!s) return res.sendStatus(200);

      data[from] = { service: s };

      state[from] = "type";

      await sendButtons(
        from,
        "اختر النوع:",
        s.types.map((t, i) => ({
          id: "type_" + i,
          title: t.name
        }))
      );

      return res.sendStatus(200);
    }

    // ---------- TYPE ----------
    if (state[from] === "type") {
      const index = parseInt(text.replace("type_", ""));
      const type = data[from].service.types[index];

      data[from].type = type;
      state[from] = "confirm";

      await sendButtons(
        from,
        `🧾 ${data[from].service.name}\n${type.name}\n${type.price} ريال`,
        [
          { id: "ok", title: "تأكيد" },
          { id: "cancel", title: "إلغاء" }
        ]
      );

      return res.sendStatus(200);
    }

    // ---------- CONFIRM ----------
    if (state[from] === "confirm") {
      if (text === "cancel") {
        delete state[from];
        delete data[from];
        await sendMessage(from, "❌ تم الإلغاء");
        return res.sendStatus(200);
      }

      if (text === "ok") {
        state[from] = "location";
        await sendMessage(from, "📍 أرسل موقعك");
        return res.sendStatus(200);
      }
    }

    // ---------- LOCATION ----------
    if (state[from] === "location") {
      if (msg.type !== "location") {
        await sendMessage(from, "📍 أرسل الموقع");
        return res.sendStatus(200);
      }

      const lat = msg.location.latitude;
      const lng = msg.location.longitude;

      const tech = await getNearestTech(
        data[from].service.id,
        lat,
        lng
      );

      if (!tech) {
        await sendMessage(from, "❌ لا يوجد فني");
        return res.sendStatus(200);
      }

      await sendMessage(
        tech.phone,
        `🚨 طلب جديد\n${data[from].service.name}\n${data[from].type.name}\n📍 https://maps.google.com/?q=${lat},${lng}`
      );

      await sendMessage(from, "✅ تم إرسال الطلب لأقرب فني");

      delete state[from];
      delete data[from];

      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  } catch (e) {
    console.error(e);
    return res.sendStatus(200);
  }
});

// ---------- START ----------
app.listen(process.env.PORT || 3000);