import express from "express";
import axios from "axios";
import admin from "firebase-admin";

const app = express();
app.use(express.json());

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

// ---------- NORMALIZE ----------
function normalizePhone(phone) {
  return phone.replace("+", "");
}

// ---------- SEND TEXT ----------
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

// ---------- SEND STATUS BUTTONS ----------
async function sendStatusButtons(to, bodyText) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText },
        action: {
          buttons: [
            {
              type: "reply",
              reply: { id: "on_way", title: "🚗 في الطريق" }
            },
            {
              type: "reply",
              reply: { id: "arrived", title: "📍 وصلت" }
            },
            {
              type: "reply",
              reply: { id: "finish", title: "✅ إنهاء الخدمة" }
            }
          ]
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

// ---------- VERIFY ----------
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.send(req.query["hub.challenge"]);
  }
  return res.sendStatus(403);
});

// ---------- GET TECH ----------
async function getTechnician(phone) {
  const p = normalizePhone(phone);
  const snap = await db
    .collection("technicians")
    .where("phone", "in", [p, "+" + p])
    .get();

  if (!snap.empty) return snap.docs[0].data();
  return null;
}

// ---------- FIND TECH ----------
async function findAvailableTech(service) {
  const snap = await db
    .collection("technicians")
    .where("service", "==", service)
    .where("active", "==", true)
    .get();

  if (!snap.empty) return snap.docs[0].data();
  return null;
}

// ---------- WEBHOOK ----------
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = normalizePhone(msg.from);

    let text = "";
    if (msg.type === "text") {
      text = msg.text?.body;
    } else if (msg.type === "interactive") {
      text = msg.interactive?.button_reply?.id;
    }

    // ================= TECH ACCEPT =================
    if (userState[from] === "tech_reply") {
      const data = userData[from];
      const clientPhone = data.client.phone;
      const tech = data.tech;
      const location = data.location;

      if (text === "1") {
        await sendMessage(
          clientPhone,
          `🚀 تم تأكيد طلبك

👨‍🔧 الفني: ${tech.name}
📞 ${tech.phone}
⭐ ${tech.rating}`
        );

        await sendStatusButtons(
          tech.phone,
          `📥 تفاصيل الطلب

👤 ${clientPhone}
🔧 ${data.service}
📍 https://maps.google.com/?q=${location.latitude},${location.longitude}

اختر الحالة:`
        );

        userState[from] = "working";
        userState[clientPhone] = "waiting";
      }

      return res.sendStatus(200);
    }

    // ================= STATUS =================
    if (userState[from] === "working") {
      const data = userData[from];
      const clientPhone = data.client.phone;

      if (text === "on_way") {
        await sendMessage(clientPhone, "🚗 الفني في الطريق إليك");
      }

      if (text === "arrived") {
        await sendMessage(clientPhone, "📍 الفني وصل إلى موقعك");
      }

      if (text === "finish") {
        await sendMessage(
          clientPhone,
          `✅ تم إنهاء الخدمة

⭐ قيم الخدمة من 1 إلى 5`
        );

        userState[clientPhone] = "rating";
        userState[from] = null;
      }

      return res.sendStatus(200);
    }

    // ================= RATING =================
    if (userState[from] === "rating") {
      await sendMessage(from, "💙 شكراً لتقييمك");
      userState[from] = "main_menu";
      return res.sendStatus(200);
    }

    // ================= CHECK TECH =================
    const tech = await getTechnician(from);

    if (tech && !userState[from]) {
      userState[from] = "tech_menu";

      await sendMessage(
        tech.phone,
        `👨‍🔧 حسابك

👤 ${tech.name}
🔧 ${tech.service}
⭐ ${tech.rating}`
      );

      return res.sendStatus(200);
    }

    // ================= START =================
    if (!userState[from] || text === "مرحبا") {
      userState[from] = "main_menu";

      await sendMessage(
        from,
        `👋 مرحباً بكم

1️⃣ كهرباء
2️⃣ سباكة
3️⃣ تكييف`
      );

      return res.sendStatus(200);
    }

    // ================= MENU =================
    if (userState[from] === "main_menu") {
      const map = { "1": "كهرباء", "2": "سباكة", "3": "تكييف" };
      const service = map[text];
      if (!service) return res.sendStatus(200);

      userData[from] = { phone: from, service };
      userState[from] = "location";

      await sendMessage(from, "📍 أرسل موقعك");
      return res.sendStatus(200);
    }

    // ================= LOCATION =================
    if (userState[from] === "location") {
      if (!msg.location) {
        await sendMessage(from, "📍 أرسل الموقع");
        return res.sendStatus(200);
      }

      userData[from].location = msg.location;

      const tech = await findAvailableTech(userData[from].service);
      if (!tech) {
        await sendMessage(from, "🚫 لا يوجد فني");
        return res.sendStatus(200);
      }

      const techPhone = normalizePhone(tech.phone);

      await sendMessage(
        tech.phone,
        `📥 طلب جديد

👤 ${from}
🔧 ${userData[from].service}

1️⃣ قبول`
      );

      userData[techPhone] = {
        client: { phone: from },
        tech,
        service: userData[from].service,
        location: msg.location
      };

      userState[techPhone] = "tech_reply";

      await sendMessage(from, "🚀 تم إرسال الطلب");
      userState[from] = null;

      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  } catch (e) {
    console.log(e);
    return res.sendStatus(200);
  }
});

// ---------- START ----------
app.listen(process.env.PORT || 3000, () => {
  console.log("Server running...");
});