const express = require("express");
const axios   = require("axios");
const admin   = require("firebase-admin");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json());

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY))
  });
}
const db = admin.firestore();

const VERIFY_TOKEN    = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN  = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const normalize = (p) => String(p).replace(/\+/g, "");

// ─── Messages ─────────────────────────────────────────────────────────────────
const MSG = {
  ar: {
    welcome:       "مرحباً! اختر الخدمة المطلوبة 👇",
    servicesBtn:   "الخدمات",
    servicesTitle: "الخدمات المتاحة",
    choosePart:    (svc) => `اختر قطعة من خدمة "${svc}" 🔧`,
    partsBtn:      "القطع",
    partsTitle:    "القطع المتاحة",
    addedPart:     (name, qty, price) => `✅ تمت الإضافة: ${name} x${qty} = ${price} ريال`,
    chooseQty:     (name, price) => `كم قطعة من "${name}"؟\n(${price} ريال للقطعة)`,
    qtyBtn:        "الكمية",
    qtyTitle:      "اختر الكمية",
    addMore:       "هل تريد إضافة قطعة أخرى؟",
    addMoreBtn:    "اختر",
    yesMore:       "نعم، أضف قطعة",
    noMore:        "لا، انتهيت",
    summary:       (lines, total) => `📋 ملخص طلبك:\n\n${lines}\n💰 الإجمالي: ${total} ريال`,
    confirmBtn:    "تأكيد",
    confirmRow:    "✅ تأكيد الطلب",
    cancelRow:     "❌ إلغاء",
    cancelled:     "تم الإلغاء. أرسل *مرحبا* للبدء من جديد.",
    sendLocation:  "📍 أرسل موقعك لإتمام الطلب.",
    locationOnly:  "يرجى إرسال موقعك عبر واتساب.",
    sessionExp:    "انتهت الجلسة. أرسل *مرحبا* للبدء.",
    noTech:        "⚠️ لا يوجد فني متاح الآن. حاول لاحقاً.",
    noParts:       "لا توجد قطع لهذه الخدمة.",
    orderSent:     (id) => `✅ تم إرسال طلبك!\n🆔 رقم الطلب: ${id}\nسيتم إشعارك عند قبول الفني.`,
    activeOrder:   (id, st) => `لديك طلب نشط:\n🆔 ${id}\nالحالة: ${st}`,
    defaultMsg:    "أرسل *مرحبا* للبدء.",
    techNewOrder:  (id, svc, lines, total) => `🔔 طلب جديد!\n🆔 ${id}\n🔧 ${svc}\n\n${lines}\n💰 الإجمالي: ${total} ريال`,
    acceptBtn:     "اختر",
    acceptRow:     "✅ قبول الطلب",
    rejectRow:     "❌ رفض الطلب",
    accepted:      (name, phone) => `✅ تم قبول طلبك!\n👨‍🔧 الفني: ${name}\n📞 ${phone}\nفي الطريق إليك.`,
    rejected:      (id) => `❌ رفض الفني طلبك.\n🆔 ${id}\nأرسل *مرحبا* للمحاولة مجدداً.`,
    techRejected:  "تم رفض الطلب.",
    completed:     (id, lines, total) => `✅ اكتمل طلبك!\n🆔 ${id}\n\n${lines}\n💰 الإجمالي: ${total} ريال\nشكراً لثقتك بنا! 🙏`,
    techDone:      (id, fee, bal) => `✅ الطلب ${id} مكتمل.\n💸 العمولة: ${fee} ريال\n💰 رصيدك: ${bal} ريال`,
    ratePrompt:    "⭐ كيف تقيّم خدمة الفني؟",
    rateBtn:       "التقييم",
    ratingDone:    (s) => `شكراً على تقييمك! منحت الفني ${s} ⭐`,
    orderNotFound: "الطلب غير موجود.",
    alreadyDone:   "الطلب مكتمل مسبقاً.",
    alreadyProc:   "الطلب تمت معالجته.",
    custPhone:     (p) => `📞 هاتف العميل: ${p}`,
    doneBtn:       "إنهاء",
    doneRow:       "✅ إنهاء الطلب",
    doneLabel:     (id) => `${id} — اضغط عند الإنهاء`,
    techInfo:      (name, phone, rating, count, balance, active) =>
      `👤 ${name}\n📞 ${phone}\n⭐ ${rating ? rating.toFixed(1) + " (" + count + ")" : "لا يوجد"}\n💰 ${balance || 0} ريال\n🟢 ${active ? "متاح" : "مشغول"}`,
    statusLabels:  { pending:"قيد الانتظار", accepted:"مقبول", done:"مكتمل", rejected:"مرفوض" }
  },
  en: {
    welcome:       "Welcome! Choose a service 👇",
    servicesBtn:   "Services",
    servicesTitle: "Available Services",
    choosePart:    (svc) => `Choose a part for "${svc}" 🔧`,
    partsBtn:      "Parts",
    partsTitle:    "Available Parts",
    addedPart:     (name, qty, price) => `✅ Added: ${name} x${qty} = ${price} SAR`,
    chooseQty:     (name, price) => `How many "${name}"?\n(${price} SAR each)`,
    qtyBtn:        "Qty",
    qtyTitle:      "Choose Quantity",
    addMore:       "Add another part?",
    addMoreBtn:    "Choose",
    yesMore:       "Yes, add part",
    noMore:        "No, done",
    summary:       (lines, total) => `📋 Order Summary:\n\n${lines}\n💰 Total: ${total} SAR`,
    confirmBtn:    "Confirm",
    confirmRow:    "✅ Confirm Order",
    cancelRow:     "❌ Cancel",
    cancelled:     "Cancelled. Send *mrhba* to start again.",
    sendLocation:  "📍 Send your location to complete the order.",
    locationOnly:  "Please send your location via WhatsApp.",
    sessionExp:    "Session expired. Send *mrhba* to start.",
    noTech:        "⚠️ No technician available. Try later.",
    noParts:       "No parts available for this service.",
    orderSent:     (id) => `✅ Order sent!\n🆔 Order ID: ${id}\nYou will be notified when accepted.`,
    activeOrder:   (id, st) => `Active order:\n🆔 ${id}\nStatus: ${st}`,
    defaultMsg:    "Send *mrhba* to start.",
    techNewOrder:  (id, svc, lines, total) => `🔔 New Order!\n🆔 ${id}\n🔧 ${svc}\n\n${lines}\n💰 Total: ${total} SAR`,
    acceptBtn:     "Choose",
    acceptRow:     "✅ Accept Order",
    rejectRow:     "❌ Reject Order",
    accepted:      (name, phone) => `✅ Order accepted!\n👨‍🔧 Tech: ${name}\n📞 ${phone}\nOn the way!`,
    rejected:      (id) => `❌ Technician rejected your order.\n🆔 ${id}\nSend *mrhba* to retry.`,
    techRejected:  "Order rejected.",
    completed:     (id, lines, total) => `✅ Order completed!\n🆔 ${id}\n\n${lines}\n💰 Total: ${total} SAR\nThank you! 🙏`,
    techDone:      (id, fee, bal) => `✅ Order ${id} done.\n💸 Fee: ${fee} SAR\n💰 Balance: ${bal} SAR`,
    ratePrompt:    "⭐ Rate the technician's service:",
    rateBtn:       "Rate",
    ratingDone:    (s) => `Thanks for rating! You gave ${s} ⭐`,
    orderNotFound: "Order not found.",
    alreadyDone:   "Order already completed.",
    alreadyProc:   "Order already processed.",
    custPhone:     (p) => `📞 Customer phone: ${p}`,
    doneBtn:       "Finish",
    doneRow:       "✅ Mark as Done",
    doneLabel:     (id) => `${id} — Mark when finished`,
    techInfo:      (name, phone, rating, count, balance, active) =>
      `👤 ${name}\n📞 ${phone}\n⭐ ${rating ? rating.toFixed(1) + " (" + count + ")" : "N/A"}\n💰 ${balance || 0} SAR\n🟢 ${active ? "Available" : "Busy"}`,
    statusLabels:  { pending:"Pending", accepted:"Accepted", done:"Done", rejected:"Rejected" }
  }
};

