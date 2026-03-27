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

// ---------- STATE (يفضل استخدام قاعدة بيانات للحالات في الإنتاج) ----------
const userState = {};
const userData = {};

// ---------- HELPERS ----------
function normalizePhone(phone) {
  return phone.replace("+", "");
}

async function sendMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        text: { body: text }
      },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
  } catch (err) { console.error("Error sending message:", err.response?.data || err.message); }
}

async function sendList(to, bodyText, buttonText, sections) {
  try {
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
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
  } catch (err) { console.error("Error sending list:", err.response?.data || err.message); }
}

// ---------- SERVICES ----------
async function getServices() {
  const snap = await db.collection("services").get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// ---------- VERIFY WEBHOOK ----------
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.send(req.query["hub.challenge"]);
  }
  return res.sendStatus(403);
});

// ---------- WEBHOOK MAIN ----------
app.post("/webhook", async (req, res) => {
  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = normalizePhone(msg.from);
    let incomingText = "";

    // استخراج النص أو الـ ID من الرسالة
    if (msg.type === "text") {
      incomingText = msg.text.body.trim();
    } else if (msg.type === "interactive") {
      incomingText = msg.interactive.list_reply?.id || msg.interactive.button_reply?.id;
    }

    console.log(`[${from}] State: ${userState[from] || 'New'} | Received: ${incomingText}`);

    // 1. البداية أو إعادة التعيين
    if (!userState[from] || incomingText === "مرحبا" || incomingText === "الغاء") {
      userState[from] = "main";
      const services = await getServices();
      
      const rows = services.map(s => ({ id: `service_${s.id}`, title: s.name.substring(0, 24) }));
      
      await sendList(from, "👋 مرحباً بك في خدمة الطلبات.\nالرجاء اختيار الخدمة المطلوبة:", "الخدمات", [{ title: "قائمة الخدمات", rows }]);
      return res.sendStatus(200);
    }

    // 2. معالجة اختيار الخدمة (Main)
    if (userState[from] === "main") {
      const services = await getServices();
      const cleanId = incomingText.replace("service_", "");
      const service = services.find(s => s.id === cleanId || s.name === incomingText);

      if (!service) {
        await sendMessage(from, "⚠️ عذراً، يرجى اختيار خدمة من القائمة.");
        return res.sendStatus(200);
      }

      userData[from] = { serviceId: service.id, serviceName: service.name, types: service.types || [] };
      userState[from] = "type";

      const typeRows = userData[from].types.map((t, index) => ({
        id: `type_${index}`, // نستخدم Index إذا لم يوجد ID فريد للنوع
        title: t.name.substring(0, 24),
        description: `${t.price} ريال`
      }));

      await sendList(from, `⚡ خدمة: ${service.name}\nالرجاء اختيار النوع:`, "الأنواع", [{ title: "الأنواع المتاحة", rows: typeRows }]);
      return res.sendStatus(200);
    }

    // 3. معالجة اختيار النوع (Type)
    if (userState[from] === "type") {
      const typeIndex = incomingText.startsWith("type_") ? parseInt(incomingText.replace("type_", "")) : -1;
      const selectedType = userData[from].types[typeIndex];

      if (!selectedType) {
        await sendMessage(from, "⚠️ يرجى اختيار نوع من القائمة الموضحة.");
        return res.sendStatus(200);
      }

      userData[from].selectedType = selectedType;
      userState[from] = "confirm";

      const confirmRows = [
        { id: "confirm_yes", title: "✅ تأكيد الطلب" },
        { id: "confirm_no", title: "❌ إلغاء" }
      ];

      await sendList(from, `🧾 تفاصيل طلبك:\n- الخدمة: ${userData[from].serviceName}\n- النوع: ${selectedType.name}\n- السعر: ${selectedType.price} ريال`, "التأكيد", [{ title: "هل تود التأكيد؟", rows: confirmRows }]);
      return res.sendStatus(200);
    }

    // 4. معالجة التأكيد (Confirm)
    if (userState[from] === "confirm") {
      if (incomingText === "confirm_no") {
        delete userState[from];
        await sendMessage(from, "❌ تم إلغاء الطلب. يمكنك البدء من جديد بإرسال 'مرحبا'.");
        return res.sendStatus(200);
      }

      if (incomingText === "confirm_yes") {
        userState[from] = "location";
        await sendMessage(from, "📍 رائع! من فضلك أرسل موقعك (Location) الآن لتحديد العنوان.");
        return res.sendStatus(200);
      }
    }

    // 5. معالجة الموقع (Location)
    if (userState[from] === "location") {
      if (msg.type !== "location") {
        await sendMessage(from, "📍 من فضلك أرسل 'الموقع الجغرافي' عبر واتساب.");
        return res.sendStatus(200);
      }

      const loc = msg.location;
      // هنا يمكنك حفظ الطلب في Firestore
      await db.collection("orders").add({
        phone: from,
        service: userData[from].serviceName,
        type: userData[from].selectedType,
        location: { lat: loc.latitude, lng: loc.longitude },
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });

      await sendMessage(from, "🚀 تم استلام طلبك بنجاح! سنتواصل معك قريباً.");
      delete userState[from];
      delete userData[from];
      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("Critical Webhook Error:", err);
    return res.sendStatus(200);
  }
});

app.listen(process.env.PORT || 3000, () => console.log("Server is live..."));
