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
const BASE_URL        = process.env.BASE_URL || "https://your-app.railway.app";

const normalize     = (p) => String(p).replace(/\+/g, "");
const MIN_BALANCE   = 2;
const COMMISSION    = 0.10;
const RETRY_MINUTES = 30;

// ─── Customer Languages (AR / EN) ─────────────────────────────────────────────
const CUSTOMER_LANGS = {
  ar: {
    welcome:       "مرحباً! اختر الخدمة المطلوبة 👇",
    servicesBtn:   "الخدمات",
    servicesTitle: "الخدمات المتاحة",
    chooseType:    "اختر نوع الخدمة",
    typesBtn:      "الأنواع",
    chooseParts:   (s) => `اختر القطع لـ "${s}" 🔧`,
    partsBtn:      "القطع",
    partsTitle:    "القطع المتاحة",
    chooseQty:     (n, p) => `كم قطعة من "${n}"؟\n💰 ${p} ريال/قطعة`,
    qtyBtn:        "الكمية",
    qtyTitle:      "اختر الكمية",
    addedPart:     (n, q, t) => `✅ ${n} x${q} = ${t} ريال`,
    addMore:       "هل تريد إضافة قطعة أخرى؟",
    addMoreBtn:    "اختر",
    yesMore:       "➕ إضافة قطعة أخرى",
    noMore:        "✅ انتهيت",
    noParts:       "⚠️ لا توجد قطع. أضفها من لوحة التحكم.",
    summary:       (l, lb, pt, t) => `📋 *ملخص طلبك*\n\n🔧 *القطع:*\n${l}\n\n💼 أجرة: ${lb} ريال\n🔩 قطع: ${pt} ريال\n💰 *الإجمالي: ${t} ريال*`,
    confirmBtn:    "تأكيد",
    confirmRow:    "✅ تأكيد الطلب",
    cancelRow:     "❌ إلغاء",
    cancelled:     "تم الإلغاء. أرسل *مرحبا* للبدء.",
    sendLocation:  "📍 أرسل موقعك لإتمام الطلب.",
    locationOnly:  "يرجى إرسال موقعك عبر واتساب.",
    sessionExp:    "انتهت الجلسة. أرسل *مرحبا*.",
    noTech:        "⚠️ لا يوجد فني متاح. سنبحث 30 دقيقة وسيتم إشعارك.",
    noTechFinal:   (id) => `⚠️ لم نجد فنياً خلال 30 دقيقة.\n🆔 ${id}`,
    noTechOptions: "اختر:",
    waitMore:      "⏳ انتظار أكثر",
    retryNow:      "🔄 طلب جديد",
    orderSent:     (id) => `✅ تم إرسال طلبك!\n🆔 *${id}*\nسيتم إشعارك عند القبول.`,
    activeOrder:   (id, st) => `لديك طلب نشط:\n🆔 ${id}\nالحالة: ${st}`,
    accepted:      (n, p) => `✅ تم قبول طلبك!\n👨‍🔧 ${n}\n📞 ${p}\nفي الطريق!`,
    rejected:      (id) => `❌ رفض الفني. نبحث عن آخر...\n🆔 ${id}`,
    completed:     (id) => `✅ اكتمل طلبك!\n🆔 ${id}\nشكراً! 🙏`,
    invoiceMsg:    (id, url) => `🧾 *فاتورتك:*\n🆔 ${id}\n📄 ${url}`,
    ratePrompt:    "⭐ كيف تقيّم الخدمة؟",
    rateBtn:       "التقييم",
    ratingDone:    (s) => `شكراً! أعطيت ${s} ⭐`,
    defaultMsg:    "أرسل *مرحبا* للبدء."
  },
  en: {
    welcome:       "Welcome! Choose a service 👇",
    servicesBtn:   "Services",
    servicesTitle: "Available Services",
    chooseType:    "Choose service type",
    typesBtn:      "Types",
    chooseParts:   (s) => `Choose parts for "${s}" 🔧`,
    partsBtn:      "Parts",
    partsTitle:    "Available Parts",
    chooseQty:     (n, p) => `How many "${n}"?\n💰 ${p} SAR each`,
    qtyBtn:        "Quantity",
    qtyTitle:      "Choose Quantity",
    addedPart:     (n, q, t) => `✅ ${n} x${q} = ${t} SAR`,
    addMore:       "Add another part?",
    addMoreBtn:    "Choose",
    yesMore:       "➕ Add another part",
    noMore:        "✅ Done",
    noParts:       "⚠️ No parts found. Add from dashboard.",
    summary:       (l, lb, pt, t) => `📋 *Order Summary*\n\n🔧 *Parts:*\n${l}\n\n💼 Labor: ${lb} SAR\n🔩 Parts: ${pt} SAR\n💰 *Total: ${t} SAR*`,
    confirmBtn:    "Confirm",
    confirmRow:    "✅ Confirm Order",
    cancelRow:     "❌ Cancel",
    cancelled:     "Cancelled. Send *mrhba* to start.",
    sendLocation:  "📍 Send your location to complete the order.",
    locationOnly:  "Please send your location via WhatsApp.",
    sessionExp:    "Session expired. Send *mrhba*.",
    noTech:        "⚠️ No technician available. Searching for 30 min.",
    noTechFinal:   (id) => `⚠️ No tech found in 30 min.\n🆔 ${id}`,
    noTechOptions: "Choose:",
    waitMore:      "⏳ Keep waiting",
    retryNow:      "🔄 New request",
    orderSent:     (id) => `✅ Order sent!\n🆔 *${id}*\nYou'll be notified.`,
    activeOrder:   (id, st) => `Active order:\n🆔 ${id}\nStatus: ${st}`,
    accepted:      (n, p) => `✅ Accepted!\n👨‍🔧 ${n}\n📞 ${p}\nOn the way!`,
    rejected:      (id) => `❌ Tech rejected. Searching...\n🆔 ${id}`,
    completed:     (id) => `✅ Done!\n🆔 ${id}\nThank you! 🙏`,
    invoiceMsg:    (id, url) => `🧾 *Invoice:*\n🆔 ${id}\n📄 ${url}`,
    ratePrompt:    "⭐ Rate the service?",
    rateBtn:       "Rate",
    ratingDone:    (s) => `Thanks! You gave ${s} ⭐`,
    defaultMsg:    "Send *mrhba* to start."
  }
};