function m(session, key, ...args) {
  const lang = (session && session.data && session.data.lang) || "ar";
  const fn   = MSG[lang][key];
  return typeof fn === "function" ? fn(...args) : fn;
}

function sl(status, lang) {
  return (MSG[lang] && MSG[lang].statusLabels && MSG[lang].statusLabels[status]) || status;
}

// ─── Session ──────────────────────────────────────────────────────────────────
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

// ─── WhatsApp Senders ─────────────────────────────────────────────────────────
async function sendMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, text: { body: text } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch(e) { console.error("sendMessage:", e && e.message); }
}

async function sendList(to, body, button, sections) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp", to, type: "interactive",
        interactive: { type: "list", body: { text: body }, action: { button, sections } }
      },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch(e) { console.error("sendList:", e && e.message); }
}

async function sendLocation(to, lat, lng) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, type: "location", location: { latitude: lat, longitude: lng } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch(e) { console.error("sendLocation:", e && e.message); }
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────
async function getServices() {
  const snap = await db.collection("services").get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function getPartsByService(serviceId) {
  const snap = await db.collection("parts").where("serviceId", "==", serviceId).get();
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

// ─── Summary Builder ──────────────────────────────────────────────────────────
function buildSummary(parts, lang) {
  const isar = lang === "ar";
  let total = 0;
  const lines = parts.map(p => {
    const sub = p.price * p.qty;
    total += sub;
    return `▪️ ${p.name} x${p.qty} = ${sub} ${isar ? "ريال" : "SAR"}`;
  });
  return { text: lines.join("\n"), total };
}

// ─── Rating ───────────────────────────────────────────────────────────────────
async function updateTechRating(techId, stars) {
  const ref = db.collection("technicians").doc(techId);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const d = snap.data();
    const count  = (d.ratingCount || 0) + 1;
    const newAvg = (((d.rating || 0) * (d.ratingCount || 0)) + stars) / count;
    tx.update(ref, { rating: Math.round(newAvg * 10) / 10, ratingCount: count });
  });
}

