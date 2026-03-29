const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json());

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY))
  });
}
const db = admin.firestore();

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const normalize = (p) => String(p).replace(/\+/g, "");

// ─── Language Support ───────────────────────────────────────────────────────
const LANGS = {
  ar: {
    welcome: "أهلاً وسهلاً! اختر الخدمة المطلوبة 👇",
    chooseService: "الخدمات المتاحة",
    servicesBtn: "الخدمات",
    chooseType: "اختر النوع",
    typesBtn: "الأنواع",
    confirmTitle: (sName, tName, price) =>
      `تأكيد الطلب\n🔧 الخدمة: ${sName}\n📋 النوع: ${tName}\n💰 السعر: ${price} ريال`,
    confirmBtn: "الإجراء",
    confirmRow: "تأكيد الطلب",
    cancelRow: "إلغاء",
    cancelled: "تم إلغاء الطلب. أرسل *مرحبا* للبدء من جديد.",
    sendLocation: "📍 أرسل موقعك الحالي لإتمام الطلب.",
    locationOnly: "يرجى إرسال موقعك باستخدام ميزة الموقع في واتساب.",
    sessionExpired: "انتهت الجلسة. أرسل *مرحبا* للبدء.",
    noTech: "⚠️ لا يوجد فني متاح الآن. حاول مرة أخرى لاحقاً.",
    orderSent: (id) => `✅ تم إرسال طلبك!\n🆔 رقم الطلب: ${id}\nسيتم إشعارك عند قبول الطلب.`,
    activeOrder: (id, sName, status) =>
      `لديك طلب نشط:\n🆔 ${id}\n🔧 ${sName}\nالحالة: ${statusLabel(status, "ar")}`,
    serviceNotFound: "الخدمة غير موجودة. أرسل *مرحبا* للبدء.",
    typeError: "خطأ. أرسل *مرحبا* للبدء من جديد.",
    defaultMsg: "أرسل *مرحبا* للبدء.",
    techInfo: (name, phone, rating, balance, active, services) =>
      `👤 الاسم: ${name}\n📞 الهاتف: ${phone}\n⭐ التقييم: ${rating || "لا يوجد"}\n💰 الرصيد: ${balance || 0} ريال\n🟢 الحالة: ${active ? "متاح" : "مشغول"}\n🔧 الخدمات: ${services}`,
    newOrder: (id, sName, tName, price) =>
      `🔔 طلب جديد!\n🆔 ${id}\n🔧 ${sName}\n📋 ${tName}\n💰 ${price} ريال`,
    acceptOrder: "هل تقبل هذا الطلب؟",
    acceptBtn: "اختر",
    acceptRow: "قبول الطلب",
    rejectRow: "رفض الطلب",
    customerPhone: (phone) => `📞 هاتف العميل: ${phone}`,
    orderDoneBtn: "إنهاء",
    orderDoneRow: "إنهاء الطلب",
    orderDoneLabel: (id) => `${id} - اضغط عند الإنهاء`,
    accepted: (name, phone) => `✅ تم قبول طلبك!\n👨‍🔧 الفني: ${name}\n📞 ${phone}\nفي الطريق إليك.`,
    rejected: (id) => `❌ عذراً، رفض الفني طلبك.\n🆔 ${id}\nأرسل *مرحبا* للمحاولة مجدداً.`,
    techRejected: "تم رفض الطلب.",
    orderNotFound: "الطلب غير موجود.",
    alreadyProcessed: "الطلب تمت معالجته مسبقاً.",
    alreadyDone: "الطلب مكتمل مسبقاً.",
    completed: (id) => `✅ اكتمل طلبك!\n🆔 ${id}\nشكراً لثقتك بنا! 🙏`,
    techDone: (id, fee, balance) => `✅ الطلب ${id} مكتمل.\n💸 العمولة: ${fee} ريال\n💰 رصيدك: ${balance} ريال`,
    ratePrompt: "⭐ كيف تقيّم خدمة الفني؟",
    rateBtn: "التقييم",
    ratingDone: (stars) => `شكراً على تقييمك! منحت الفني ${stars} ⭐`,
  },
  en: {
    welcome: "Welcome! Please choose a service 👇",
    chooseService: "Available Services",
    servicesBtn: "Services",
    chooseType: "Choose Type",
    typesBtn: "Types",
    confirmTitle: (sName, tName, price) =>
      `Confirm Order\n🔧 Service: ${sName}\n📋 Type: ${tName}\n💰 Price: ${price} SAR`,
    confirmBtn: "Action",
    confirmRow: "Confirm Order",
    cancelRow: "Cancel",
    cancelled: "Order cancelled. Send *mrhba* to start again.",
    sendLocation: "📍 Please send your location to complete the order.",
    locationOnly: "Please send your location using the WhatsApp location feature.",
    sessionExpired: "Session expired. Send *mrhba* to start.",
    noTech: "⚠️ No technician available right now. Please try again later.",
    orderSent: (id) => `✅ Order sent!\n🆔 Order ID: ${id}\nYou'll be notified when accepted.`,
    activeOrder: (id, sName, status) =>
      `You have an active order:\n🆔 ${id}\n🔧 ${sName}\nStatus: ${statusLabel(status, "en")}`,
    serviceNotFound: "Service not found. Send *mrhba* to start.",
    typeError: "Error. Send *mrhba* to restart.",
    defaultMsg: "Send *mrhba* to start.",
    techInfo: (name, phone, rating, balance, active, services) =>
      `👤 Name: ${name}\n📞 Phone: ${phone}\n⭐ Rating: ${rating || "N/A"}\n💰 Balance: ${balance || 0} SAR\n🟢 Status: ${active ? "Available" : "Busy"}\n🔧 Services: ${services}`,
    newOrder: (id, sName, tName, price) =>
      `🔔 New Order!\n🆔 ${id}\n🔧 ${sName}\n📋 ${tName}\n💰 ${price} SAR`,
    acceptOrder: "Do you accept this order?",
    acceptBtn: "Choose",
    acceptRow: "Accept Order",
    rejectRow: "Reject Order",
    customerPhone: (phone) => `📞 Customer phone: ${phone}`,
    orderDoneBtn: "Finish",
    orderDoneRow: "Mark as Done",
    orderDoneLabel: (id) => `${id} - Mark when finished`,
    accepted: (name, phone) => `✅ Order accepted!\n👨‍🔧 Tech: ${name}\n📞 ${phone}\nOn the way!`,
    rejected: (id) => `❌ Sorry, the technician rejected your order.\n🆔 ${id}\nSend *mrhba* to try again.`,
    techRejected: "Order rejected.",
    orderNotFound: "Order not found.",
    alreadyProcessed: "Order already processed.",
    alreadyDone: "Order already completed.",
    completed: (id) => `✅ Order completed!\n🆔 ${id}\nThank you! 🙏`,
    techDone: (id, fee, balance) => `✅ Order ${id} done.\n💸 Fee: ${fee} SAR\n💰 Balance: ${balance} SAR`,
    ratePrompt: "⭐ How would you rate the technician's service?",
    rateBtn: "Rate",
    ratingDone: (stars) => `Thanks for your rating! You gave the technician ${stars} ⭐`,
  }
};

