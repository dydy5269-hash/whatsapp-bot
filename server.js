import express from "express";
import axios from "axios";
import admin from "firebase-admin";

const app = express();
app.use(express.json());

// مصفوفة لتخزين المعرفات المعالجة لمنع التكرار (Idempotency)
const processedIds = new Set();

// ===== 1. تهيئة Firebase =====
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY))
  });
}
const db = admin.firestore();

// ===== 2. المتغيرات البيئية =====
const { VERIFY_TOKEN, WHATSAPP_TOKEN, PHONE_NUMBER_ID } = process.env;

// ===== 3. دوال مساعدة =====
const normalize = (p) => p.replace("+", "");

const Session = {
  get: async (id) => (await db.collection("sessions").doc(id).get()).data(),
  set: async (id, data) => await db.collection("sessions").doc(id).set(data, { merge: true }),
  delete: async (id) => await db.collection("sessions").doc(id).delete()
};

async function callWhatsapp(data) {
  try {
    await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, 
      { messaging_product: "whatsapp", ...data },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
  } catch (e) { console.error("WA Error:", e.response?.data || e.message); }
}

const sendText = (to, text) => callWhatsapp({ to, type: "text", text: { body: text } });

const sendList = (to, body, button, sections) => callWhatsapp({
    to, type: "interactive",
    interactive: { type: "list", body: { text: body }, action: { button, sections } }
});

async function getActiveOrder(phone) {
  const snap = await db.collection("orders")
    .where("customer", "==", phone)
    .where("status", "in", ["pending", "accepted"])
    .limit(1).get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ===== 4. الـ Webhook المستقر =====

app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) return res.send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  // القاعدة الذهبية: أجب واتساب فوراً بـ 200 لتجنب التكرار (Deduplication)
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    if (!msg) return;

    // منع معالجة نفس الرسالة مرتين
    if (processedIds.has(msg.id)) return;
    processedIds.add(msg.id);
    setTimeout(() => processedIds.delete(msg.id), 60000); // تنظيف بعد دقيقة

    const from = normalize(msg.from);
    const text = msg.type === "text" ? msg.text.body.trim() : (msg.interactive?.list_reply?.id || msg.interactive?.button_reply?.id || "");

    // --- أ. نظام الفنيين ---
    const techSnap = await db.collection("technicians").where("phone", "==", from).limit(1).get();
    if (!techSnap.empty) {
        const tech = { id: techSnap.docs[0].id, ...techSnap.docs[0].data() };
        if (text === "مرحبا") return sendText(from, `👨‍🔧 أهلاً كابتن ${tech.name}\nرصيدك: ${tech.balance} ريال`);
        
        if (text.startsWith("acc_")) {
            const orderId = text.split("_")[1];
            await db.collection("orders").doc(orderId).update({ status: "accepted", techId: tech.id, techPhone: from });
            await db.collection("technicians").doc(tech.id).update({ active: false });
            const order = (await db.collection("orders").doc(orderId).get()).data();
            await callWhatsapp({ to: from, type: "location", location: { latitude: order.lat, longitude: order.lng } });
            await sendList(from, "عند إتمام العمل:", "المهام", [{ title: "الطلب", rows: [{ id: `done_${orderId}`, title: "✅ تم الإنجاز" }] }]);
            await sendText(order.customer, `✅ الفني ${tech.name} في الطريق.\n📞 للتواصل: ${tech.phone}`);
            return;
        }

        if (text.startsWith("done_")) {
            const orderId = text.split("_")[1];
            const orderRef = db.collection("orders").doc(orderId);
            const order = (await orderRef.get()).data();
            const fee = order.price * 0.2;
            await db.collection("technicians").doc(tech.id).update({ active: true, balance: admin.firestore.FieldValue.increment(-fee) });
            await orderRef.update({ status: "completed" });
            await sendText(order.customer, "🙏 شكراً لتعاملك معنا!");
            await sendText(from, `💰 تم الخصم: ${fee} ريال.`);
            return;
        }
        return;
    }

    // --- ب. نظام العملاء ---
    let session = await Session.get(from);
    const activeOrder = await getActiveOrder(from);

    // 1. فحص طلب نشط (وحل مشكلة undefined)
    if (activeOrder && !text.startsWith("cancel_") && text !== "continue_order" && session?.state !== "cancel_reason") {
        const sName = activeOrder.serviceName || activeOrder.service || "خدمة عامة";
        return sendList(from, `⚠️ لديك طلب حالياً لخدمة: ${sName}\n\nماذا تود أن تفعل؟`, "إدارة الطلب", [
            { title: "الخيارات", rows: [{ id: "continue_order", title: "🔄 متابعة الطلب" }, { id: `cancel_${activeOrder.id}`, title: "❌ إلغاء الطلب" }] }
        ]);
    }

    if (text === "continue_order") return sendText(from, "الفني سيتواصل معك قريباً.");

    if (text.startsWith("cancel_")) {
        const orderId = text.split("_")[1];
        await Session.set(from, { state: "cancel_reason", cancelingOrderId: orderId });
        return sendText(from, "يرجى كتابة سبب الإلغاء:");
    }

    if (session?.state === "cancel_reason") {
        const orderId = session.cancelingOrderId;
        const orderRef = db.collection("orders").doc(orderId);
        const oData = (await orderRef.get()).data();
        await orderRef.update({ status: "cancelled", cancelReason: text });
        if (oData?.techId) {
            await db.collection("technicians").doc(oData.techId).update({ active: true });
            await sendText(oData.techPhone, `⚠️ تم إلغاء الطلب.\nالسبب: ${text}`);
        }
        await Session.delete(from);
        return sendText(from, "✅ تم إلغاء الطلب.");
    }

    // المسار الطبيعي
    if (!session || text === "مرحبا") {
        await Session.set(from, { state: "main" });
        const services = (await db.collection("services").get()).docs.map(d => ({ id: d.id, ...d.data() }));
        return sendList(from, "👋 اختر الخدمة:", "الخدمات", [
            { title: "القائمة", rows: services.map(s => ({ id: `srv_${s.id}`, title: s.name })) }
        ]);
    }
    
    // [باقي المنطق srv_ و typ_ والموقع...]
    // ملاحظة: تأكد عند إضافة الطلب في Firestore استخدام حقل "serviceName" ليتطابق مع الفحص أعلاه

    res.sendStatus(200);
  } catch (err) {
    console.error("Critical:", err);
  }
});

app.listen(process.env.PORT || 3000);