// ─── Technician Languages (AR / EN / HI / BN) ────────────────────────────────
const TECH_LANGS = {
  ar: {
    chooseLang:    "مرحباً! اختر لغتك 👇",
    langBtn:       "اللغة",
    langTitle:     "اختر لغتك",
    newOrder:      (id, svc, type, parts, labor, total) =>
      `🔔 *طلب جديد!*\n🆔 ${id}\n🔧 ${svc} - ${type}\n\n*القطع:*\n${parts}\n\n💼 أجرة: ${labor} ريال\n💰 *الإجمالي: ${total} ريال*`,
    acceptBtn:     "اختر",
    acceptRow:     "✅ قبول",
    rejectRow:     "❌ رفض",
    customerPhone: (p) => `📞 هاتف العميل: ${p}`,
    doneBtn:       "إنهاء",
    doneRow:       "✅ إنهاء الطلب",
    doneLabel:     (id) => `${id} - اضغط عند الإنهاء`,
    techDone:      (id, c, b) => `✅ ${id} مكتمل.\n💸 عمولة: ${c} ريال\n💰 رصيدك: ${b} ريال`,
    lowBalance:    (b, m) => `⚠️ *رصيد منخفض!*\nرصيدك: ${b} ريال\nالحد الأدنى: *${m} ريال*\nيرجى الشحن.\n📞 تواصل مع الإدارة.`,
    techRejected:  "تم رفض الطلب.",
    orderNotFound: "الطلب غير موجود.",
    alreadyProc:   "تمت معالجة الطلب مسبقاً.",
    alreadyDone:   "الطلب مكتمل مسبقاً.",
    info:          (n, p, r, b, a) => `👤 ${n}\n📞 ${p}\n⭐ ${r || "لا يوجد"}\n💰 ${b} ريال\n🟢 ${a ? "متاح" : "مشغول"}`
  },
  en: {
    chooseLang:    "Hello! Choose your language 👇",
    langBtn:       "Language",
    langTitle:     "Choose Language",
    newOrder:      (id, svc, type, parts, labor, total) =>
      `🔔 *New Order!*\n🆔 ${id}\n🔧 ${svc} - ${type}\n\n*Parts:*\n${parts}\n\n💼 Labor: ${labor} SAR\n💰 *Total: ${total} SAR*`,
    acceptBtn:     "Choose",
    acceptRow:     "✅ Accept",
    rejectRow:     "❌ Reject",
    customerPhone: (p) => `📞 Customer: ${p}`,
    doneBtn:       "Finish",
    doneRow:       "✅ Mark Done",
    doneLabel:     (id) => `${id} - Mark when done`,
    techDone:      (id, c, b) => `✅ ${id} done.\n💸 Commission: ${c} SAR\n💰 Balance: ${b} SAR`,
    lowBalance:    (b, m) => `⚠️ *Low Balance!*\nBalance: ${b} SAR\nMinimum: *${m} SAR*\nPlease recharge.\n📞 Contact admin.`,
    techRejected:  "Order rejected.",
    orderNotFound: "Order not found.",
    alreadyProc:   "Order already processed.",
    alreadyDone:   "Order already completed.",
    info:          (n, p, r, b, a) => `👤 ${n}\n📞 ${p}\n⭐ ${r || "N/A"}\n💰 ${b} SAR\n🟢 ${a ? "Available" : "Busy"}`
  },
  hi: {
    chooseLang:    "नमस्ते! अपनी भाषा चुनें 👇",
    langBtn:       "भाषा",
    langTitle:     "भाषा चुनें",
    newOrder:      (id, svc, type, parts, labor, total) =>
      `🔔 *नया ऑर्डर!*\n🆔 ${id}\n🔧 ${svc} - ${type}\n\n*पार्ट्स:*\n${parts}\n\n💼 मजदूरी: ${labor} SAR\n💰 *कुल: ${total} SAR*`,
    acceptBtn:     "चुनें",
    acceptRow:     "✅ स्वीकार करें",
    rejectRow:     "❌ अस्वीकार",
    customerPhone: (p) => `📞 ग्राहक: ${p}`,
    doneBtn:       "समाप्त",
    doneRow:       "✅ काम पूरा",
    doneLabel:     (id) => `${id} - पूरा होने पर दबाएं`,
    techDone:      (id, c, b) => `✅ ${id} पूरा हुआ।\n💸 कमीशन: ${c} SAR\n💰 बैलेंस: ${b} SAR`,
    lowBalance:    (b, m) => `⚠️ *कम बैलेंस!*\nबैलेंस: ${b} SAR\nन्यूनतम: *${m} SAR*\nरिचार्ज करें।\n📞 एडमिन से संपर्क करें।`,
    techRejected:  "ऑर्डर अस्वीकार।",
    orderNotFound: "ऑर्डर नहीं मिला।",
    alreadyProc:   "ऑर्डर पहले ही प्रोसेस हो गया।",
    alreadyDone:   "ऑर्डर पहले ही पूरा हो गया।",
    info:          (n, p, r, b, a) => `👤 ${n}\n📞 ${p}\n⭐ ${r || "N/A"}\n💰 ${b} SAR\n🟢 ${a ? "उपलब्ध" : "व्यस्त"}`
  },
  bn: {
    chooseLang:    "হ্যালো! আপনার ভাষা বেছে নিন 👇",
    langBtn:       "ভাষা",
    langTitle:     "ভাষা বেছে নিন",
    newOrder:      (id, svc, type, parts, labor, total) =>
      `🔔 *নতুন অর্ডার!*\n🆔 ${id}\n🔧 ${svc} - ${type}\n\n*পার্টস:*\n${parts}\n\n💼 শ্রম: ${labor} SAR\n💰 *মোট: ${total} SAR*`,
    acceptBtn:     "বেছে নিন",
    acceptRow:     "✅ গ্রহণ করুন",
    rejectRow:     "❌ প্রত্যাখ্যান",
    customerPhone: (p) => `📞 গ্রাহক: ${p}`,
    doneBtn:       "শেষ করুন",
    doneRow:       "✅ কাজ সম্পন্ন",
    doneLabel:     (id) => `${id} - শেষ হলে চাপুন`,
    techDone:      (id, c, b) => `✅ ${id} সম্পন্ন।\n💸 কমিশন: ${c} SAR\n💰 ব্যালেন্স: ${b} SAR`,
    lowBalance:    (b, m) => `⚠️ *কম ব্যালেন্স!*\nব্যালেন্স: ${b} SAR\nন্যূনতম: *${m} SAR*\nরিচার্জ করুন।\n📞 অ্যাডমিন যোগাযোগ করুন।`,
    techRejected:  "অর্ডার প্রত্যাখ্যাত।",
    orderNotFound: "অর্ডার পাওয়া যায়নি।",
    alreadyProc:   "অর্ডার ইতিমধ্যে প্রক্রিয়া করা হয়েছে।",
    alreadyDone:   "অর্ডার ইতিমধ্যে সম্পন্ন।",
    info:          (n, p, r, b, a) => `👤 ${n}\n📞 ${p}\n⭐ ${r || "N/A"}\n💰 ${b} SAR\n🟢 ${a ? "উপলব্ধ" : "ব্যস্ত"}`
  }
};