function statusLabel(status, lang) {
  const labels = {
    ar: { pending: "قيد الانتظار", accepted: "مقبول", done: "مكتمل", rejected: "مرفوض" },
    en: { pending: "Pending", accepted: "Accepted", done: "Done", rejected: "Rejected" }
  };
  return (labels[lang] && labels[lang][status]) || status;
}

function getLang(session) {
  return (session && session.data && session.data.lang) || "ar";
}

function t(session, key, ...args) {
  const lang = getLang(session);
  const fn = LANGS[lang][key];
  if (typeof fn === "function") return fn(...args);
  return fn || LANGS["ar"][key] || key;
}

// ─── Firestore Helpers ───────────────────────────────────────────────────────
async function getSession(phone) {
  const doc = await db.collection("sessions").doc(phone).get();
  return doc.exists ? doc.data() : { state: null, data: {} };
}
async function setSession(phone, state, data) {
  await db.collection("sessions").doc(phone).set({ state, data: data || {} });
}
async function clearSession(phone) {
  await db.collection("sessions").doc(phone).delete();
}
function generateOrderId() {
  return "ORD-" + uuidv4().split("-")[0].toUpperCase();
}

// ─── WhatsApp Senders ────────────────────────────────────────────────────────
async function sendMessage(to, text) {
  try {
    await axios.post(
      "https://graph.facebook.com/v18.0/" + PHONE_NUMBER_ID + "/messages",
      { messaging_product: "whatsapp", to, text: { body: text } },
      { headers: { Authorization: "Bearer " + WHATSAPP_TOKEN, "Content-Type": "application/json" } }
    );
  } catch (e) { console.error("sendMessage error:", e && e.message); }
}

