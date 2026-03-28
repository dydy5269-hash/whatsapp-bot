// ---------- CONFIG & INITIALIZATION ----------
import express from "express";
import admin from "firebase-admin";
import axios from "axios";

const app = express();
app.use(express.json());

// إعداد Firebase (تأكد من وضع المفتاح في البيئة)
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY)) });
const db = admin.firestore();

// ---------- الذاكرة المؤقتة للحالات ----------
const userState = {}; 
const userData = {};

// ---------- دالة إرسال الرسائل (WhatsApp API) ----------
async function sendMsg(to, text, interactive = null) {
  const data = { messaging_product: "whatsapp", to };
  if (interactive) {
    data.type = "interactive";
    data.interactive = interactive;
  } else {
    data.text = { body: text };
  }
  
  try {
    await axios.post(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`, data, {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
    });
  } catch (e) { console.error("Send Error:", e.response?.data || e.message); }
}

// ---------- المحرك الرئيسي (Webhook) ----------
app.post("/webhook", async (req, res) => {
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return res.sendStatus(200);

  const from = msg.from.replace("+", "");
  let text = msg.text?.body || msg.interactive?.list_reply?.id || msg.interactive?.button_reply?.id;

  // 🔍 1. التحقق: هل المستخدم "فني" مسجل لدينا؟
  const techSnap = await db.collection("technicians").doc(from).get();
  const isTech = techSnap.exists;

  // ----------------- [ مسار الفني ] -----------------
  if (isTech) {
    const techData = techSnap.data();
    
    // قبول الطلب
    if (text?.startsWith("accept_")) {
      const orderId = text.replace("accept_", "");
      const orderRef = db.collection("orders").doc(orderId);
      const order = await orderRef.get();

      if (order.data().status !== "pending") return sendMsg(from, "⚠️ عذراً، تم استلام الطلب من فني آخر.");

      await orderRef.update({ status: "accepted", techId: from, techName: techData.name });
      await sendMsg(from, "✅ تم قبول الطلب. تواصل مع العميل الآن.", {
        type: "button",
        body: { text: `عميل: ${order.data().customerPhone}\nالخدمة: ${order.data().service}` },
        action: { buttons: [{title: "📍 وصلت للموقع", id: `arrived_${orderId}`}] }
      });
      
      // إشعار العميل
      await sendMsg(order.data().customerPhone, `🚀 أبشر! تم قبول طلبك.\nالفني: ${techData.name}\nالتقييم: ⭐ ${techData.rating}\nوهو الآن في الطريق إليك.`);
      return res.sendStatus(200);
    }

    // تحديث الحالة (وصلت / إنهاء)
    if (text?.startsWith("arrived_")) {
        const orderId = text.replace("arrived_", "");
        await db.collection("orders").doc(orderId).update({ status: "arrived" });
        const order = await db.collection("orders").doc(orderId).get();
        await sendMsg(order.data().customerPhone, "📍 الفني وصل إلى موقعك الآن.");
        await sendMsg(from, "تم إرسال إشعار للعميل.", {
            type: "button",
            body: { text: "عند الانتهاء اضغط الزر بالأسفل:" },
            action: { buttons: [{title: "✅ إنهاء الخدمة", id: `finish_${orderId}`}] }
        });
    }
    
    if (text?.startsWith("finish_")) {
        const orderId = text.replace("finish_", "");
        const orderRef = db.collection("orders").doc(orderId);
        const order = (await orderRef.get()).data();
        
        // حساب العمولة (15%)
        const commission = order.price * 0.15;
        await db.collection("technicians").doc(from).update({
            balance: admin.firestore.FieldValue.increment(-commission)
        });
        await orderRef.update({ status: "done" });
        
        await sendMsg(from, `✅ تم إنهاء الخدمة.\nخصم عمولة: ${commission} ريال.`);
        await sendMsg(order.customerPhone, "🎉 شكراً لتعاملك معنا. نرجو تقييم الخدمة من 1 إلى 5:");
        userState[order.customerPhone] = "rating";
        userData[order.customerPhone] = { lastOrderId: orderId };
    }
    return res.sendStatus(200);
  }

  // ----------------- [ مسار العميل ] -----------------
  // (هنا نضع نفس منطق الكود السابق: اختيار الخدمة -> النوع -> الموقع)
  // مضافاً إليه البحث عن فني عند اكتمال الطلب:
  
  if (userState[from] === "location" && msg.type === "location") {
      const orderId = `ORD_${Date.now()}`;
      const newOrder = {
          customerPhone: from,
          service: userData[from].serviceName,
          price: userData[from].selectedType.price,
          status: "pending",
          location: { lat: msg.location.latitude, lng: msg.location.longitude }
      };
      
      await db.collection("orders").doc(orderId).set(newOrder);
      await sendMsg(from, "⏳ جاري البحث عن أقرب فني متاح...");

      // ⚡ البحث عن فنيين (تكييف + رصيد > 1)
      const techs = await db.collection("technicians")
          .where("specialty", "==", newOrder.service)
          .where("balance", ">=", 1)
          .limit(5).get();

      techs.forEach(t => {
          sendMsg(t.id, `📥 طلب جديد: ${newOrder.service}\n💰 السعر: ${newOrder.price} ريال`, {
              type: "button",
              body: { text: "هل ترغب في قبول الطلب؟" },
              action: { buttons: [{title: "✅ قبول", id: `accept_${orderId}`}, {title: "❌ رفض", id: `reject`}] }
          });
      });
  }
  
  // منطق التقييم
  if (userState[from] === "rating") {
      const rating = parseInt(text);
      if (rating >= 1 && rating <= 5) {
          await db.collection("orders").doc(userData[from].lastOrderId).update({ rating });
          await sendMsg(from, "💙 شكراً لتقييمك! يومك سعيد.");
          delete userState[from];
      }
  }

  res.sendStatus(200);
});

app.listen(3000);
