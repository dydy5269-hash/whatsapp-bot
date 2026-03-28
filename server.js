import express from "express";
import axios from "axios";
import admin from "firebase-admin";

const app = express();
app.use(express.json());

// ===== 1. تهيئة Firebase =====
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY))
  });
}
const db = admin.firestore();

// ===== 2. المتغيرات البيئية (Environment Variables) =====
const { VERIFY_TOKEN, WHATSAPP_TOKEN, PHONE_NUMBER_ID } = process.env;

// ===== 3. دوال مساعدة (Helpers) =====
const normalize = (p) => p.replace("+", "");

// إدارة الجلسات في Firestore لضمان استمرارية المحادثة
const Session = {
  get: async (id) => (await db.collection("sessions").doc(id).get()).data(),
  set: async (id, data) => await db.collection("sessions").doc(id).set(data, { merge: true }),
  delete: async (id) => await db.collection("sessions").doc(id).delete()
};

// دالة إرسال رسائل واتساب (Text / Interactive / Location)
async function callWhatsapp(data) {
  try {
    await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, 
      { messaging_product: "whatsapp", ...data },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
  } catch (e) { console.error("WA Error:", e.response?.data || e.message); }
}

async function sendText(to, text) {
  await callWhatsapp({ to, type: "text", text: { body: text } });
}

async function sendList(to, body, button, sections) {
  await callWhatsapp({
    to, type: "interactive",
    interactive: { type: "list", body: { text: body }, action: { button, sections } }
  });
}

// فحص إذا كان للعميل طلب نشط (معلق أو مقبول)
async function getActiveOrder(phone) {
  const snap = await db.collection("orders")
    .where("customer", "==", phone)
    .where("status", "in", ["pending", "accepted"])
    .limit(1).get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// البحث عن فني متاح (نشط ورصيده كافٍ)
async function findTech() {
  const snap = await db.collection("technicians")
    .where("active", "==", true)
    .where("balance", ">=", 5) // الحد الأدنى للرصيد
    .limit(1).get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ===== 4. الـ Webhook الرئيسي =====

app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) return res.send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = normalize(msg.from);
    const text = msg.type === "text" ? msg.text.body.trim() : (msg.interactive?.list_reply?.id || msg.interactive?.button_reply?.id || "");

    // --- أولاً: التحقق من هوية المرسل (هل هو فني؟) ---
    const techSnap = await db.collection("technicians").where("phone", "==", from).limit(1).get();
    if (!techSnap.empty) {
        // [منطق الفني كما في الكود السابق: قبول الطلب، إنهاء العمل]
        // ... (يمكنك إبقاء منطق الفني هنا)
        return res.sendStatus(200);
    }

    // --- ثانياً: منطق العميل ---
    let session = await Session.get(from);
    const activeOrder = await getActiveOrder(from);

    // 1. إذا كان للعميل طلب نشط ويحاول البدء من جديد
    if (activeOrder && !text.startsWith("cancel_") && text !== "continue_order" && session?.state !== "cancel_reason") {
        return sendList(from, `⚠️ لديك طلب ${activeOrder.status === 'accepted' ? 'قيد التنفيذ' : 'معلق'} حالياً.\nالخدمة: ${activeOrder.service}\n\nماذا تود أن تفعل؟`, "إدارة الطلب", [
            { title: "الخيارات", rows: [
                { id: "continue_order", title: "🔄 متابعة الطلب الحالي" },
                { id: `cancel_${activeOrder.id}`, title: "❌ إلغاء الطلب" }
            ]}
        ]);
    }

    // 2. معالجة خيار "متابعة الطلب"
    if (text === "continue_order") {
        return sendText(from, "نحن نعمل على طلبك الآن، سيقوم الفني بالتواصل معك قريباً.");
    }

    // 3. معالجة خيار "إلغاء الطلب"
    if (text.startsWith("cancel_")) {
        const orderId = text.split("_")[1];
        await Session.set(from, { state: "cancel_reason", cancelingOrderId: orderId });
        return sendText(from, "نعتذر لسماع ذلك. يرجى كتابة سبب الإلغاء باختصار لمساعدتنا في تحسين الخدمة:");
    }

    // 4. استلام سبب الإلغاء وحفظه
    if (session?.state === "cancel_reason") {
        const orderId = session.cancelingOrderId;
        const orderRef = db.collection("orders").doc(orderId);
        const orderData = (await orderRef.get()).data();

        await orderRef.update({ 
            status: "cancelled", 
            cancelReason: text,
            cancelledAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // إذا كان هناك فني مرتبط بالطلب، يتم تحريره وإبلاغه
        if (orderData?.techId) {
            await db.collection("technicians").doc(orderData.techId).update({ active: true });
            await sendText(orderData.techPhone, `⚠️ تم إلغاء الطلب من قبل العميل.\nالسبب: ${text}`);
        }

        await Session.delete(from);
        return sendText(from, "✅ تم إلغاء طلبك بنجاح. شكراً لك.");
    }

    // 5. المسار الطبيعي لإنشاء طلب جديد
    if (!session || text === "مرحبا") {
        await Session.set(from, { state: "main" });
        const services = (await db.collection("services").get()).docs.map(d => ({ id: d.id, ...d.data() }));
        return sendList(from, "👋 مرحباً بك في خدمة الفني السريع، اختر الخدمة المطلوبة:", "الخدمات", [
            { title: "قائمة الخدمات", rows: services.map(s => ({ id: `srv_${s.id}`, title: s.name })) }
        ]);
    }

    // [تكملة منطق اختيار نوع الخدمة والموقع كما في الكود السابق]
    // ... 

    res.sendStatus(200);
  } catch (err) {
    console.error("Error:", err);
    res.sendStatus(200);
  }
});

app.listen(process.env.PORT || 3000);