async function sendList(to, body, button, sections) {
  try {
    await axios.post(
      "https://graph.facebook.com/v18.0/" + PHONE_NUMBER_ID + "/messages",
      {
        messaging_product: "whatsapp", to, type: "interactive",
        interactive: { type: "list", body: { text: body }, action: { button, sections } }
      },
      { headers: { Authorization: "Bearer " + WHATSAPP_TOKEN, "Content-Type": "application/json" } }
    );
  } catch (e) { console.error("sendList error:", e && e.message); }
}

async function sendLocation(to, lat, lng) {
  try {
    await axios.post(
      "https://graph.facebook.com/v18.0/" + PHONE_NUMBER_ID + "/messages",
      { messaging_product: "whatsapp", to, type: "location", location: { latitude: lat, longitude: lng } },
      { headers: { Authorization: "Bearer " + WHATSAPP_TOKEN, "Content-Type": "application/json" } }
    );
  } catch (e) { console.error("sendLocation error:", e && e.message); }
}

// ─── DB Queries ───────────────────────────────────────────────────────────────
async function getServices() {
  const snap = await db.collection("services").get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function getTechByPhone(phone) {
  const snap = await db.collection("technicians").where("phone", "==", normalize(phone)).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}
async function getAvailableTech(serviceId) {
  const snap = await db.collection("technicians")
    .where("active", "==", true)
    .where("services", "array-contains", serviceId).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}
async function getActiveOrder(phone) {
  const snap = await db.collection("orders")
    .where("customer", "==", phone)
    .where("status", "in", ["pending", "accepted"]).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ─── Rating Helper ────────────────────────────────────────────────────────────
async function updateTechRating(techId, newStars) {
  const ref = db.collection("technicians").doc(techId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data();
    const prevCount = data.ratingCount || 0;
    const prevAvg = data.rating || 0;
    const newCount = prevCount + 1;
    const newAvg = ((prevAvg * prevCount) + newStars) / newCount;
    tx.update(ref, {
      rating: Math.round(newAvg * 10) / 10,
      ratingCount: newCount
    });
  });
}

async function sendRatingPrompt(to, orderId, lang) {
  const stars = [1, 2, 3, 4, 5];
  const rows = stars.map(s => ({
    id: `rate_${orderId}_${s}`,
    title: "⭐".repeat(s),
    description: s === 1 ? (lang === "ar" ? "ضعيف" : "Poor") :
                 s === 2 ? (lang === "ar" ? "مقبول" : "Fair") :
                 s === 3 ? (lang === "ar" ? "جيد" : "Good") :
                 s === 4 ? (lang === "ar" ? "جيد جداً" : "Very Good") :
                           (lang === "ar" ? "ممتاز" : "Excellent")
  }));
  const prompt = lang === "ar" ? LANGS.ar.ratePrompt : LANGS.en.ratePrompt;
  const btn    = lang === "ar" ? LANGS.ar.rateBtn    : LANGS.en.rateBtn;
  await sendList(to, prompt, btn, [{ title: lang === "ar" ? "اختر تقييمك" : "Choose Rating", rows }]);
}

// ─── Webhook ──────────────────────────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) return res.send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body.entry;
    if (!entry || !entry[0]) return;
    const changes = entry[0].changes;
    if (!changes || !changes[0]) return;
    const val = changes[0].value;
    if (!val || !val.messages || !val.messages[0]) return;

    const msg  = val.messages[0];
    const from = normalize(msg.from);
    let text = "";
    if (msg.type === "text") text = msg.text.body.trim();
    else if (msg.type === "interactive") {
      text = (msg.interactive.list_reply   && msg.interactive.list_reply.id)   ||
             (msg.interactive.button_reply && msg.interactive.button_reply.id) || "";
    }
    console.log("FROM:", from, "TEXT:", text);

    // ── Technician commands ──────────────────────────────────────────────────
    const tech = await getTechByPhone(from);
    if (tech) {
      if (text.startsWith("accept_")) { await handleAccept(text, from, tech); return; }
      if (text.startsWith("reject_")) { await handleReject(text, from); return; }
      if (text.startsWith("done_"))   { await handleDone(text, from, tech); return; }
      await sendMessage(from, LANGS.ar.techInfo(
        tech.name, tech.phone,
        tech.rating ? `${tech.rating} (${tech.ratingCount || 0})` : null,
        tech.balance || 0,
        tech.active,
        (tech.serviceIds || []).join(", ")
      ));
      return;
    }

    // ── Determine language ───────────────────────────────────────────────────
    const isStartAr = text === "مرحبا" || text === "مرحبً" || text === "هلا";
    const isStartEn = text === "mrhba"  || text === "hello" || text === "hi";
    const isStart   = isStartAr || isStartEn;
    const lang      = isStartAr ? "ar" : isStartEn ? "en" : null;

    // ── Rating handler (can arrive at any state) ─────────────────────────────
    if (text.startsWith("rate_")) {
      const parts  = text.split("_");           // rate_ORDERID_STARS
      const stars  = parseInt(parts[parts.length - 1]);
      const orderId = parts.slice(1, -1).join("_");
      if (!isNaN(stars) && stars >= 1 && stars <= 5 && orderId) {
        const orderSnap = await db.collection("orders").doc(orderId).get();
        if (orderSnap.exists) {
          const order = orderSnap.data();
          await updateTechRating(order.technicianId, stars);
          await db.collection("orders").doc(orderId).update({ rating: stars });
        }
        const session = await getSession(from);
        const userLang = getLang(session) || "ar";
        await sendMessage(from, userLang === "ar" ? LANGS.ar.ratingDone(stars) : LANGS.en.ratingDone(stars));
      }
      return;
    }

    // ── Session ──────────────────────────────────────────────────────────────
    let session = await getSession(from);

    if (!session.state || isStart) {
      const activeLang = lang || getLang(session) || "ar";
      const L = LANGS[activeLang];
      const activeOrder = await getActiveOrder(from);
      if (activeOrder) {
        await sendMessage(from, L.activeOrder(activeOrder.orderId, activeOrder.serviceName, activeOrder.status));
        return;
      }
      await clearSession(from);
      const services = await getServices();
      await sendList(from, L.welcome, L.servicesBtn, [{
        title: L.chooseService,
        rows: services.map(s => ({ id: "service_" + s.id, title: s.name.substring(0, 24) }))
      }]);
      await setSession(from, "main", { lang: activeLang });
      return;
    }

    const L = LANGS[getLang(session)];

    // ── State: main — user picks a service ───────────────────────────────────
    if (session.state === "main" && text.startsWith("service_")) {
      const services = await getServices();
      const id = text.replace("service_", "");
      const service = services.find(s => s.id === id);
      if (!service) { await sendMessage(from, L.serviceNotFound); return; }
      await setSession(from, "type", { ...session.data, service });
      await sendList(from, `${service.name}\n${L.chooseType}`, L.typesBtn, [{
        title: L.chooseType,
        rows: service.types.map((t, i) => ({
          id: "type_" + i,
          title: t.name.substring(0, 24),
          description: t.price + " SAR"
        }))
      }]);
      return;
    }

    // ── State: type — user picks a type ─────────────────────────────────────
    if (session.state === "type" && text.startsWith("type_")) {
      const index = parseInt(text.replace("type_", ""));
      const service = session.data && session.data.service;
      if (!service || isNaN(index) || !service.types[index]) {
        await sendMessage(from, L.typeError); await clearSession(from); return;
      }
      const type = service.types[index];
      await setSession(from, "confirm", { ...session.data, selectedType: type });
      await sendList(from,
        L.confirmTitle(service.name, type.name, type.price),
        L.confirmBtn,
        [{ title: L.confirmBtn, rows: [{ id: "yes", title: L.confirmRow }, { id: "no", title: L.cancelRow }] }]
      );
      return;
    }

    // ── State: confirm ────────────────────────────────────────────────────────
    if (session.state === "confirm") {
      if (text === "no") {
        await clearSession(from);
        await sendMessage(from, L.cancelled);
        return;
      }
      if (text === "yes") {
        await setSession(from, "location", session.data);
        await sendMessage(from, L.sendLocation);
        return;
      }
    }

    // ── State: location ───────────────────────────────────────────────────────
    if (session.state === "location") {
      if (msg.type !== "location") { await sendMessage(from, L.locationOnly); return; }
      const service      = session.data && session.data.service;
      const selectedType = session.data && session.data.selectedType;
      const userLang     = getLang(session);
      if (!service || !selectedType) {
        await sendMessage(from, L.sessionExpired); await clearSession(from); return;
      }
      const availableTech = await getAvailableTech(service.id);
      if (!availableTech) { await sendMessage(from, L.noTech); await clearSession(from); return; }
      const orderId = generateOrderId();
      await db.collection("orders").doc(orderId).set({
        orderId, customer: from,
        serviceName: service.name, serviceId: service.id,
        type: selectedType.name, price: selectedType.price,
        technicianId: availableTech.id,
        status: "pending",
        lang: userLang,
        location: { latitude: msg.location.latitude, longitude: msg.location.longitude },
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      const techPhone = normalize(availableTech.phone);
      // Tech always gets Arabic (internal) — adjust if techs can also have lang
      await sendMessage(techPhone, LANGS.ar.newOrder(orderId, service.name, selectedType.name, selectedType.price));
      await sendList(techPhone, LANGS.ar.acceptOrder, LANGS.ar.acceptBtn, [{
        title: "Order",
        rows: [{ id: "accept_" + orderId, title: LANGS.ar.acceptRow }, { id: "reject_" + orderId, title: LANGS.ar.rejectRow }]
      }]);
      await sendMessage(from, L.orderSent(orderId));
      await clearSession(from);
      return;
    }

    await sendMessage(from, L.defaultMsg);
  } catch (err) { console.error("WEBHOOK ERROR:", err); }
});