// ─── Lang Selector Rows ───────────────────────────────────────────────────────
const LANG_ROWS = [
  { id: "techlang_ar", title: "🇸🇦 العربية" },
  { id: "techlang_en", title: "🇬🇧 English"  },
  { id: "techlang_hi", title: "🇮🇳 हिन्दी"   },
  { id: "techlang_bn", title: "🇧🇩 বাংলা"    }
];

// ─── Session Helpers ──────────────────────────────────────────────────────────
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
function getCLang(session) {
  return (session && session.data && session.data.lang) || "ar";
}
function getTLang(tech) {
  return tech.lang || "ar";
}
function CL(session) { return CUSTOMER_LANGS[getCLang(session)]; }
function TL(tech)    { return TECH_LANGS[getTLang(tech)]; }

// ─── WhatsApp Senders ─────────────────────────────────────────────────────────
async function sendMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, text: { body: text } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch(e) { console.error("sendMessage:", e.message); }
}

async function sendList(to, body, button, sections) {
  try {
    const safeBody    = String(body   || "").substring(0, 1024);
    const safeButton  = String(button || "اختر").substring(0, 20);
    const safeSections = sections.map(sec => ({
      title: String(sec.title || "").substring(0, 24),
      rows: (sec.rows || []).slice(0, 10).map(r => ({
        id:          String(r.id    || "").substring(0, 200),
        title:       String(r.title || "").substring(0, 24),
        description: r.description ? String(r.description).substring(0, 72) : undefined
      }))
    }));
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, type: "interactive",
        interactive: { type: "list", body: { text: safeBody }, action: { button: safeButton, sections: safeSections } } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch(e) {
    console.error("sendList ERROR:", e.message);
    if (e.response) console.error("sendList DETAILS:", JSON.stringify(e.response.data));
  }
}

async function sendLocation(to, lat, lng) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, type: "location", location: { latitude: lat, longitude: lng } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch(e) { console.error("sendLocation:", e.message); }
}