async function sendRatingPrompt(to, orderId, lang) {
  const L = MSG[lang];
  const rows = [1,2,3,4,5].map(s => ({
    id:    `rate_${orderId}_${s}`,
    title: "⭐".repeat(s),
    description: ["ضعيف","مقبول","جيد","جيد جداً","ممتاز"][s-1]
  }));
  await sendList(to, L.ratePrompt, L.rateBtn, [{ title: "⭐", rows }]);
}

// ─── Parts Flow Helper ────────────────────────────────────────────────────────
async function sendPartsMenu(to, session, serviceId, serviceName) {
  const parts = await getPartsByService(serviceId);
  const lang  = session.data.lang || "ar";
  const L     = MSG[lang];
  if (!parts.length) { await sendMessage(to, L.noParts); return false; }

  // max 10 rows per section in WhatsApp list
  const rows = parts.slice(0, 10).map(p => ({
    id:          `part_${p.id}`,
    title:       p.name.substring(0, 24),
    description: `${p.price} ${lang === "ar" ? "ريال" : "SAR"}`
  }));
  await sendList(to, L.choosePart(serviceName), L.partsBtn, [{ title: L.partsTitle, rows }]);
  return true;
}

async function sendQtyMenu(to, partName, partPrice, lang) {
  const L    = MSG[lang];
  const rows = [1,2,3,4,5].map(q => ({
    id:    `qty_${q}`,
    title: String(q),
    description: `${q * partPrice} ${lang === "ar" ? "ريال" : "SAR"}`
  }));
  await sendList(to, L.chooseQty(partName, partPrice), L.qtyBtn, [{ title: L.qtyTitle, rows }]);
}