// ─── Tech Action Handlers ─────────────────────────────────────────────────────
async function handleAccept(text, techPhone, tech) {
  const orderId = text.replace("accept_", "");
  const ref = db.collection("orders").doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) { await sendMessage(techPhone, LANGS.ar.orderNotFound); return; }
  const order = snap.data();
  if (order.status !== "pending") { await sendMessage(techPhone, LANGS.ar.alreadyProcessed); return; }
  await ref.update({ status: "accepted" });
  await db.collection("technicians").doc(order.technicianId).update({ active: false });

  const customerPhone = normalize(order.customer);
  const customerLang  = order.lang || "ar";
  const CL = LANGS[customerLang];

  await sendMessage(techPhone, LANGS.ar.customerPhone(customerPhone));
  if (order.location && order.location.latitude) {
    await sendLocation(techPhone, order.location.latitude, order.location.longitude);
  }
  await sendList(techPhone, LANGS.ar.orderDoneLabel(orderId), LANGS.ar.orderDoneBtn, [{
    title: "Order",
    rows: [{ id: "done_" + orderId, title: LANGS.ar.orderDoneRow }]
  }]);
  await sendMessage(customerPhone, CL.accepted(tech.name, tech.phone));
}

async function handleReject(text, techPhone) {
  const orderId = text.replace("reject_", "");
  const ref = db.collection("orders").doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) { await sendMessage(techPhone, LANGS.ar.orderNotFound); return; }
  const order = snap.data();
  if (order.status !== "pending") { await sendMessage(techPhone, LANGS.ar.alreadyProcessed); return; }
  await ref.update({ status: "rejected" });
  await sendMessage(techPhone, LANGS.ar.techRejected);

  const customerLang = order.lang || "ar";
  await sendMessage(normalize(order.customer), LANGS[customerLang].rejected(orderId));
}