// ─── Firestore Queries ────────────────────────────────────────────────────────
async function getServices() {
  const snap = await db.collection("services").get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ─── اسم الخدمة حسب اللغة ────────────────────────────────────────────────────
function getServiceName(service, lang) {
  if (lang === "ar") return service.nameAr || service.name || service.id;
  if (lang === "en") return service.nameEn || service.nameAr || service.name || service.id;
  if (lang === "hi") return service.nameHi || service.nameEn || service.nameAr || service.name || service.id;
  if (lang === "bn") return service.nameBn || service.nameEn || service.nameAr || service.name || service.id;
  return service.nameAr || service.name || service.id;
}

function getTypeNameL(type, lang) {
  if (!type) return "";
  if (typeof type === "string") return type;
  if (lang === "ar") return type.nameAr || type.name || "";
  if (lang === "en") return type.nameEn || type.nameAr || type.name || "";
  if (lang === "hi") return type.nameHi || type.nameEn || type.nameAr || type.name || "";
  if (lang === "bn") return type.nameBn || type.nameEn || type.nameAr || type.name || "";
  return type.nameAr || type.name || "";
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
async function getAvailableTech(serviceId, excludeIds = []) {
  const snap = await db.collection("technicians")
    .where("active", "==", true)
    .where("services", "array-contains", serviceId).get();
  const techs = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(t => !excludeIds.includes(t.id) && (t.balance || 0) >= MIN_BALANCE);
  return techs.length > 0 ? techs[0] : null;
}
async function getActiveOrder(phone) {
  const snap = await db.collection("orders")
    .where("customer", "==", phone)
    .where("status", "in", ["pending","accepted","searching"])
    .limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ─── Invoice Page ─────────────────────────────────────────────────────────────
app.get("/invoice/:orderId", async (req, res) => {
  try {
    const snap = await db.collection("orders").doc(req.params.orderId).get();
    if (!snap.exists) return res.status(404).send("Not found");
    const o = snap.data();
    const rows = (o.parts || []).map(p =>
      `<tr><td>${p.name}</td><td>${p.qty}</td><td>${p.unitPrice}</td><td>${p.total}</td></tr>`
    ).join("");
    res.send(`<!DOCTYPE html><html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><title>فاتورة ${o.orderId}</title>
<style>body{font-family:Arial;padding:32px;max-width:680px;margin:auto}
h1{color:#f59e0b}table{width:100%;border-collapse:collapse;margin:18px 0}
th{background:#f59e0b;padding:10px;text-align:right}td{padding:10px;border-bottom:1px solid #eee;text-align:right}
.box{background:#f9f9f9;padding:14px;border-radius:8px;margin-bottom:20px}
.total{font-size:1.3rem;font-weight:bold;color:#f59e0b;margin-top:14px}
.footer{color:#888;font-size:.82rem;text-align:center;margin-top:32px}</style></head>
<body>
<h1>TAQA 🔧</h1>
<div class="box">
  <p><strong>رقم الطلب:</strong> ${o.orderId}</p>
  <p><strong>الخدمة:</strong> ${o.serviceName} — ${o.type||""}</p>
  <p><strong>العميل:</strong> ${o.customer}</p>
  <p><strong>التاريخ:</strong> ${o.createdAt?new Date(o.createdAt.seconds*1000).toLocaleDateString("ar-SA"):"-"}</p>
</div>
<table><thead><tr><th>القطعة</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
<tbody>${rows}</tbody></table>
<p>💼 أجرة العمل: <strong>${o.laborPrice||0} ريال</strong></p>
<p>🔩 إجمالي القطع: <strong>${o.partsTotal||0} ريال</strong></p>
<div class="total">💰 الإجمالي الكلي: ${o.totalPrice||0} ريال</div>
<br><button onclick="window.print()" style="padding:10px 22px;background:#f59e0b;border:none;border-radius:8px;font-size:1rem;cursor:pointer">🖨️ طباعة / PDF</button>
<div class="footer">TAQA © ${new Date().getFullYear()}</div>
</body></html>`);
  } catch(e) { res.status(500).send("Error"); }
});

// ─── Rating ───────────────────────────────────────────────────────────────────
async function updateTechRating(techId, stars) {
  const ref = db.collection("technicians").doc(techId);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const d = snap.data();
    const count  = (d.ratingCount || 0) + 1;
    const newAvg = (((d.rating || 0) * (count - 1)) + stars) / count;
    tx.update(ref, { rating: Math.round(newAvg * 10) / 10, ratingCount: count });
  });
}

async function sendRatingPrompt(to, orderId, lang) {
  const L2   = CUSTOMER_LANGS[lang] || CUSTOMER_LANGS.ar;
  const rows = [1,2,3,4,5].map(s => ({
    id: `rate_${orderId}_${s}`,
    title: "⭐".repeat(s),
    description: ["ضعيف","مقبول","جيد","جيد جداً","ممتاز"][s-1]
  }));
  await sendList(to, L2.ratePrompt, L2.rateBtn, [{ title: "التقييم", rows }]);
}

// ─── Dispatch Tech ────────────────────────────────────────────────────────────
async function dispatchToTech(orderId, order) {
  const lang   = order.lang || "ar";
  const CL2    = CUSTOMER_LANGS[lang] || CUSTOMER_LANGS.ar;
  const tech   = await getAvailableTech(order.serviceId, order.rejectedTechs || []);

  if (!tech) {
    const ref          = db.collection("orders").doc(orderId);
    const searchStart  = order.searchStartedAt;
    if (!searchStart) {
      await ref.update({ status: "searching", searchStartedAt: admin.firestore.FieldValue.serverTimestamp() });
      await sendMessage(normalize(order.customer), CL2.noTech);
      return;
    }
    const elapsed = (Date.now() - searchStart.toDate().getTime()) / 60000;
    if (elapsed >= RETRY_MINUTES) {
      await ref.update({ status: "no_tech" });
      await sendMessage(normalize(order.customer), CL2.noTechFinal(order.orderId));
      await sendList(normalize(order.customer), CL2.noTechOptions, CL2.addMoreBtn, [{
        title: lang === "ar" ? "خيارات" : "Options",
        rows: [
          { id: `wait_${orderId}`, title: CL2.waitMore },
          { id: "mrhba",           title: CL2.retryNow }
        ]
      }]);
    }
    return;
  }

  // وُجد فني
  const TL2       = TECH_LANGS[getTLang(tech)] || TECH_LANGS.ar;
  const partsText = (order.parts || []).map(p => `• ${p.name} x${p.qty} = ${p.total} SAR`).join("\n");
  const techPhone = normalize(tech.phone);

  await sendMessage(techPhone,
    TL2.newOrder(order.orderId, order.serviceName, order.type || "", partsText, order.laborPrice || 0, order.totalPrice || 0)
  );
  await sendList(techPhone,
    getTLang(tech) === "ar" ? "هل تقبل هذا الطلب؟" : "Accept this order?",
    TL2.acceptBtn,
    [{ title: "Order", rows: [
      { id: `accept_${orderId}`, title: TL2.acceptRow },
      { id: `reject_${orderId}`, title: TL2.rejectRow }
    ]}]
  );
  await db.collection("orders").doc(orderId).update({
    technicianId: tech.id, techPhone, status: "pending"
  });
}

// ─── Parts Menu ───────────────────────────────────────────────────────────────
async function sendPartsMenu(phone, service, selectedParts, lang) {
  const L2    = CUSTOMER_LANGS[lang] || CUSTOMER_LANGS.ar;
  const parts = await getPartsByService(service.id);
  if (!parts.length) { await sendMessage(phone, L2.noParts); return; }
  const selIds = (selectedParts || []).map(p => p.id);
  const rows   = parts.map(p => ({
    id: "part_" + p.id,
    title: String(p.name || "قطعة").substring(0, 24),
    description: `${p.price} ريال` + (selIds.includes(p.id) ? " ✅" : "")
  }));
  if (selectedParts && selectedParts.length > 0) rows.push({ id: "nomore", title: L2.noMore });
  await sendList(phone, L2.chooseParts(getServiceName(service, lang)), L2.partsBtn,
    [{ title: L2.partsTitle, rows: rows.slice(0, 10) }]
  );
}

// ─── Summary ──────────────────────────────────────────────────────────────────
async function showSummary(phone, session, lang) {
  const L2         = CUSTOMER_LANGS[lang] || CUSTOMER_LANGS.ar;
  const { service, selectedType, parts } = session.data;
  const partsTotal = (parts || []).reduce((s, p) => s + p.total, 0);
  const laborPrice = selectedType ? selectedType.price : 0;
  const totalPrice = Math.round((partsTotal + laborPrice) * 100) / 100;
  const lines      = (parts || []).map(p => `• ${p.name} x${p.qty} = ${p.total} ريال`).join("\n");
  await sendMessage(phone, L2.summary(lines, laborPrice, Math.round(partsTotal*100)/100, totalPrice));
  await setSession(phone, "confirm", session.data);
  await sendList(phone, lang === "ar" ? "هل تؤكد الطلب؟" : "Confirm order?", L2.confirmBtn, [{
    title: lang === "ar" ? "تأكيد" : "Confirm",
    rows: [{ id: "confirm", title: L2.confirmRow }, { id: "cancel", title: L2.cancelRow }]
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
    const val = entry[0].changes?.[0]?.value;
    if (!val || !val.messages?.[0]) return;

    const msg  = val.messages[0];
    const from = normalize(msg.from);
    let text = "";
    if (msg.type === "text") text = msg.text.body.trim();
    else if (msg.type === "interactive") {
      text = msg.interactive.list_reply?.id || msg.interactive.button_reply?.id || "";
    }
    console.log("FROM:", from, "TEXT:", text);

    // ── فني ───────────────────────────────────────────────────────────────────
    const tech = await getTechByPhone(from);
    if (tech) {
      // أوامر الطلبات — تعمل دائماً
      if (text.startsWith("accept_")) { await handleAccept(text, from, tech); return; }
      if (text.startsWith("reject_")) { await handleReject(text, from, tech); return; }
      if (text.startsWith("done_"))   { await handleDone(text, from, tech);   return; }

      // اختيار اللغة من القائمة
      if (text.startsWith("techlang_")) {
        const chosenLang = text.replace("techlang_", "");
        if (TECH_LANGS[chosenLang]) {
          await db.collection("technicians").doc(tech.id).update({ lang: chosenLang });
          const TL2 = TECH_LANGS[chosenLang];
          await sendMessage(from, TL2.info(tech.name, tech.phone, tech.rating, tech.balance||0, tech.active));
        }
        return;
      }

      // info بأي لغة
      if (["info","معلومات","जानकारी","তথ্য"].includes(text)) {
        const TL2 = TECH_LANGS[getTLang(tech)] || TECH_LANGS.ar;
        await sendMessage(from, TL2.info(tech.name, tech.phone, tech.rating, tech.balance||0, tech.active));
        return;
      }

      // أي رسالة أخرى من الفني → دائماً يعرض قائمة اللغات الأربع
      await sendList(from,
        "مرحباً! / Hello! / नमस्ते! / হ্যালো!\n\nاختر لغتك / Choose your language",
        "Language",
        [{ title: "Choose / اختر", rows: LANG_ROWS }]
      );
      return;
    }

    // ── تقييم ─────────────────────────────────────────────────────────────────
    if (text.startsWith("rate_")) {
      const parts   = text.split("_");
      const stars   = parseInt(parts[parts.length - 1]);
      const orderId = parts.slice(1, -1).join("_");
      if (!isNaN(stars) && stars >= 1 && stars <= 5) {
        const oSnap = await db.collection("orders").doc(orderId).get();
        if (oSnap.exists) {
          await updateTechRating(oSnap.data().technicianId, stars);
          await db.collection("orders").doc(orderId).update({ rating: stars });
          const session = await getSession(from);
          const L2 = CUSTOMER_LANGS[getCLang(session)] || CUSTOMER_LANGS.ar;
          await sendMessage(from, L2.ratingDone(stars));
        }
      }
      return;
    }

    // ── انتظار أكثر ───────────────────────────────────────────────────────────
    if (text.startsWith("wait_")) {
      const orderId = text.replace("wait_", "");
      await db.collection("orders").doc(orderId).update({
        status: "searching",
        searchStartedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      const session = await getSession(from);
      const L2 = CUSTOMER_LANGS[getCLang(session)] || CUSTOMER_LANGS.ar;
      await sendMessage(from, L2.noTech);
      return;
    }

    // ── اختيار لغة العميل من القائمة ─────────────────────────────────────────
    if (text === "custlang_ar" || text === "custlang_en") {
      const lang = text.replace("custlang_", "");
      await clearSession(from);
      const L2     = CUSTOMER_LANGS[lang];
      const active = await getActiveOrder(from);
      if (active) { await sendMessage(from, L2.activeOrder(active.orderId, active.status)); return; }
      const services = await getServices();
      await sendList(from, L2.welcome, L2.servicesBtn, [{
        title: L2.servicesTitle,
        rows: services.map(s => ({ id: "service_" + s.id, title: String(getServiceName(s, lang)).substring(0, 24) }))
      }]);
      await setSession(from, "main", { lang });
      return;
    }

    // ── جلسة العميل ──────────────────────────────────────────────────────────
    let session = await getSession(from);

    // أي رسالة بدون جلسة → ترحيب + اختيار اللغة (عربي / إنجليزي)
    if (!session.state) {
      await sendList(from,
        "مرحباً بك! 👋\nWelcome!\n\nاختر لغتك\nChoose your language",
        "Language / اللغة",
        [{ title: "اختر / Choose", rows: [
          { id: "custlang_ar", title: "🇸🇦 العربية"  },
          { id: "custlang_en", title: "🇬🇧 English"   }
        ]}]
      );
      return;
    }


    const lang = getCLang(session);
    const L2   = CUSTOMER_LANGS[lang] || CUSTOMER_LANGS.ar;

    // ── main: اختيار الخدمة ───────────────────────────────────────────────────
    if (session.state === "main" && text.startsWith("service_")) {
      const services  = await getServices();
      const serviceId = text.replace("service_", "");
      const service   = services.find(s => s.id === serviceId);
      if (!service) { await sendMessage(from, L2.defaultMsg); return; }
      if (service.types && service.types.length > 0) {
        await setSession(from, "type", { ...session.data, service });
        await sendList(from, getServiceName(service, lang), L2.typesBtn, [{
          title: L2.chooseType,
          rows: service.types.map((t, i) => ({ id: "type_" + i, title: String(getTypeNameL(t, lang) || "نوع").substring(0, 24), description: t.price + " ريال" }))
        }]);
      } else {
        await setSession(from, "parts", { ...session.data, service, selectedType: { name: getServiceName(service, lang), price: 0 }, parts: [] });
        await sendPartsMenu(from, service, [], lang);
      }
      return;
    }

    // ── type: اختيار النوع ────────────────────────────────────────────────────
    if (session.state === "type" && text.startsWith("type_")) {
      const index   = parseInt(text.replace("type_", ""));
      const service = session.data.service;
      if (!service || isNaN(index) || !service.types[index]) { await sendMessage(from, L2.defaultMsg); return; }
      const selectedType = service.types[index];
      await setSession(from, "parts", { ...session.data, selectedType, parts: [] });
      await sendPartsMenu(from, service, [], lang);
      return;
    }

    // ── parts: اختيار القطع ───────────────────────────────────────────────────
    if (session.state === "parts") {
      if (text === "nomore") { await showSummary(from, session, lang); return; }
      if (text.startsWith("part_")) {
        const partId   = text.replace("part_", "");
        const allParts = await getPartsByService(session.data.service.id);
        const part     = allParts.find(p => p.id === partId);
        if (!part) { await sendMessage(from, L2.defaultMsg); return; }
        await setSession(from, "qty", { ...session.data, pendingPart: part });
        await sendList(from, L2.chooseQty(part.name, part.price), L2.qtyBtn, [{
          title: L2.qtyTitle,
          rows: [1,2,3,4,5].map(n => ({ id: "qty_" + n, title: n + (lang==="ar"?" قطع":" pcs") }))
        }]);
        return;
      }
      if (text === "addmore") { await sendPartsMenu(from, session.data.service, session.data.parts||[], lang); return; }
    }

    // ── qty: اختيار الكمية ────────────────────────────────────────────────────
    if (session.state === "qty" && text.startsWith("qty_")) {
      const qty      = parseInt(text.replace("qty_", ""));
      const part     = session.data.pendingPart;
      const parts    = session.data.parts || [];
      const total    = Math.round(part.price * qty * 100) / 100;
      const idx      = parts.findIndex(p => p.id === part.id);
      if (idx >= 0) { parts[idx].qty += qty; parts[idx].total += total; }
      else parts.push({ id: part.id, name: part.name, qty, unitPrice: part.price, total });
      await sendMessage(from, L2.addedPart(part.name, qty, total));
      await setSession(from, "parts", { ...session.data, parts, pendingPart: null });
      await sendList(from, L2.addMore, L2.addMoreBtn, [{
        title: lang === "ar" ? "الخيارات" : "Options",
        rows: [{ id: "addmore", title: L2.yesMore }, { id: "nomore", title: L2.noMore }]
      }]);
      return;
    }

    // ── confirm ───────────────────────────────────────────────────────────────
    if (session.state === "confirm") {
      if (text === "cancel")  { await clearSession(from); await sendMessage(from, L2.cancelled); return; }
      if (text === "confirm") { await setSession(from, "location", session.data); await sendMessage(from, L2.sendLocation); return; }
    }

    // ── location ──────────────────────────────────────────────────────────────
    if (session.state === "location") {
      if (msg.type !== "location") { await sendMessage(from, L2.locationOnly); return; }
      const { service, selectedType, parts } = session.data;
      if (!service) { await sendMessage(from, L2.sessionExp); await clearSession(from); return; }
      const partsTotal = (parts||[]).reduce((s,p) => s+p.total, 0);
      const laborPrice = selectedType ? selectedType.price : 0;
      const totalPrice = Math.round((partsTotal + laborPrice)*100)/100;
      const orderId    = generateOrderId();
      const orderData  = {
        orderId, customer: from,
        serviceName: getServiceName(service, lang), serviceId: service.id,
        type: selectedType ? (getTypeNameL(selectedType, lang) || selectedType.name || "") : "",
        laborPrice, partsTotal: Math.round(partsTotal*100)/100, totalPrice,
        parts: parts || [], status: "searching", lang,
        rejectedTechs: [],
        location: { latitude: msg.location.latitude, longitude: msg.location.longitude },
        createdAt:        admin.firestore.FieldValue.serverTimestamp(),
        searchStartedAt:  admin.firestore.FieldValue.serverTimestamp()
      };
      await db.collection("orders").doc(orderId).set(orderData);
      await sendMessage(from, L2.orderSent(orderId));
      await clearSession(from);
      await dispatchToTech(orderId, orderData);
      return;
    }

    await sendMessage(from, L2.defaultMsg);
  } catch(err) { console.error("WEBHOOK ERROR:", err); }
});

// ─── Tech Handlers ────────────────────────────────────────────────────────────
async function handleAccept(text, techPhone, tech) {
  const orderId = text.replace("accept_", "");
  const ref     = db.collection("orders").doc(orderId);
  const snap    = await ref.get();
  const TL2     = TECH_LANGS[getTLang(tech)] || TECH_LANGS.ar;
  if (!snap.exists) { await sendMessage(techPhone, TL2.orderNotFound); return; }
  const order = snap.data();
  if (!["pending","searching"].includes(order.status)) { await sendMessage(techPhone, TL2.alreadyProc); return; }
  if ((tech.balance||0) < MIN_BALANCE) { await sendMessage(techPhone, TL2.lowBalance(tech.balance||0, MIN_BALANCE)); return; }

  await ref.update({ status: "accepted", technicianId: tech.id, techPhone: normalize(tech.phone) });
  await db.collection("technicians").doc(tech.id).update({ active: false });

  const customerPhone = normalize(order.customer);
  const CL2 = CUSTOMER_LANGS[order.lang||"ar"] || CUSTOMER_LANGS.ar;

  await sendMessage(techPhone, TL2.customerPhone(customerPhone));
  if (order.location) await sendLocation(techPhone, order.location.latitude, order.location.longitude);
  await sendList(techPhone, TL2.doneLabel(orderId), TL2.doneBtn, [{
    title: "Order", rows: [{ id: "done_" + orderId, title: TL2.doneRow }]
  }]);
  await sendMessage(customerPhone, CL2.accepted(tech.name, tech.phone));
}

async function handleReject(text, techPhone, tech) {
  const orderId = text.replace("reject_", "");
  const ref     = db.collection("orders").doc(orderId);
  const snap    = await ref.get();
  const TL2     = TECH_LANGS[getTLang(tech)] || TECH_LANGS.ar;
  if (!snap.exists) { await sendMessage(techPhone, TL2.orderNotFound); return; }
  const order = snap.data();
  if (!["pending","searching"].includes(order.status)) { await sendMessage(techPhone, TL2.alreadyProc); return; }

  const rejectedTechs = [...(order.rejectedTechs||[]), tech.id];
  await ref.update({ status: "searching", rejectedTechs, technicianId: null });
  await sendMessage(techPhone, TL2.techRejected);

  const CL2 = CUSTOMER_LANGS[order.lang||"ar"] || CUSTOMER_LANGS.ar;
  await sendMessage(normalize(order.customer), CL2.rejected(order.orderId));
  await dispatchToTech(orderId, { ...order, rejectedTechs, status: "searching" });
}

async function handleDone(text, techPhone, tech) {
  const orderId = text.replace("done_", "");
  const ref     = db.collection("orders").doc(orderId);
  const snap    = await ref.get();
  const TL2     = TECH_LANGS[getTLang(tech)] || TECH_LANGS.ar;
  if (!snap.exists) { await sendMessage(techPhone, TL2.orderNotFound); return; }
  const order = snap.data();
  if (order.status === "done") { await sendMessage(techPhone, TL2.alreadyDone); return; }

  await ref.update({ status: "done", completedAt: admin.firestore.FieldValue.serverTimestamp() });
  const techRef    = db.collection("technicians").doc(order.technicianId || tech.id);
  const techData   = (await techRef.get()).data();
  const commission = Math.round(order.totalPrice * COMMISSION * 100) / 100;
  const newBalance = Math.max(0, Math.round(((techData.balance||0) - commission)*100)/100);
  await techRef.update({ balance: newBalance, active: true });

  const CL2           = CUSTOMER_LANGS[order.lang||"ar"] || CUSTOMER_LANGS.ar;
  const customerPhone = normalize(order.customer);
  const invoiceUrl    = `${BASE_URL}/invoice/${orderId}`;

  await sendMessage(customerPhone, CL2.completed(order.orderId));
  await sendMessage(customerPhone, CL2.invoiceMsg(order.orderId, invoiceUrl));
  await sendMessage(techPhone, TL2.techDone(order.orderId, commission, newBalance));

  if (newBalance < MIN_BALANCE) await sendMessage(techPhone, TL2.lowBalance(newBalance, MIN_BALANCE));
  await sendRatingPrompt(customerPhone, orderId, order.lang || "ar");
}

// ─── Background: إعادة البحث عن فني كل 5 دقائق ───────────────────────────────
setInterval(async () => {
  try {
    const snap = await db.collection("orders").where("status","==","searching").get();
    for (const doc of snap.docs) {
      const order = { id: doc.id, ...doc.data() };
      if (!order.searchStartedAt) continue;
      const elapsed = (Date.now() - order.searchStartedAt.toDate().getTime()) / 60000;
      if (elapsed < RETRY_MINUTES) await dispatchToTech(order.id, order);
    }
  } catch(e) { console.error("Background:", e.message); }
}, 5 * 60 * 1000);

app.listen(process.env.PORT || 3000, () => console.log("✅ TAQA Server running"));