async function sendAddMoreMenu(to, lang) {
  const L = MSG[lang];
  await sendList(to, L.addMore, L.addMoreBtn, [{
    title: "؟",
    rows: [
      { id: "more_yes", title: L.yesMore },
      { id: "more_no",  title: L.noMore  }
    ]
  }]);
}

async function sendSummaryConfirm(to, session) {
  const lang   = session.data.lang || "ar";
  const L      = MSG[lang];
  const parts  = session.data.parts || [];
  const { text, total } = buildSummary(parts, lang);
  await sendList(to, L.summary(text, total), L.confirmBtn, [{
    title: "؟",
    rows: [
      { id: "confirm_yes", title: L.confirmRow },
      { id: "confirm_no",  title: L.cancelRow  }
    ]
  }]);
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

    // ── Technician ────────────────────────────────────────────────────────────
    const tech = await getTechByPhone(from);
    if (tech) {
      if (text.startsWith("accept_")) { await handleAccept(text, from, tech); return; }
      if (text.startsWith("reject_")) { await handleReject(text, from);       return; }
      if (text.startsWith("done_"))   { await handleDone(text, from, tech);   return; }
      await sendMessage(from, MSG.ar.techInfo(tech.name, tech.phone, tech.rating, tech.ratingCount, tech.balance, tech.active));
      return;
    }

    // ── Rating ────────────────────────────────────────────────────────────────
    if (text.startsWith("rate_")) {
      const parts   = text.split("_");
      const stars   = parseInt(parts[parts.length - 1]);
      const orderId = parts.slice(1, -1).join("_");
      if (!isNaN(stars) && stars >= 1 && stars <= 5 && orderId) {
        const snap = await db.collection("orders").doc(orderId).get();
        if (snap.exists) {
          await updateTechRating(snap.data().technicianId, stars);
          await db.collection("orders").doc(orderId).update({ rating: stars });
        }
        const session = await getSession(from);
        const lang    = (session.data && session.data.lang) || "ar";
        await sendMessage(from, MSG[lang].ratingDone(stars));
      }
      return;
    }

    // ── Customer Session ──────────────────────────────────────────────────────
    const isStartAr = ["مرحبا","مرحبً","هلا","اهلا"].includes(text);
    const isStartEn = ["mrhba","hello","hi"].includes(text.toLowerCase());
    const isStart   = isStartAr || isStartEn;
    const newLang   = isStartAr ? "ar" : isStartEn ? "en" : null;

    let session = await getSession(from);
    const lang  = (session.data && session.data.lang) || newLang || "ar";
    const L     = MSG[lang];

    // ── Start ─────────────────────────────────────────────────────────────────
    if (!session.state || isStart) {
      const activeOrder = await getActiveOrder(from);
      if (activeOrder) {
        await sendMessage(from, L.activeOrder(activeOrder.orderId, sl(activeOrder.status, lang)));
        return;
      }
      await clearSession(from);
      const services = await getServices();
      await sendList(from, L.welcome, L.servicesBtn, [{
        title: L.servicesTitle,
        rows:  services.map(s => ({ id: `svc_${s.id}`, title: s.name.substring(0, 24) }))
      }]);
      await setSession(from, "choose_service", { lang: newLang || lang });
      return;
    }

    // ── Step 1: Choose Service ─────────────────────────────────────────────────
    if (session.state === "choose_service" && text.startsWith("svc_")) {
      const serviceId = text.replace("svc_", "");
      const services  = await getServices();
      const service   = services.find(s => s.id === serviceId);
      if (!service) { await sendMessage(from, L.defaultMsg); return; }

      await setSession(from, "choose_part", {
        lang,
        serviceId:   service.id,
        serviceName: service.name,
        parts:       [],
        pendingPart: null
      });
      await sendPartsMenu(from, { data: { lang } }, service.id, service.name);
      return;
    }

    // ── Step 2: Choose Part ────────────────────────────────────────────────────
    if (session.state === "choose_part" && text.startsWith("part_")) {
      const partId = text.replace("part_", "");
      const parts  = await getPartsByService(session.data.serviceId);
      const part   = parts.find(p => p.id === partId);
      if (!part) { await sendMessage(from, L.defaultMsg); return; }

      await setSession(from, "choose_qty", {
        ...session.data,
        pendingPart: { id: part.id, name: part.name, price: part.price }
      });
      await sendQtyMenu(from, part.name, part.price, lang);
      return;
    }

    // ── Step 3: Choose Quantity ────────────────────────────────────────────────
    if (session.state === "choose_qty" && text.startsWith("qty_")) {
      const qty  = parseInt(text.replace("qty_", ""));
      const part = session.data.pendingPart;
      if (!part || isNaN(qty)) { await sendMessage(from, L.defaultMsg); return; }

      const updatedParts = [...(session.data.parts || [])];
      const existing     = updatedParts.findIndex(p => p.id === part.id);
      if (existing >= 0) {
        updatedParts[existing].qty += qty;
      } else {
        updatedParts.push({ id: part.id, name: part.name, price: part.price, qty });
      }

      await sendMessage(from, L.addedPart(part.name, qty, part.price * qty));
      await setSession(from, "add_more", { ...session.data, parts: updatedParts, pendingPart: null });
      await sendAddMoreMenu(from, lang);
      return;
    }

    // ── Step 4: Add More or Done ───────────────────────────────────────────────
    if (session.state === "add_more") {
      if (text === "more_yes") {
        await setSession(from, "choose_part", session.data);
        await sendPartsMenu(from, { data: { lang } }, session.data.serviceId, session.data.serviceName);
        return;
      }
      if (text === "more_no") {
        if (!session.data.parts || !session.data.parts.length) {
          await sendMessage(from, L.noParts);
          await setSession(from, "choose_part", session.data);
          await sendPartsMenu(from, { data: { lang } }, session.data.serviceId, session.data.serviceName);
          return;
        }
        await setSession(from, "confirm", session.data);
        await sendSummaryConfirm(from, { data: session.data });
        return;
      }
    }

    // ── Step 5: Confirm ────────────────────────────────────────────────────────
    if (session.state === "confirm") {
      if (text === "confirm_no") {
        await clearSession(from);
        await sendMessage(from, L.cancelled);
        return;
      }
      if (text === "confirm_yes") {
        await setSession(from, "location", session.data);
        await sendMessage(from, L.sendLocation);
        return;
      }
    }

    // ── Step 6: Location ──────────────────────────────────────────────────────
    if (session.state === "location") {
      if (msg.type !== "location") { await sendMessage(from, L.locationOnly); return; }

      const { serviceId, serviceName, parts } = session.data;
      if (!serviceId || !parts || !parts.length) {
        await sendMessage(from, L.sessionExp);
        await clearSession(from);
        return;
      }

      const tech = await getAvailableTech(serviceId);
      if (!tech) { await sendMessage(from, L.noTech); await clearSession(from); return; }

      const { text: summaryText, total } = buildSummary(parts, lang);
      const orderId = generateOrderId();

      await db.collection("orders").doc(orderId).set({
        orderId, customer: from, lang,
        serviceId, serviceName,
        parts, total,
        technicianId: tech.id,
        status:       "pending",
        location:     { latitude: msg.location.latitude, longitude: msg.location.longitude },
        createdAt:    admin.firestore.FieldValue.serverTimestamp()
      });

      const techPhone = normalize(tech.phone);
      await sendMessage(techPhone, MSG.ar.techNewOrder(orderId, serviceName, summaryText, total));
      await sendList(techPhone, `طلب جديد — ${orderId}`, MSG.ar.acceptBtn, [{
        title: "الطلب",
        rows: [
          { id: `accept_${orderId}`, title: MSG.ar.acceptRow },
          { id: `reject_${orderId}`, title: MSG.ar.rejectRow }
        ]
      }]);

      await sendMessage(from, L.orderSent(orderId));
      await clearSession(from);
      return;
    }

    await sendMessage(from, L.defaultMsg);
  } catch(err) { console.error("WEBHOOK ERROR:", err); }
});