async function handleDone(text, techPhone, tech) {
  const orderId = text.replace("done_", "");
  const ref = db.collection("orders").doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) { await sendMessage(techPhone, LANGS.ar.orderNotFound); return; }
  const order = snap.data();
  if (order.status === "done") { await sendMessage(techPhone, LANGS.ar.alreadyDone); return; }

  await ref.update({ status: "done", completedAt: admin.firestore.FieldValue.serverTimestamp() });

  const techRef  = db.collection("technicians").doc(order.technicianId);
  const techData = (await techRef.get()).data();
  const fee      = Math.round(order.price * 0.2 * 100) / 100;
  const newBalance = Math.max(0, ((techData && techData.balance) || 0) - fee);
  await techRef.update({ balance: newBalance, active: true });

  await sendMessage(techPhone, LANGS.ar.techDone(orderId, fee, newBalance));

  // Notify customer and ask for rating
  const customerPhone = normalize(order.customer);
  const customerLang  = order.lang || "ar";
  await sendMessage(customerPhone, LANGS[customerLang].completed(orderId));
  await sendRatingPrompt(customerPhone, orderId, customerLang);
}

app.listen(process.env.PORT || 3000, () => console.log("✅ Server running"));
const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json());

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY))
  });
}
const db = admin.firestore();

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const normalize = (p) => String(p).replace(/\+/g, "");

