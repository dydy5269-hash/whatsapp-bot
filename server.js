import express from “express”;
import axios from “axios”;
import admin from “firebase-admin”;
import { v4 as uuidv4 } from “uuid”;

const app = express();
app.use(express.json());

// ===== FIREBASE =====
if (!admin.apps.length) {
admin.initializeApp({
credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY)),
});
}
const db = admin.firestore();

// ===== ENV =====
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// ===== STATE (Firestore-backed) =====
// userState & userData are stored in Firestore under collection “sessions”
// to survive server restarts

// ===== HELPERS =====

/** تطبيع رقم الهاتف: إزالة كل علامات + */
const normalize = (p) => p.replace(/+/g, “”);

/** جلب حالة المستخدم من Firestore */
async function getSession(phone) {
const doc = await db.collection(“sessions”).doc(phone).get();
return doc.exists ? doc.data() : { state: null, data: {} };
}

/** حفظ حالة المستخدم في Firestore */
async function setSession(phone, state, data = {}) {
await db.collection(“sessions”).doc(phone).set({ state, data });
}

/** حذف جلسة المستخدم */
async function clearSession(phone) {
await db.collection(“sessions”).doc(phone).delete();
}

/** توليد ID قصير مقروء للطلب */
function generateOrderId() {
return “ORD-” + uuidv4().split(”-”)[0].toUpperCase();
}

// ===== SEND HELPERS =====

async function sendMessage(to, text) {
try {
await axios.post(
`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
{
messaging_product: “whatsapp”,
to,
text: { body: text },
},
{
headers: {
Authorization: `Bearer ${WHATSAPP_TOKEN}`,
“Content-Type”: “application/json”,
},
}
);
} catch (err) {
console.error(“sendMessage error:”, err?.response?.data || err.message);
}
}

async function sendList(to, body, button, sections) {
try {
await axios.post(
`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
{
messaging_product: “whatsapp”,
to,
type: “interactive”,
interactive: {
type: “list”,
body: { text: body },
action: { button, sections },
},
},
{
headers: {
Authorization: `Bearer ${WHATSAPP_TOKEN}`,
“Content-Type”: “application/json”,
},
}
);
} catch (err) {
console.error(“sendList error:”, err?.response?.data || err.message);
}
}

