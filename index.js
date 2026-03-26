import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// 🧠 حالة المستخدم
const userState = {};

// 📌 إرسال رسالة واتساب
async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// 📌 رسالة الترحيب
function mainMenu() {
  return `👋 أهلاً بك في *رؤية طاقة للخدمات* 🇴🇲  
إدارة عمانية لخدمتكم دائماً

🔧 اختر نوع الخدمة:
1️⃣ كهرباء
2️⃣ سباكة
3️⃣ تكييف

🔄 أرسل (0) للعودة للقائمة`;
}

// 📌 webhook verification
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// 📌 استقبال الرسائل
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // مهم جداً

  try {
    const msg =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!msg) return;

    const from = msg.from;
    const text = msg.text?.body?.trim();

    // 🔄 reset
    if (text === "0" || text === "مرحبا") {
      userState[from] = "menu";
      await sendMessage(from, mainMenu());
      return;
    }

    // 🟢 أول مرة
    if (!userState[from]) {
      userState[from] = "menu";
      await sendMessage(from, mainMenu());
      return;
    }

    // 📋 اختيار خدمة
    if (userState[from] === "menu") {
      if (text === "1") {
        userState[from] = "waiting_location";
        userState[from + "_service"] = "كهرباء";
        await sendMessage(
          from,
          "✅ تم اختيار: *كهرباء*\n\n📍 أرسل موقعك من فضلك"
        );
        return;
      }

      if (text === "2") {
        userState[from] = "waiting_location";
        userState[from + "_service"] = "سباكة";
        await sendMessage(
          from,
          "✅ تم اختيار: *سباكة*\n\n📍 أرسل موقعك من فضلك"
        );
        return;
      }

      if (text === "3") {
        userState[from] = "waiting_location";
        userState[from + "_service"] = "تكييف";
        await sendMessage(
          from,
          "✅ تم اختيار: *تكييف*\n\n📍 أرسل موقعك من فضلك"
        );
        return;
      }

      await sendMessage(from, "❗ اختر رقم صحيح\n" + mainMenu());
      return;
    }

    // 📍 انتظار الموقع
    if (userState[from] === "waiting_location") {
      if (msg.type !== "location") {
        await sendMessage(from, "📍 يرجى إرسال الموقع فقط");
        return;
      }

      const service = userState[from + "_service"];

      await sendMessage(
        from,
        "📦 جاري البحث عن أقرب فني متاح...\n⏳ انتظر قليلاً"
      );

      // ⚠️ مؤقت: رقم فني ثابت
      const technicianPhone = "96891002992";

      await sendMessage(
        technicianPhone,
        `📢 طلب جديد

🔧 الخدمة: ${service}
📍 تم إرسال الموقع من العميل

للرد:
1️⃣ قبول
2️⃣ رفض`
      );

      await sendMessage(
        from,
        "✅ تم إرسال طلبك بنجاح\n👨‍🔧 سيتم التواصل معك قريباً"
      );

      userState[from] = "done";
      return;
    }

    // 🟣 بعد الطلب
    if (userState[from] === "done") {
      await sendMessage(
        from,
        "📌 لديك طلب جاري التنفيذ\n\n(0) للعودة للقائمة"
      );
      return;
    }
  } catch (err) {
    console.log(err);
  }
});

// 📌 تشغيل السيرفر
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