async function getSession(phone) {
  const doc = await db.collection("sessions").doc(phone).get();
  return doc.exists ? doc.data() : { state: null, data: {} };
}
async function setSession(phone, state, data) {
  await db.collection("sessions").doc(phone).set({ state, data: data || {} });
}
async function clearSession(phone) {
  await db.collection("sessions").doc(phone).delete();
}
function generateOrderId() {
  return "ORD-" + uuidv4().split("-")[0].toUpperCase();
}

async function sendMessage(to, text) {
  try {
    await axios.post(
      "https://graph.facebook.com/v18.0/" + PHONE_NUMBER_ID + "/messages",
      { messaging_product: "whatsapp", to: to, text: { body: text } },
      { headers: { Authorization: "Bearer " + WHATSAPP_TOKEN, "Content-Type": "application/json" } }
    );
  } catch (e) { console.error("sendMessage:", e && e.message); }
}

async function sendList(to, body, button, sections) {
  try {
    await axios.post(
      "https://graph.facebook.com/v18.0/" + PHONE_NUMBER_ID + "/messages",
      { messaging_product: "whatsapp", to: to, type: "interactive",
        interactive: { type: "list", body: { text: body }, action: { button: button, sections: sections } } },
      { headers: { Authorization: "Bearer " + WHATSAPP_TOKEN, "Content-Type": "application/json" } }
    );
  } catch (e) { console.error("sendList:", e && e.message); }
}

async function sendLocation(to, lat, lng) {
  try {
    await axios.post(
      "https://graph.facebook.com/v18.0/" + PHONE_NUMBER_ID + "/messages",
      { messaging_product: "whatsapp", to: to, type: "location", location: { latitude: lat, longitude: lng } },
      { headers: { Authorization: "Bearer " + WHATSAPP_TOKEN, "Content-Type": "application/json" } }
    );
  } catch (e) { console.error("sendLocation:", e && e.message); }
}

async function getServices() {
  const snap = await db.collection("services").get();
  return snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
}
async function getTechByPhone(phone) {
  const snap = await db.collection("technicians").where("phone", "==", normalize(phone)).get();
  if (snap.empty) return null;
  return Object.assign({ id: snap.docs[0].id }, snap.docs[0].data());
}
async function getAvailableTech(serviceId) {
  const snap = await db.collection("technicians")
    .where("active", "==", true)
    .where("services", "array-contains", serviceId).get();
  if (snap.empty) return null;
  return Object.assign({ id: snap.docs[0].id }, snap.docs[0].data());
}
async function getActiveOrder(phone) {
  const snap = await db.collection("orders")
    .where("customer", "==", phone)
    .where("status", "in", ["pending", "accepted"]).limit(1).get();
  if (snap.empty) return null;
  return Object.assign({ id: snap.docs[0].id }, snap.docs[0].data());
}