async function sendLocation(to, lat, lng) {
try {
await axios.post(
`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
{
messaging_product: “whatsapp”,
to,
type: “location”,
location: { latitude: lat, longitude: lng },
},
{
headers: {
Authorization: `Bearer ${WHATSAPP_TOKEN}`,
“Content-Type”: “application/json”,
},
}
);
} catch (err) {
console.error(“sendLocation error:”, err?.response?.data || err.message);
}
}

// ===== DATABASE HELPERS =====

async function getServices() {
const snap = await db.collection(“services”).get();
return snap.docs.map((d) => ({ id: d.id, …d.data() }));
}

/** البحث عن فني بالهاتف */
async function getTechByPhone(phone) {
const snap = await db
.collection(“technicians”)
.where(“phone”, “==”, phone)
.get();
if (snap.empty) return null;
return { id: snap.docs[0].id, …snap.docs[0].data() };
}

/** البحث عن فني متاح حسب الخدمة */
async function getAvailableTech(serviceId) {
const snap = await db
.collection(“technicians”)
.where(“active”, “==”, true)
.where(“serviceIds”, “array-contains”, serviceId) // ✅ فلترة بالخدمة
.get();

if (snap.empty) return null;
return { id: snap.docs[0].id, …snap.docs[0].data() };
}

/** التحقق من وجود طلب نشط للعميل */
async function getActiveOrder(customerPhone) {
const snap = await db
.collection(“orders”)
.where(“customer”, “==”, customerPhone)
.where(“status”, “in”, [“pending”, “accepted”])
.limit(1)
.get();

if (snap.empty) return null;
return { id: snap.docs[0].id, …snap.docs[0].data() };
}

// ===== VERIFY =====
app.get(”/webhook”, (req, res) => {
if (req.query[“hub.verify_token”] === VERIFY_TOKEN) {
return res.send(req.query[“hub.challenge”]);
}
res.sendStatus(403);
});

// ===== WEBHOOK =====
app.post(”/webhook”, async (req, res) => {
// نرد فوراً لتجنب timeout من Meta
res.sendStatus(200);

try {
const msg =
req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
if (!msg) return;

```
const from = normalize(msg.from);
let text = "";

if (msg.type === "text") {
  text = msg.text.body.trim();
} else if (msg.type === "interactive") {
  text =
    msg.interactive?.list_reply?.id ||
    msg.interactive?.button_reply?.id ||
    "";
}

console.log("FROM:", from, "TEXT:", text, "TYPE:", msg.type);

// ===== فني: أي رسالة → عرض بياناته =====
const techCheck = await getTechByPhone(from);
if (techCheck) {
  // معالجة ردود الفني (قبول / رفض / إنهاء)
  if (text.startsWith("accept_")) {
    await handleAccept(text, from, techCheck);
    return;
  }
  if (text.startsWith("reject_")) {
    await handleReject(text, from);
    return;
  }
  if (text.startsWith("done_")) {
    await handleDone(text, from, techCheck);
    return;
  }

  // أي رسالة أخرى من الفني → عرض بياناته من Firebase
  await sendMessage(
    from,
    `👨‍🔧 *بياناتك*\n\n` +
      `الاسم: ${techCheck.name}\n` +
      `الهاتف: ${techCheck.phone}\n` +
      `التقييم: ⭐ ${techCheck.rating ?? "لا يوجد"}\n` +
      `الرصيد: 💰 ${techCheck.balance ?? 0} ريال\n` +
      `الحالة: ${techCheck.active ? "✅ متاح" : "🔴 مشغول"}\n` +
      `الخدمات: ${(techCheck.serviceIds ?? []).join(", ")}`
  );
  return;
}

// ===== عميل: بداية أو مرحبا =====
const session = await getSession(from);

if (!session.state || text === "مرحبا") {
  // ✅ تحقق من وجود طلب نشط
  const activeOrder = await getActiveOrder(from);
  if (activeOrder) {
    await sendMessage(
      from,
      `⚠️ لديك طلب قيد التنفيذ حالياً\n\n` +
        `🔖 رقم الطلب: *${activeOrder.orderId}*\n` +
        `🔧 الخدمة: ${activeOrder.serviceName}\n` +
        `📌 النوع: ${activeOrder.type}\n` +
        `💰 السعر: ${activeOrder.price} ريال\n` +
        `📋 الحالة: ${activeOrder.status === "pending" ? "⏳ في الانتظار" : "🚗 في الطريق"}\n\n` +
        `يرجى انتظار إنهاء الطلب الحالي قبل تقديم طلب جديد.`
    );
    return;
  }

  // لا يوجد طلب نشط → عرض الخدمات
  await clearSession(from);
  const services = await getServices();

  await sendList(from, "👋 مرحباً! اختر الخدمة التي تريدها", "الخدمات", [
    {
      title: "الخدمات المتاحة",
      rows: services.map((s) => ({
        id: "service_" + s.id,
        title: s.name.substring(0, 24),
      })),
    },
  ]);

  await setSession(from, "main", {});
  return;
}

// ===== اختيار الخدمة =====
if (session.state === "main" && text.startsWith("service_")) {
  const services = await getServices();
  const id = text.replace("service_", "");
  const service = services.find((s) => s.id === id);

  if (!service) {
    await sendMessage(from, "❌ خدمة غير موجودة، أرسل *مرحبا* للبدء");
    return;
  }

  await setSession(from, "type", { service });

  await sendList(from, `🔧 ${service.name}\nاختر النوع`, "الأنواع", [
    {
      title: "الأنواع المتاحة",
      rows: service.types.map((t, i) => ({
        id: "type_" + i,
        title: t.name.substring(0, 24),
        description: `${t.price} ريال`,
      })),
    },
  ]);
  return;
}

// ===== اختيار النوع =====
if (session.state === "type" && text.startsWith("type_")) {
  const index = parseInt(text.replace("type_", ""));
  const service = session.data?.service;

  if (!service || isNaN(index) || !service.types?.[index]) {
    await sendMessage(from, "❌ حدث خطأ، أرسل *مرحبا* للبدء من جديد");
    await clearSession(from);
    return;
  }

  const type = service.types[index];

  await setSession(from, "confirm", { service, selectedType: type });

  await sendList(
    from,
    `✅ تأكيد الطلب\n\n🔧 الخدمة: ${service.name}\n📌 النوع: ${type.name}\n💰 السعر: ${type.price} ريال`,
    "الإجراء",
    [
      {
        title: "تأكيد",
        rows: [
          { id: "yes", title: "✅ تأكيد الطلب" },
          { id: "no", title: "❌ إلغاء" },
        ],
      },
    ]
  );
  return;
}

// ===== تأكيد =====
if (session.state === "confirm") {
  if (text === "no") {
    await clearSession(from);
    await sendMessage(from, "❌ تم إلغاء الطلب. أرسل *مرحبا* لطلب خدمة جديدة.");
    return;
  }

  if (text === "yes") {
    await setSession(from, "location", session.data);
    await sendMessage(from, "📍 أرسل موقعك الحالي لإتمام الطلب.");
    return;
  }
}

// ===== الموقع =====
if (session.state === "location") {
  if (msg.type !== "location") {
    await sendMessage(from, "📍 يرجى إرسال الموقع عبر خاصية المشاركة في WhatsApp.");
    return;
  }

  const { service, selectedType } = session.data;

  if (!service || !selectedType) {
    await sendMessage(from, "❌ انتهت الجلسة، أرسل *مرحبا* للبدء.");
    await clearSession(from);
    return;
  }

  const tech = await getAvailableTech(service.id);

  if (!tech) {
    await sendMessage(
      from,
      "❌ لا يوجد فني متاح حالياً، يرجى المحاولة لاحقاً."
    );
    await clearSession(from);
    return;
  }

  // ✅ توليد ID مقروء للطلب
  const orderId = generateOrderId();

  const orderRef = db.collection("orders").doc(orderId);
  await orderRef.set({
    orderId,
    customer: from,
    serviceName: service.name,
    serviceId: service.id,
    type: selectedType.name,
    price: selectedType.price,
    technicianId: tech.id,
    status: "pending",
    location: {
      latitude: msg.location.latitude,
      longitude: msg.location.longitude,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const techPhone = normalize(tech.phone);

  await sendMessage(
    techPhone,
    `📥 طلب جديد!\n\n` +
      `🔖 رقم الطلب: *${orderId}*\n` +
      `🔧 الخدمة: ${service.name}\n` +
      `📌 النوع: ${selectedType.name}\n` +
      `💰 السعر: ${selectedType.price} ريال`
  );

  await sendList(techPhone, "هل تقبل هذا الطلب؟", "اختر", [
    {
      title: "الطلب",
      rows: [
        { id: `accept_${orderId}`, title: "✅ قبول الطلب" },
        { id: `reject_${orderId}`, title: "❌ رفض الطلب" },
      ],
    },
  ]);

  await sendMessage(
    from,
    `🚀 تم إرسال طلبك بنجاح!\n\n🔖 رقم طلبك: *${orderId}*\nاحتفظ بهذا الرقم للمتابعة.\n\nسيتم إشعارك عند قبول الطلب.`
  );

  await clearSession(from);
  return;
}

// رسالة لا تنتمي لأي مرحلة
await sendMessage(from, "أرسل *مرحبا* للبدء.");
```

} catch (err) {
console.error(“WEBHOOK ERROR:”, err);
}
});

// ===== معالج: قبول الطلب =====
async function handleAccept(text, techPhone, tech) {
const orderId = text.replace(“accept_”, “”);
const ref = db.collection(“orders”).doc(orderId);
const snap = await ref.get();

if (!snap.exists) {
await sendMessage(techPhone, “❌ الطلب غير موجود.”);
return;
}

const order = snap.data();

if (order.status !== “pending”) {
await sendMessage(techPhone, “⚠️ تم معالجة هذا الطلب مسبقاً.”);
return;
}

await ref.update({ status: “accepted” });

// تعطيل الفني مؤقتاً
await db.collection(“technicians”).doc(order.technicianId).update({
active: false,
});

const customerPhone = normalize(order.customer);

// إرسال موقع العميل للفني
await sendMessage(techPhone, `📱 بيانات العميل:\nالهاتف: ${customerPhone}`);
if (order.location?.latitude) {
await sendLocation(
techPhone,
order.location.latitude,
order.location.longitude
);
}

// زر إنهاء الطلب للفني
await sendList(techPhone, `🔖 ${orderId}\nبعد إتمام الخدمة اضغط إنهاء`, “إنهاء”, [
{
title: “الطلب”,
rows: [{ id: `done_${orderId}`, title: “✅ إنهاء الطلب” }],
},
]);

// إشعار العميل
await sendMessage(
customerPhone,
`✅ تم قبول طلبك!\n\n` +
`👨‍🔧 الفني: ${tech.name}\n` +
`📱 الهاتف: ${tech.phone}\n` +
`🚗 الفني في طريقه إليك.\n\n` +
`🔖 رقم الطلب: *${orderId}*`
);
}

// ===== معالج: رفض الطلب =====
async function handleReject(text, techPhone) {
const orderId = text.replace(“reject_”, “”);
const ref = db.collection(“orders”).doc(orderId);
const snap = await ref.get();

if (!snap.exists) {
await sendMessage(techPhone, “❌ الطلب غير موجود.”);
return;
}

const order = snap.data();

if (order.status !== “pending”) {
await sendMessage(techPhone, “⚠️ تم معالجة هذا الطلب مسبقاً.”);
return;
}

await ref.update({ status: “rejected” });

const customerPhone = normalize(order.customer);

await sendMessage(techPhone, “تم رفض الطلب.”);
await sendMessage(
customerPhone,
`❌ عذراً، لم يتمكن الفني من قبول طلبك الآن.\n🔖 رقم الطلب: *${orderId}*\n\nأرسل *مرحبا* لإعادة الطلب.`
);
}

// ===== معالج: إنهاء الطلب =====
async function handleDone(text, techPhone, tech) {
const orderId = text.replace(“done_”, “”);
const ref = db.collection(“orders”).doc(orderId);
const snap = await ref.get();

if (!snap.exists) {
await sendMessage(techPhone, “❌ الطلب غير موجود.”);
return;
}

const order = snap.data();

if (order.status === “done”) {
await sendMessage(techPhone, “⚠️ هذا الطلب تم إنهاؤه مسبقاً.”);
return;
}

await ref.update({ status: “done”, completedAt: admin.firestore.FieldValue.serverTimestamp() });

const techRef = db.collection(“technicians”).doc(order.technicianId);
const techData = (await techRef.get()).data();

const fee = order.price * 0.2;
const currentBalance = techData?.balance ?? 0;
const newBalance = Math.max(0, currentBalance - fee); // ✅ لا يصبح سالباً

await techRef.update({ balance: newBalance, active: true });

const customerPhone = normalize(order.customer);

await sendMessage(
customerPhone,
`✅ تم إنجاز طلبك بنجاح!\n🔖 رقم الطلب: *${orderId}*\nشكراً لاستخدامك خدماتنا 🙏`
);

await sendMessage(
techPhone,
`✅ تم إنهاء الطلب *${orderId}*\n💰 رسوم الخدمة: ${fee} ريال\n💳 رصيدك الحالي: ${newBalance} ريال`
);
}

app.listen(process.env.PORT || 3000, () => {
console.log(“🚀 Server running”);
});