const express = require ("express");
const axios = require(“axios”);
const admin = require (“firebase-admin”);
const { v4: uuidv4 } = require(“uuid");

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

// ===== HELPERS =====
const normalize = (p) => String(p).replace(/+/g, “”);

async function getSession(phone) {
const doc = await db.collection(“sessions”).doc(phone).get();
return doc.exists ? doc.data() : { state: null, data: {} };
}

async function setSession(phone, state, data) {
await db.collection(“sessions”).doc(phone).set({ state, data: data || {} });
}

async function clearSession(phone) {
await db.collection(“sessions”).doc(phone).delete();
}

function generateOrderId() {
return “ORD-” + uuidv4().split(”-”)[0].toUpperCase();
}

// ===== SEND =====
async function sendMessage(to, text) {
try {
await axios.post(
“https://graph.facebook.com/v18.0/” + PHONE_NUMBER_ID + “/messages”,
{ messaging_product: “whatsapp”, to: to, text: { body: text } },
{ headers: { Authorization: “Bearer “ + WHATSAPP_TOKEN, “Content-Type”: “application/json” } }
);
} catch (err) {
console.error(“sendMessage error:”, err && err.response && err.response.data || err.message);
}
}

async function sendList(to, body, button, sections) {
try {
await axios.post(
“https://graph.facebook.com/v18.0/” + PHONE_NUMBER_ID + “/messages”,
{
messaging_product: “whatsapp”,
to: to,
type: “interactive”,
interactive: { type: “list”, body: { text: body }, action: { button: button, sections: sections } }
},
{ headers: { Authorization: “Bearer “ + WHATSAPP_TOKEN, “Content-Type”: “application/json” } }
);
} catch (err) {
console.error(“sendList error:”, err && err.response && err.response.data || err.message);
}
}

async function sendLocation(to, lat, lng) {
try {
await axios.post(
“https://graph.facebook.com/v18.0/” + PHONE_NUMBER_ID + “/messages”,
{ messaging_product: “whatsapp”, to: to, type: “location”, location: { latitude: lat, longitude: lng } },
{ headers: { Authorization: “Bearer “ + WHATSAPP_TOKEN, “Content-Type”: “application/json” } }
);
} catch (err) {
console.error(“sendLocation error:”, err && err.response && err.response.data || err.message);
}
}

// ===== DATABASE =====
async function getServices() {
const snap = await db.collection(“services”).get();
return snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
}

async function getTechByPhone(phone) {
const normalized = normalize(phone);
const snap = await db.collection(“technicians”).where(“phone”, “==”, normalized).get();
if (snap.empty) return null;
return Object.assign({ id: snap.docs[0].id }, snap.docs[0].data());
}

async function getAvailableTech(serviceId) {
const snap = await db.collection(“technicians”)
.where(“active”, “==”, true)
.where(“serviceIds”, “array-contains”, serviceId)
.get();
if (snap.empty) return null;
return Object.assign({ id: snap.docs[0].id }, snap.docs[0].data());
}

async function getActiveOrder(customerPhone) {
const snap = await db.collection(“orders”)
.where(“customer”, “==”, customerPhone)
.where(“status”, “in”, [“pending”, “accepted”])
.limit(1)
.get();
if (snap.empty) return null;
return Object.assign({ id: snap.docs[0].id }, snap.docs[0].data());
}

// ===== VERIFY =====
app.get(”/webhook”, function(req, res) {
if (req.query[“hub.verify_token”] === VERIFY_TOKEN) {
return res.send(req.query[“hub.challenge”]);
}
res.sendStatus(403);
});

// ===== WEBHOOK =====
app.post(”/webhook”, async function(req, res) {
res.sendStatus(200);
try {
const msg = req.body.entry &&
req.body.entry[0] &&
req.body.entry[0].changes &&
req.body.entry[0].changes[0] &&
req.body.entry[0].changes[0].value &&
req.body.entry[0].changes[0].value.messages &&
req.body.entry[0].changes[0].value.messages[0];
if (!msg) return;

```
const from = normalize(msg.from);
let text = "";
if (msg.type === "text") {
  text = msg.text.body.trim();
} else if (msg.type === "interactive") {
  text = (msg.interactive && msg.interactive.list_reply && msg.interactive.list_reply.id) ||
         (msg.interactive && msg.interactive.button_reply && msg.interactive.button_reply.id) || "";
}

console.log("FROM:", from, "TEXT:", text, "TYPE:", msg.type);

// ===== فني =====
const techCheck = await getTechByPhone(from);
if (techCheck) {
  if (text.startsWith("accept_")) { await handleAccept(text, from, techCheck); return; }
  if (text.startsWith("reject_")) { await handleReject(text, from); return; }
  if (text.startsWith("done_")) { await handleDone(text, from, techCheck); return; }

  await sendMessage(from,
    "بياناتك\n\n" +
    "الاسم: " + techCheck.name + "\n" +
    "الهاتف: " + techCheck.phone + "\n" +
    "التقييم: " + (techCheck.rating || "لا يوجد") + "\n" +
    "الرصيد: " + (techCheck.balance || 0) + " ريال\n" +
    "الحالة: " + (techCheck.active ? "متاح" : "مشغول") + "\n" +
    "الخدمات: " + ((techCheck.serviceIds || []).join(", "))
  );
  return;
}

// ===== عميل =====
const session = await getSession(from);

if (!session.state || text === "مرحبا") {
  const activeOrder = await getActiveOrder(from);
  if (activeOrder) {
    await sendMessage(from,
      "لديك طلب قيد التنفيذ\n\n" +
      "رقم الطلب: " + activeOrder.orderId + "\n" +
      "الخدمة: " + activeOrder.serviceName + "\n" +
      "النوع: " + activeOrder.type + "\n" +
      "السعر: " + activeOrder.price + " ريال\n" +
      "الحالة: " + (activeOrder.status === "pending" ? "في الانتظار" : "في الطريق") + "\n\n" +
      "يرجى انتظار إنهاء الطلب الحالي."
    );
    return;
  }

  await clearSession(from);
  const services = await getServices();
  await sendList(from, "مرحبا! اختر الخدمة", "الخدمات", [{
    title: "الخدمات المتاحة",
    rows: services.map(function(s) { return { id: "service_" + s.id, title: s.name.substring(0, 24) }; })
  }]);
  await setSession(from, "main", {});
  return;
}

if (session.state === "main" && text.startsWith("service_")) {
  const services = await getServices();
  const id = text.replace("service_", "");
  const service = services.find(function(s) { return s.id === id; });
  if (!service) { await sendMessage(from, "خدمة غير موجودة، ارسل مرحبا للبدء"); return; }
  await setSession(from, "type", { service: service });
  await sendList(from, service.name + "\nاختر النوع", "الانواع", [{
    title: "الانواع المتاحة",
    rows: service.types.map(function(t, i) {
      return { id: "type_" + i, title: t.name.substring(0, 24), description: t.price + " ريال" };
    })
  }]);
  return;
}

if (session.state === "type" && text.startsWith("type_")) {
  const index = parseInt(text.replace("type_", ""));
  const service = session.data && session.data.service;
  if (!service || isNaN(index) || !service.types || !service.types[index]) {
    await sendMessage(from, "حدث خطأ، ارسل مرحبا للبدء");
    await clearSession(from);
    return;
  }
  const type = service.types[index];
  await setSession(from, "confirm", { service: service, selectedType: type });
  await sendList(from,
    "تاكيد الطلب\n\nالخدمة: " + service.name + "\nالنوع: " + type.name + "\nالسعر: " + type.price + " ريال",
    "الاجراء",
    [{ title: "تاكيد", rows: [{ id: "yes", title: "تاكيد الطلب" }, { id: "no", title: "الغاء" }] }]
  );
  return;
}

if (session.state === "confirm") {
  if (text === "no") {
    await clearSession(from);
    await sendMessage(from, "تم الغاء الطلب. ارسل مرحبا لطلب خدمة جديدة.");
    return;
  }
  if (text === "yes") {
    await setSession(from, "location", session.data);
    await sendMessage(from, "ارسل موقعك الحالي لاتمام الطلب.");
    return;
  }
}

if (session.state === "location") {
  if (msg.type !== "location") {
    await sendMessage(from, "يرجى ارسال الموقع عبر خاصية المشاركة في WhatsApp.");
    return;
  }
  const service = session.data && session.data.service;
  const selectedType = session.data && session.data.selectedType;
  if (!service || !selectedType) {
    await sendMessage(from, "انتهت الجلسة، ارسل مرحبا للبدء.");
    await clearSession(from);
    return;
  }
  const tech = await getAvailableTech(service.id);
  if (!tech) {
    await sendMessage(from, "لا يوجد فني متاح حالياً، يرجى المحاولة لاحقاً.");
    await clearSession(from);
    return;
  }
  const orderId = generateOrderId();
  await db.collection("orders").doc(orderId).set({
    orderId: orderId,
    customer: from,
    serviceName: service.name,
    serviceId: service.id,
    type: selectedType.name,
    price: selectedType.price,
    technicianId: tech.id,
    status: "pending",
    location: { latitude: msg.location.latitude, longitude: msg.location.longitude },
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  const techPhone = normalize(tech.phone);
  await sendMessage(techPhone,
    "طلب جديد!\n\nرقم الطلب: " + orderId + "\nالخدمة: " + service.name +
    "\nالنوع: " + selectedType.name + "\nالسعر: " + selectedType.price + " ريال"
  );
  await sendList(techPhone, "هل تقبل هذا الطلب؟", "اختر", [{
    title: "الطلب",
    rows: [
      { id: "accept_" + orderId, title: "قبول الطلب" },
      { id: "reject_" + orderId, title: "رفض الطلب" }
    ]
  }]);
  await sendMessage(from, "تم ارسال طلبك!\n\nرقم طلبك: " + orderId + "\nسيتم اشعارك عند قبول الطلب.");
  await clearSession(from);
  return;
}

await sendMessage(from, "ارسل مرحبا للبدء.");
```

} catch (err) {
console.error(“WEBHOOK ERROR:”, err);
}
});

// ===== قبول =====
async function handleAccept(text, techPhone, tech) {
const orderId = text.replace(“accept_”, “”);
const ref = db.collection(“orders”).doc(orderId);
const snap = await ref.get();
if (!snap.exists) { await sendMessage(techPhone, “الطلب غير موجود.”); return; }
const order = snap.data();
if (order.status !== “pending”) { await sendMessage(techPhone, “تم معالجة هذا الطلب مسبقا.”); return; }
await ref.update({ status: “accepted” });
await db.collection(“technicians”).doc(order.technicianId).update({ active: false });
const customerPhone = normalize(order.customer);
await sendMessage(techPhone, “بيانات العميل:\nالهاتف: “ + customerPhone);
if (order.location && order.location.latitude) {
await sendLocation(techPhone, order.location.latitude, order.location.longitude);
}
await sendList(techPhone, orderId + “\nبعد اتمام الخدمة اضغط انهاء”, “انهاء”, [{
title: “الطلب”,
rows: [{ id: “done_” + orderId, title: “انهاء الطلب” }]
}]);
await sendMessage(customerPhone,
“تم قبول طلبك!\n\nالفني: “ + tech.name + “\nالهاتف: “ + tech.phone +
“\nالفني في طريقه اليك.\n\nرقم الطلب: “ + orderId
);
}

// ===== رفض =====
async function handleReject(text, techPhone) {
const orderId = text.replace(“reject_”, “”);
const ref = db.collection(“orders”).doc(orderId);
const snap = await ref.get();
if (!snap.exists) { await sendMessage(techPhone, “الطلب غير موجود.”); return; }
const order = snap.data();
if (order.status !== “pending”) { await sendMessage(techPhone, “تم معالجة هذا الطلب مسبقا.”); return; }
await ref.update({ status: “rejected” });
const customerPhone = normalize(order.customer);
await sendMessage(techPhone, “تم رفض الطلب.”);
await sendMessage(customerPhone, “عذرا، لم يتمكن الفني من قبول طلبك.\nرقم الطلب: “ + orderId + “\n\nارسل مرحبا لاعادة الطلب.”);
}

// ===== انهاء =====
async function handleDone(text, techPhone, tech) {
const orderId = text.replace(“done_”, “”);
const ref = db.collection(“orders”).doc(orderId);
const snap = await ref.get();
if (!snap.exists) { await sendMessage(techPhone, “الطلب غير موجود.”); return; }
const order = snap.data();
if (order.status === “done”) { await sendMessage(techPhone, “هذا الطلب تم انهاؤه مسبقا.”); return; }
await ref.update({ status: “done”, completedAt: admin.firestore.FieldValue.serverTimestamp() });
const techRef = db.collection(“technicians”).doc(order.technicianId);
const techData = (await techRef.get()).data();
const fee = order.price * 0.2;
const newBalance = Math.max(0, (techData && techData.balance || 0) - fee);
await techRef.update({ balance: newBalance, active: true });
const customerPhone = normalize(order.customer);
await sendMessage(customerPhone, “تم انجاز طلبك بنجاح!\nرقم الطلب: “ + orderId + “\nشكرا لاستخدامك خدماتنا”);
await sendMessage(techPhone, “تم انهاء الطلب “ + orderId + “\nرسوم الخدمة: “ + fee + “ ريال\nرصيدك الحالي: “ + newBalance + “ ريال”);
}

app.listen(process.env.PORT || 3000, function() {
console.log(“Server running”);
});