app.get("/webhook", function(req, res) {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) return res.send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

app.post("/webhook", async function(req, res) {
  res.sendStatus(200);
  try {
    var entry = req.body.entry;
    if (!entry || !entry[0]) return;
    var changes = entry[0].changes;
    if (!changes || !changes[0]) return;
    var val = changes[0].value;
    if (!val || !val.messages || !val.messages[0]) return;
    var msg = val.messages[0];
    var from = normalize(msg.from);
    var text = "";
    if (msg.type === "text") text = msg.text.body.trim();
    else if (msg.type === "interactive") {
      text = (msg.interactive.list_reply && msg.interactive.list_reply.id) ||
             (msg.interactive.button_reply && msg.interactive.button_reply.id) || "";
    }
    console.log("FROM:", from, "TEXT:", text);

    var tech = await getTechByPhone(from);
    if (tech) {
      if (text.indexOf("accept_") === 0) { await handleAccept(text, from, tech); return; }
      if (text.indexOf("reject_") === 0) { await handleReject(text, from); return; }
      if (text.indexOf("done_") === 0) { await handleDone(text, from, tech); return; }
      await sendMessage(from,
        "Name: " + tech.name + "\nPhone: " + tech.phone +
        "\nRating: " + (tech.rating || "N/A") +
        "\nBalance: " + (tech.balance || 0) +
        "\nStatus: " + (tech.active ? "Available" : "Busy") +
        "\nServices: " + ((tech.serviceIds || []).join(", "))
      );
      return;
    }

    var session = await getSession(from);
    if (!session.state || text === "mrhba") {
      var activeOrder = await getActiveOrder(from);
      if (activeOrder) {
        await sendMessage(from,
          "You have an active order\nID: " + activeOrder.orderId +
          "\nService: " + activeOrder.serviceName +
          "\nStatus: " + activeOrder.status
        );
        return;
      }
      await clearSession(from);
      var services = await getServices();
      await sendList(from, "Welcome! Choose a service", "Services", [{
        title: "Available Services",
        rows: services.map(function(s) { return { id: "service_" + s.id, title: s.name.substring(0, 24) }; })
      }]);
      await setSession(from, "main", {});
      return;
    }

    if (session.state === "main" && text.indexOf("service_") === 0) {
      var services = await getServices();
      var id = text.replace("service_", "");
      var service = services.find(function(s) { return s.id === id; });
      if (!service) { await sendMessage(from, "Service not found. Send mrhba to start."); return; }
      await setSession(from, "type", { service: service });
      await sendList(from, service.name + " - Choose type", "Types", [{
        title: "Available Types",
        rows: service.types.map(function(t, i) {
          return { id: "type_" + i, title: t.name.substring(0, 24), description: t.price + " SAR" };
        })
      }]);
      return;
    }

    if (session.state === "type" && text.indexOf("type_") === 0) {
      var index = parseInt(text.replace("type_", ""));
      var service = session.data && session.data.service;
      if (!service || isNaN(index) || !service.types[index]) {
        await sendMessage(from, "Error. Send mrhba to restart."); await clearSession(from); return;
      }
      var type = service.types[index];
      await setSession(from, "confirm", { service: service, selectedType: type });
      await sendList(from,
        "Confirm Order\nService: " + service.name + "\nType: " + type.name + "\nPrice: " + type.price + " SAR",
        "Action", [{ title: "Confirm", rows: [{ id: "yes", title: "Confirm Order" }, { id: "no", title: "Cancel" }] }]
      );
      return;
    }

    if (session.state === "confirm") {
      if (text === "no") { await clearSession(from); await sendMessage(from, "Order cancelled. Send mrhba to start."); return; }
      if (text === "yes") { await setSession(from, "location", session.data); await sendMessage(from, "Send your location to complete the order."); return; }
    }

    if (session.state === "location") {
      if (msg.type !== "location") { await sendMessage(from, "Please send your location using WhatsApp location feature."); return; }
      var service = session.data && session.data.service;
      var selectedType = session.data && session.data.selectedType;
      if (!service || !selectedType) { await sendMessage(from, "Session expired. Send mrhba."); await clearSession(from); return; }
      var tech = await getAvailableTech(service.id);
      if (!tech) { await sendMessage(from, "No technician available. Try later."); await clearSession(from); return; }
      var orderId = generateOrderId();
      await db.collection("orders").doc(orderId).set({
        orderId: orderId, customer: from, serviceName: service.name, serviceId: service.id,
        type: selectedType.name, price: selectedType.price, technicianId: tech.id, status: "pending",
        location: { latitude: msg.location.latitude, longitude: msg.location.longitude },
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      var techPhone = normalize(tech.phone);
      await sendMessage(techPhone, "New Order!\nID: " + orderId + "\nService: " + service.name + "\nType: " + selectedType.name + "\nPrice: " + selectedType.price + " SAR");
      await sendList(techPhone, "Accept this order?", "Choose", [{ title: "Order", rows: [{ id: "accept_" + orderId, title: "Accept" }, { id: "reject_" + orderId, title: "Reject" }] }]);
      await sendMessage(from, "Order sent!\nOrder ID: " + orderId + "\nYou will be notified when accepted.");
      await clearSession(from);
      return;
    }

    await sendMessage(from, "Send mrhba to start.");
  } catch (err) { console.error("WEBHOOK ERROR:", err); }
});

async function handleAccept(text, techPhone, tech) {
  var orderId = text.replace("accept_", "");
  var ref = db.collection("orders").doc(orderId);
  var snap = await ref.get();
  if (!snap.exists) { await sendMessage(techPhone, "Order not found."); return; }
  var order = snap.data();
  if (order.status !== "pending") { await sendMessage(techPhone, "Order already processed."); return; }
  await ref.update({ status: "accepted" });
  await db.collection("technicians").doc(order.technicianId).update({ active: false });
  var customerPhone = normalize(order.customer);
  await sendMessage(techPhone, "Customer phone: " + customerPhone);
  if (order.location && order.location.latitude) await sendLocation(techPhone, order.location.latitude, order.location.longitude);
  await sendList(techPhone, orderId + " - Finish when done", "Done", [{ title: "Order", rows: [{ id: "done_" + orderId, title: "Finish Order" }] }]);
  await sendMessage(customerPhone, "Order accepted!\nTech: " + tech.name + "\nPhone: " + tech.phone + "\nOn the way.\nOrder ID: " + orderId);
}

async function handleReject(text, techPhone) {
  var orderId = text.replace("reject_", "");
  var ref = db.collection("orders").doc(orderId);
  var snap = await ref.get();
  if (!snap.exists) { await sendMessage(techPhone, "Order not found."); return; }
  var order = snap.data();
  if (order.status !== "pending") { await sendMessage(techPhone, "Order already processed."); return; }
  await ref.update({ status: "rejected" });
  await sendMessage(techPhone, "Order rejected.");
  await sendMessage(normalize(order.customer), "Sorry, technician rejected your order.\nID: " + orderId + "\nSend mrhba to retry.");
}

async function handleDone(text, techPhone, tech) {
  var orderId = text.replace("done_", "");
  var ref = db.collection("orders").doc(orderId);
  var snap = await ref.get();
  if (!snap.exists) { await sendMessage(techPhone, "Order not found."); return; }
  var order = snap.data();
  if (order.status === "done") { await sendMessage(techPhone, "Order already completed."); return; }
  await ref.update({ status: "done", completedAt: admin.firestore.FieldValue.serverTimestamp() });
  var techRef = db.collection("technicians").doc(order.technicianId);
  var techData = (await techRef.get()).data();
  var fee = order.price * 0.2;
  var newBalance = Math.max(0, ((techData && techData.balance) || 0) - fee);
  await techRef.update({ balance: newBalance, active: true });
  await sendMessage(normalize(order.customer), "Order completed!\nID: " + orderId + "\nThank you!");
  await sendMessage(techPhone, "Order " + orderId + " done.\nFee: " + fee + " SAR\nBalance: " + newBalance + " SAR");
}

app.listen(process.env.PORT || 3000, function() { console.log("Server running"); });
