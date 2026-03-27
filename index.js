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

// ---------- SEND BUTTON ----------
async function sendFinishButton(to, bodyText) {
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
              reply: {
                id: "finish",
                title: "إنهاء الخدمة"
              }
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

    // ===== READ MESSAGE TYPE =====
    let text = "";
    if (msg.type === "text") {
      text = msg.text?.body;
    } else if (msg.type === "interactive") {
      text = msg.interactive?.button_reply?.id;
    }

    // ================= TECH REPLY =================
    if (userState[from] === "tech_reply") {
      const data = userData[from];
      const clientPhone = data?.client?.phone;
      const tech = data?.tech;
      const location = data?.location;

      if (text === "1") {
        await sendMessage(
          clientPhone,
          `🚀 تم تأكيد طلبك

👨‍🔧 الفني: ${tech.name}
📞 ${tech.phone}
⭐ ${tech.rating}

⏳ الفني في طريقه إليك`
        );

        await sendFinishButton(
          tech.phone,
          `📥 تفاصيل الطلب

👤 رقم العميل: ${clientPhone}
🔧 ${data.service}
📍 https://maps.google.com/?q=${location.latitude},${location.longitude}

🔚 عند الانتهاء اضغط الزر`
        );

        userState[from] = "working";
        userState[clientPhone] = "waiting_service";
      } else {
        await sendMessage(clientPhone, "❌ تم رفض الطلب");
        userState[from] = null;
      }

      return res.sendStatus(200);
    }

    // ================= FINISH =================
    if (userState[from] === "working" && text === "finish") {
      const clientPhone = userData[from]?.client?.phone;

      await sendMessage(
        clientPhone,
        `✅ تم إنهاء الخدمة

🙏 نأمل تقييم الخدمة

⭐ من 1 إلى 5`
      );

      userState[clientPhone] = "rating";
      userState[from] = null;

      return res.sendStatus(200);
    }

    // ================= RATING =================
    if (userState[from] === "rating") {
      await sendMessage(
        from,
        `💙 شكراً لتقييمك

نتطلع لخدمتك مرة أخرى 🙏`
      );

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
        `👋 مرحباً بكم في *شركة رؤية طاقة للخدمات الهندسية* ⚡

🔧 خدماتنا:

1️⃣ كهرباء
2️⃣ سباكة
3️⃣ تكييف

📩 اختر رقم الخدمة`
      );

      return res.sendStatus(200);
    }

    // ================= MAIN MENU =================
    if (userState[from] === "main_menu") {
      const map = {
        "1": "كهرباء",
        "2": "سباكة",
        "3": "تكييف"
      };

      const service = map[text];
      if (!service) return res.sendStatus(200);

      userData[from] = {
        phone: from,
        service
      };

      userState[from] = "service_type";

      await sendMessage(
        from,
        `⚡ قسم ${service}

1️⃣ تركيب
2️⃣ تصليح
3️⃣ قطع غيار
0️⃣ رجوع`
      );

      return res.sendStatus(200);
    }

    // ================= SERVICE TYPE =================
    if (userState[from] === "service_type") {
      if (text === "0") {
        userState[from] = "main_menu";
        return res.sendStatus(200);
      }

      const map = {
        "1": "تركيب",
        "2": "تصليح",
        "3": "قطع غيار"
      };

      const type = map[text];
      if (!type) return res.sendStatus(200);

      userData[from].type = type;
      userState[from] = "confirm";

      await sendMessage(
        from,
        `🧾 تفاصيل الطلب

🔧 ${type} ${userData[from].service}
💰 السعر: 10 ريال

1️⃣ تأكيد
2️⃣ إلغاء`
      );

      return res.sendStatus(200);
    }

    // ================= CONFIRM =================
    if (userState[from] === "confirm") {
      if (text === "2") {
        userState[from] = "main_menu";
        return res.sendStatus(200);
      }

      if (text === "1") {
        userState[from] = "location";

        await sendMessage(from, "📍 أرسل موقعك عبر الواتساب");
      }

      return res.sendStatus(200);
    }

    // ================= LOCATION =================
    if (userState[from] === "location") {
      if (!msg.location) {
        await sendMessage(
          from,
          "📍 قم بإرسال موقع البيت لنتمكن من خدمتكم"
        );
        return res.sendStatus(200);
      }

      userData[from].location = msg.location;

      const tech = await findAvailableTech(userData[from].service);

      if (!tech) {
        await sendMessage(
          from,
          `🚫 لا يوجد فني حالياً

1️⃣ انتظار
2️⃣ إلغاء`
        );

        userState[from] = "waiting";
        return res.sendStatus(200);
      }

      const techPhone = normalizePhone(tech.phone);

      await sendMessage(
        tech.phone,
        `📥 طلب جديد

👤 رقم العميل: ${from}
🔧 ${userData[from].type} ${userData[from].service}
📍 موقع متوفر

1️⃣ قبول
2️⃣ رفض`
      );

      userData[techPhone] = {
        client: { phone: from },
        tech,
        service: `${userData[from].type} ${userData[from].service}`,
        location: msg.location
      };

      userState[techPhone] = "tech_reply";

      await sendMessage(from, "🚀 تم إرسال طلبك");

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