// ─── Tech Handlers ────────────────────────────────────────────────────────────
async function handleAccept(text, techPhone, tech) {
  const orderId = text.replace("accept_", "");
  const ref     = db.collection("orders").doc(orderId);
  const snap    = await ref.get();
  if (!snap.exists) { await sendMessage(techPhone, MSG.ar.orderNotFound); return; }
  const order = snap.data();
  if (order.status !== "pending") { await sendMessage(techPhone, MSG.ar.alreadyProc); return; }

  await ref.update({ status: "accepted" });
  await db.collection("technicians").doc(order.technicianId).update({ active: false });

  const custPhone = normalize(order.customer);
  const lang      = order.lang || "ar";

  await sendMessage(techPhone, MSG.ar.custPhone(custPhone));
  if (order.location && order.location.latitude) {
    await sendLocation(techPhone, order.location.latitude, order.location.longitude);
  }
  await sendList(techPhone, MSG.ar.doneLabel(orderId), MSG.ar.doneBtn, [{
    title: "الطلب",
    rows:  [{ id: `done_${orderId}`, title: MSG.ar.doneRow }]
  }]);

  await sendMessage(custPhone, MSG[lang].accepted(tech.name, tech.phone));
}

async function handleReject(text, techPhone) {
  const orderId = text.replace("reject_", "");
  const ref     = db.collection("orders").doc(orderId);
  const snap    = await ref.get();
  if (!snap.exists) { await sendMessage(techPhone, MSG.ar.orderNotFound); return; }
  const order = snap.data();
  if (order.status !== "pending") { await sendMessage(techPhone, MSG.ar.alreadyProc); return; }

  await ref.update({ status: "rejected" });
  await sendMessage(techPhone, MSG.ar.techRejected);
  const lang = order.lang || "ar";
  await sendMessage(normalize(order.customer), MSG[lang].rejected(orderId));
}

