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

// ---------- HELPERS ----------
function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

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
          buttons: buttons.slice(0, 3).map(b => ({
            type: "reply",
            reply: {
              id: b.id,
              title: b.title.substring(0, 20)
            }
          }))
        }
      }
    },
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
}

// ---------- SERVICES ----------
async function getServices() {
  const snap = await db.collection("services").get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ---------- TECH ----------
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
      msg.interactive?.button_reply?.id ||
      "";

    // 🚫 منع طلب مزدوج
    const existing = await db.collection("orders")
      .where("phone", "==", from)
      .where("status", "in", ["pending", "accepted"])
      .get();

    if (!existing.empty && text !== "cancel") {
      await sendButtons(from, "⚠️ عندك طلب قيد التنفيذ", [
        { id: "cancel", title: "❌ إلغاء الطلب" }
      ]);
      return res.sendStatus(200);
    }

    // ---------- START ----------
    if (!state[from] || text === "مرحبا") {
      const services = await getServices();
      const pages = chunkArray(services, 3);

      data[from] = { pages };
      state[from] = "service_page_0";

      const page = pages[0];

      await sendButtons(
        from,
        "👋 اختر الخدمة:",
        [
          ...page.map(s => ({
            id: "service_" + s.id,
            title: s.name
          })),
          ...(pages.length > 1 ? [{ id: "next_1", title: "➡️ المزيد" }] : [])
        ]
      );

      return res.sendStatus(200);
    }

    // ---------- PAGINATION NEXT ----------
    if (text.startsWith("next_")) {
      const i = parseInt(text.replace("next_", ""));
      const pages = data[from].pages;

      const page = pages[i];

      await sendButtons(
        from,
        "اختر الخدمة:",
        [
          ...page.map(s => ({
            id: "service_" + s.id,
            title: s.name
          })),
          ...(i > 0 ? [{ id: "prev_" + (i - 1), title: "⬅️ رجوع" }] : []),
          ...(i < pages.length - 1
            ? [{ id: "next_" + (i + 1), title: "➡️ المزيد" }]
            : [])
        ]
      );

      return res.sendStatus(200);
    }

    // ---------- PAGINATION PREV ----------
    if (text.startsWith("prev_")) {
      const i = parseInt(text.replace("prev_", ""));
      const pages = data[from].pages;

      const page = pages[i];

      await sendButtons(
        from,
        "اختر الخدمة:",
        [
          ...page.map(s => ({
            id: "service_" + s.id,
            title: s.name
          })),
          ...(i > 0 ? [{ id: "prev_" + (i - 1), title: "⬅️ رجوع" }] : []),
          ...(i < pages.length - 1
            ? [{ id: "next_" + (i + 1), title: "➡️ المزيد" }]
            : [])
        ]
      );

      return res.sendStatus(200);
    }

    // ---------- SERVICE ----------
    if (text.startsWith("service_")) {
      const id = text.replace("service_", "");
      const services = await getServices();
      const s = services.find(x => x.id === id);

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
    if (text.startsWith("type_")) {
      const index = parseInt(text.replace("type_", ""));
      const type = data[from].service.types[index];

      data[from].type = type;
      state[from] = "confirm";

      await sendButtons(
        from,
        `🧾 ${data[from].service.name}\n${type.name}\n${type.price} ريال`,
        [
          { id: "ok", title: "✅ تأكيد" },
          { id: "cancel", title: "❌ إلغاء" }
        ]
      );

      return res.sendStatus(200);
    }

    // ---------- CONFIRM ----------
    if (text === "ok") {
      const order = await db.collection("orders").add({
        phone: from,
        service: data[from].service.name,
        type: data[from].type,
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      const tech = await getTech(data[from].service.id);

      if (tech) {
        await sendMessage(
          tech.phone,
          `🚨 طلب جديد\n${data[from].service.name}\n${data[from].type.name}\n📞 ${from}`
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
        .where("status", "in", ["pending", "accepted"])
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