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

// ---------- LIST ----------
async function sendList(to, title, rows) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: title },
        action: {
          button: "اختيار",
          sections: [{ title: "الخدمات", rows }]
        }
      }
    },
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
}

// ---------- GET SERVICES ----------
async function getServices() {
  const snap = await db.collection("services").get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ---------- GET TECH ----------
async function getTech(serviceId) {
  const snap = await db.collection("technicians")
    .where("service", "==", serviceId)
    .where("active", "==", true)
    .limit(1)
    .get();

  return snap.docs[0]?.data();
}

// ---------- WEBHOOK ----------
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text =
      msg.text?.body ||
      msg.interactive?.list_reply?.id ||
      "";

    // 🚫 منع طلب مزدوج
    const existing = await db.collection("orders")
      .where("phone", "==", from)
      .where("status", "==", "pending")
      .get();

    if (!existing.empty && text !== "cancel") {
      await sendMessage(from, "⚠️ عندك طلب قيد التنفيذ\nاكتب *cancel* للإلغاء");
      return res.sendStatus(200);
    }

    // ---------- START ----------
    if (!state[from] || text === "مرحبا") {
      state[from] = "service";

      const services = await getServices();
      const rows = services.map(s => ({
        id: s.id,
        title: s.name
      }));

      await sendList(from, "اختر الخدمة:", rows);
      return res.sendStatus(200);
    }

    // ---------- SERVICE ----------
    if (state[from] === "service") {
      const services = await getServices();
      const s = services.find(x => x.id === text);

      if (!s) {
        await sendMessage(from, "❌ اختيار غير صحيح");
        return res.sendStatus(200);
      }

      data[from] = { service: s };

      const rows = s.types.map((t, i) => ({
        id: "type_" + i,
        title: t.name,
        description: t.price + " ريال"
      }));

      state[from] = "type";
      await sendList(from, "اختر النوع:", rows);
      return res.sendStatus(200);
    }

    // ---------- TYPE ----------
    if (state[from] === "type") {
      const index = parseInt(text.replace("type_", ""));
      const type = data[from].service.types[index];

      data[from].type = type;
      state[from] = "confirm";

      await sendMessage(
        from,
        `🧾 ${data[from].service.name}\n${type.name}\n${type.price} ريال\n\nاكتب *ok* للتأكيد`
      );
      return res.sendStatus(200);
    }

    // ---------- CONFIRM ----------
    if (state[from] === "confirm" && text === "ok") {
      state[from] = "done";

      const order = await db.collection("orders").add({
        phone: from,
        service: data[from].service.name,
        type: data[from].type,
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // 🔥 ربط فني
      const tech = await getTech(data[from].service.id);

      if (tech) {
        await sendMessage(
          tech.phone,
          `🚨 طلب جديد\n${data[from].service.name}\n${data[from].type.name}\nرقم العميل: ${from}`
        );
      }

      await sendMessage(from, "✅ تم إرسال الطلب");

      delete state[from];
      delete data[from];

      return res.sendStatus(200);
    }

    // ---------- CANCEL ----------
    if (text === "cancel") {
      const orders = await db.collection("orders")
        .where("phone", "==", from)
        .where("status", "==", "pending")
        .get();

      for (const doc of orders.docs) {
        await doc.ref.update({ status: "cancelled" });
      }

      await sendMessage(from, "❌ تم إلغاء الطلب");
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