async function handleDone(text, techPhone, tech) {
  const orderId = text.replace("done_", "");
  const ref     = db.collection("orders").doc(orderId);
  const snap    = await ref.get();
  if (!snap.exists) { await sendMessage(techPhone, MSG.ar.orderNotFound); return; }
  const order = snap.data();
  if (order.status === "done") { await sendMessage(techPhone, MSG.ar.alreadyDone); return; }

  await ref.update({ status: "done", completedAt: admin.firestore.FieldValue.serverTimestamp() });

  const techRef  = db.collection("technicians").doc(order.technicianId);
  const techData = (await techRef.get()).data();
  const fee      = Math.round((order.total || 0) * 0.2 * 100) / 100;
  const newBal   = Math.max(0, ((techData && techData.balance) || 0) - fee);
  await techRef.update({ balance: newBal, active: true });

  const custPhone = normalize(order.customer);
  const lang      = order.lang || "ar";
  const { text: summaryText } = buildSummary(order.parts || [], lang);

  await sendMessage(techPhone, MSG.ar.techDone(orderId, fee, newBal));
  await sendMessage(custPhone, MSG[lang].completed(orderId, summaryText, order.total || 0));
  await sendRatingPrompt(custPhone, orderId, lang);
}

app.listen(process.env.PORT || 3000, () => console.log("Server running"));
