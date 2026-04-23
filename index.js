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
const ADMIN_KEY       = process.env.ADMIN_KEY || "admin-secret-key";

const normalize     = (p) => String(p).replace(/\+/g, "");
const MIN_BALANCE   = 2;
const COMMISSION    = 0.10;
const RETRY_MINUTES = 30;
const SESSION_TIMEOUT_MINUTES = 60;
const MAX_PARTS_PER_ORDER     = 5;
const LATE_TECH_MINUTES       = 30; // إشعار العميل إذا تأخر الفني

// ─── حماية من الطلبات المكررة ─────────────────────────────────────────────────
const processingOrders = new Set();
function lockOrder(id)   { processingOrders.add(id); }
function unlockOrder(id) { processingOrders.delete(id); }
function isLocked(id)    { return processingOrders.has(id); }

// ─── Rate Limiting — منع الإرسال المتكرر ─────────────────────────────────────
const rateLimitMap = new Map(); // phone → { count, resetAt }
const RATE_LIMIT_MAX      = 15; // رسائل
const RATE_LIMIT_WINDOW   = 60 * 1000; // في دقيقة واحدة

function checkRateLimit(phone) {
  const now  = Date.now();
  const entry = rateLimitMap.get(phone);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(phone, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return false; // لم يتجاوز الحد
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return true; // تجاوز الحد
  return false;
}

// ─── تنظيف rateLimitMap كل دقيقة ─────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitMap.entries()) {
    if (now > v.resetAt) rateLimitMap.delete(k);
  }
}, 60 * 1000);

// ─── تسجيل الأخطاء في Firestore ──────────────────────────────────────────────
async function logError(context, error, extra = {}) {
  try {
    await db.collection("logs").add({
      level:   "error",
      context,
      message: error?.message || String(error),
      stack:   error?.stack   || "",
      extra,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch(e) { /* لا نوقف التطبيق بسبب خطأ في اللوج */ }
  console.error(`[${context}]`, error?.message || error);
}

async function logInfo(context, message, extra = {}) {
  try {
    await db.collection("logs").add({
      level: "info", context, message, extra,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch(e) {}
}

// ─── تاريخ تغييرات حالة الطلب ────────────────────────────────────────────────
async function addOrderHistory(orderId, status, actor = "system", note = "") {
  try {
    await db.collection("orders").doc(orderId)
      .collection("history").add({
        status, actor, note,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
  } catch(e) {}
}

// ─── إعادة المحاولة عند فشل WhatsApp API ─────────────────────────────────────
async function axiosWithRetry(config, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try { return await axios(config); }
    catch(e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

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
    chooseQty:     (n, p) => `كم قطعة من "${n}"؟\n💰 ${p} ر.ع/قطعة`,
    qtyBtn:        "الكمية",
    qtyTitle:      "اختر الكمية",
    addedPart:     (n, q, t) => `✅ ${n} x${q} = ${t} ر.ع`,
    addMore:       "هل تريد إضافة قطعة أخرى؟",
    addMoreBtn:    "اختر",
    yesMore:       "➕ إضافة قطعة أخرى",
    noMore:        "✅ انتهيت",
    backToServices:"🔙 الرجوع للخدمات",
    backToTypes:   "🔙 الرجوع للأنواع",
    backToParts:   "🔙 الرجوع للقطع",
    backToSummary: "🔙 الرجوع للملخص",
    noParts:       "⚠️ لا توجد قطع. أضفها من لوحة التحكم.",
    noPartsNeeded: "🔧 بدون قطع",
    summary:       (l, lb, pt, t) => `📋 *ملخص طلبك*\n\n🔧 *القطع:*\n${l}\n\n💼 أجرة: ${lb} ر.ع\n🔩 قطع: ${pt} ر.ع\n💰 *الإجمالي: ${t} ر.ع*`,
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
    activeSearching: (id) => `🔍 طلبك قيد البحث عن فني:\n🆔 *${id}*\nماذا تريد؟`,
    cancelOrder:   "❌ إلغاء الطلب",
    keepWaiting:   "⏳ انتظار",
    orderCancelled:(id) => `تم إلغاء طلبك 🆔 ${id}`,
    needRating:    "⭐ يرجى تقييم طلبك السابق أولاً قبل طلب خدمة جديدة.",
    privacyNote:   "🔒 نستخدم بياناتك فقط لتنفيذ الطلب وتحسين الخدمة.",
    accepted:      (n, p) => `✅ تم قبول طلبك!\n👨‍🔧 ${n}\n📞 ${p}\nفي الطريق!`,
    rejected:      (id) => `❌ رفض الفني. نبحث عن آخر...\n🆔 ${id}`,
    completed:     (id) => `✅ اكتمل طلبك!\n🆔 ${id}\nشكراً! 🙏`,
    ratePrompt:    "⭐ كيف تقيّم الخدمة؟",
    rateBtn:       "التقييم",
    ratingDone:    (s) => `شكراً! أعطيت ${s} ⭐`,
    outOfZone:     "⚠️ عذراً، موقعك خارج نطاق الخدمة حالياً.\nسنعمل على توسيع خدمتنا قريباً! 🙏",
    rateLimited:   "⚠️ أنت ترسل رسائل كثيرة. انتظر دقيقة ثم حاول.",
    techLate:      (n) => `⏰ مضى ${n} دقيقة منذ قبول الفني طلبك. هل تريد إلغاء الطلب؟`,
    cancelAfterAccept: "❌ إلغاء الطلب",
    keepOrder:     "✅ استمرار",
    orderCancelledByCustomer: "تم إلغاء طلبك. أرسل *مرحبا* لطلب جديد.",
    myOrders:      "📋 *طلباتك الأخيرة:*\n",
    noOrders:      "لا توجد طلبات سابقة.",
    vipQuestion:   "⭐ هل تريد فني VIP؟\nيضمن لك أفضل جودة وأسرع استجابة",
    vipYes:        "⭐ فني VIP",
    vipNo:         "👨‍🔧 فني عادي",
    vipList:       "اختر الفني VIP المناسب:",
    vipBtn:        "اختر فني VIP",
    vipBusy:       (n) => `⭐ *${n}* مشغول حالياً.\nهل تنتظر حتى يتوفر؟`,
    vipWaitYes:    "⏳ انتظار الفني",
    vipWaitNo:     "👨‍🔧 فني عادي بدلاً",
    vipWaiting:    (n) => `⏳ طلبك محفوظ في قائمة انتظار الفني *${n}*.\nسيتم إشعارك فور توفره.`,
    vipSummaryNote:(pct) => `\n⭐ رسوم VIP: +${pct}%`,
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
    chooseQty:     (n, p) => `How many "${n}"?\n💰 ${p} OMR each`,
    qtyBtn:        "Quantity",
    qtyTitle:      "Choose Quantity",
    addedPart:     (n, q, t) => `✅ ${n} x${q} = ${t} OMR`,
    addMore:       "Add another part?",
    addMoreBtn:    "Choose",
    yesMore:       "➕ Add another part",
    noMore:        "✅ Done",
    backToServices:"🔙 Back to Services",
    backToTypes:   "🔙 Back to Types",
    backToParts:   "🔙 Back to Parts",
    backToSummary: "🔙 Back to Summary",
    noParts:       "⚠️ No parts found. Add from dashboard.",
    noPartsNeeded: "🔧 No parts needed",
    summary:       (l, lb, pt, t) => `📋 *Order Summary*\n\n🔧 *Parts:*\n${l}\n\n💼 Labor: ${lb} OMR\n🔩 Parts: ${pt} OMR\n💰 *Total: ${t} OMR*`,
    confirmBtn:    "Confirm",
    confirmRow:    "✅ Confirm Order",
    cancelRow:     "❌ Cancel",
    cancelled:     "Cancelled. Send *hi* to start.",
    sendLocation:  "📍 Send your location to complete the order.",
    locationOnly:  "Please send your location via WhatsApp.",
    sessionExp:    "Session expired. Send *hi*.",
    noTech:        "⚠️ No technician available. Searching for 30 min.",
    noTechFinal:   (id) => `⚠️ No tech found in 30 min.\n🆔 ${id}`,
    noTechOptions: "Choose:",
    waitMore:      "⏳ Keep waiting",
    retryNow:      "🔄 New request",
    orderSent:     (id) => `✅ Order sent!\n🆔 *${id}*\nYou'll be notified.`,
    activeOrder:   (id, st) => `Active order:\n🆔 ${id}\nStatus: ${st}`,
    activeSearching: (id) => `🔍 Searching for a technician:\n🆔 *${id}*\nWhat would you like?`,
    cancelOrder:   "❌ Cancel Order",
    keepWaiting:   "⏳ Keep Waiting",
    orderCancelled:(id) => `Order cancelled 🆔 ${id}`,
    needRating:    "⭐ Please rate your previous order first before requesting a new service.",
    privacyNote:   "🔒 We use your data only to fulfill the order and improve our service.",
    accepted:      (n, p) => `✅ Accepted!\n👨‍🔧 ${n}\n📞 ${p}\nOn the way!`,
    rejected:      (id) => `❌ Tech rejected. Searching...\n🆔 ${id}`,
    completed:     (id) => `✅ Done!\n🆔 ${id}\nThank you! 🙏`,
    ratePrompt:    "⭐ Rate the service?",
    rateBtn:       "Rate",
    ratingDone:    (s) => `Thanks! You gave ${s} ⭐`,
    outOfZone:     "⚠️ Sorry, your location is outside our service area.\nWe're expanding soon! 🙏",
    rateLimited:   "⚠️ Too many messages. Please wait a minute.",
    techLate:      (n) => `⏰ It's been ${n} minutes since the technician accepted. Cancel?`,
    cancelAfterAccept: "❌ Cancel Order",
    keepOrder:     "✅ Keep Order",
    orderCancelledByCustomer: "Order cancelled. Send *hi* for a new request.",
    myOrders:      "📋 *Your recent orders:*\n",
    noOrders:      "No previous orders.",
    vipQuestion:   "⭐ Would you like a VIP technician?\nGuaranteed best quality & fastest response",
    vipYes:        "⭐ VIP Technician",
    vipNo:         "👨‍🔧 Regular Technician",
    vipList:       "Choose your VIP technician:",
    vipBtn:        "Choose VIP Tech",
    vipBusy:       (n) => `⭐ *${n}* is currently busy.\nWould you like to wait?`,
    vipWaitYes:    "⏳ Wait for this tech",
    vipWaitNo:     "👨‍🔧 Regular tech instead",
    vipWaiting:    (n) => `⏳ Your order is queued for *${n}*.\nYou'll be notified when available.`,
    vipSummaryNote:(pct) => `\n⭐ VIP fee: +${pct}%`,
    defaultMsg:    "Send *hi* to start."
  }
};

// ─── Technician Languages (AR / EN / HI / BN) ────────────────────────────────
const TECH_LANGS = {
  ar: {
    chooseLang:    "مرحباً! اختر لغتك 👇",
    langBtn:       "اللغة",
    langTitle:     "اختر لغتك",
    newOrder:      (id, svc, type, parts, labor, total) =>
      `🔔 *طلب جديد!*\n🆔 ${id}\n🔧 ${svc} - ${type}\n\n*القطع:*\n${parts}\n\n💼 أجرة: ${labor} ر.ع\n💰 *الإجمالي: ${total} ر.ع*`,
    acceptBtn:     "اختر",
    acceptRow:     "✅ قبول",
    rejectRow:     "❌ رفض",
    customerPhone: (p) => `📞 هاتف العميل: ${p}`,
    doneBtn:       "إنهاء",
    doneRow:       "✅ إنهاء الطلب",
    doneLabel:     (id) => `${id} - اضغط عند الإنهاء`,
    techDone:      (id, c, b) => `✅ ${id} مكتمل.\n💸 عمولة: ${c} ر.ع\n💰 رصيدك: ${b} ر.ع`,
    lowBalance:    (b, m) => `⚠️ *رصيد منخفض!*\nرصيدك: ${b} ر.ع\nالحد الأدنى: *${m} ر.ع*\nيرجى الشحن.\n📞 تواصل مع الإدارة.`,
    techRejected:  "تم رفض الطلب.",
    orderNotFound: "الطلب غير موجود.",
    alreadyProc:   "تمت معالجة الطلب مسبقاً.",
    alreadyDone:   "الطلب مكتمل مسبقاً.",
    info:          (n, p, r, b, a) => `👤 ${n}\n📞 ${p}\n⭐ ${r || "لا يوجد"}\n💰 ${b} ر.ع\n🟢 ${a ? "متاح" : "مشغول"}`
  },
  en: {
    chooseLang:    "Hello! Choose your language 👇",
    langBtn:       "Language",
    langTitle:     "Choose Language",
    newOrder:      (id, svc, type, parts, labor, total) =>
      `🔔 *New Order!*\n🆔 ${id}\n🔧 ${svc} - ${type}\n\n*Parts:*\n${parts}\n\n💼 Labor: ${labor} OMR\n💰 *Total: ${total} OMR*`,
    acceptBtn:     "Choose",
    acceptRow:     "✅ Accept",
    rejectRow:     "❌ Reject",
    customerPhone: (p) => `📞 Customer: ${p}`,
    doneBtn:       "Finish",
    doneRow:       "✅ Mark Done",
    doneLabel:     (id) => `${id} - Mark when done`,
    techDone:      (id, c, b) => `✅ ${id} done.\n💸 Commission: ${c} OMR\n💰 Balance: ${b} OMR`,
    lowBalance:    (b, m) => `⚠️ *Low Balance!*\nBalance: ${b} OMR\nMinimum: *${m} OMR*\nPlease recharge.\n📞 Contact admin.`,
    techRejected:  "Order rejected.",
    orderNotFound: "Order not found.",
    alreadyProc:   "Order already processed.",
    alreadyDone:   "Order already completed.",
    info:          (n, p, r, b, a) => `👤 ${n}\n📞 ${p}\n⭐ ${r || "N/A"}\n💰 ${b} OMR\n🟢 ${a ? "Available" : "Busy"}`
  },
  hi: {
    chooseLang:    "नमस्ते! अपनी भाषा चुनें 👇",
    langBtn:       "भाषा",
    langTitle:     "भाषा चुनें",
    newOrder:      (id, svc, type, parts, labor, total) =>
      `🔔 *नया ऑर्डर!*\n🆔 ${id}\n🔧 ${svc} - ${type}\n\n*पार्ट्स:*\n${parts}\n\n💼 मजदूरी: ${labor} OMR\n💰 *कुल: ${total} OMR*`,
    acceptBtn:     "चुनें",
    acceptRow:     "✅ स्वीकार करें",
    rejectRow:     "❌ अस्वीकार",
    customerPhone: (p) => `📞 ग्राहक: ${p}`,
    doneBtn:       "समाप्त",
    doneRow:       "✅ काम पूरा",
    doneLabel:     (id) => `${id} - पूरा होने पर दबाएं`,
    techDone:      (id, c, b) => `✅ ${id} पूरा हुआ।\n💸 कमीशन: ${c} OMR\n💰 बैलेंस: ${b} OMR`,
    lowBalance:    (b, m) => `⚠️ *कम बैलेंस!*\nबैलेंस: ${b} OMR\nन्यूनतम: *${m} OMR*\nरिचार्ज करें।\n📞 एडमिन से संपर्क करें।`,
    techRejected:  "ऑर्डर अस्वीकार।",
    orderNotFound: "ऑर्डर नहीं मिला।",
    alreadyProc:   "ऑर्डर पहले ही प्रोसेस हो गया।",
    alreadyDone:   "ऑर्डर पहले ही पूरा हो गया।",
    info:          (n, p, r, b, a) => `👤 ${n}\n📞 ${p}\n⭐ ${r || "N/A"}\n💰 ${b} OMR\n🟢 ${a ? "उपलब्ध" : "व्यस्त"}`
  },
  bn: {
    chooseLang:    "হ্যালো! আপনার ভাষা বেছে নিন 👇",
    langBtn:       "ভাষা",
    langTitle:     "ভাষা বেছে নিন",
    newOrder:      (id, svc, type, parts, labor, total) =>
      `🔔 *নতুন অর্ডার!*\n🆔 ${id}\n🔧 ${svc} - ${type}\n\n*পার্টস:*\n${parts}\n\n💼 শ্রম: ${labor} OMR\n💰 *মোট: ${total} OMR*`,
    acceptBtn:     "বেছে নিন",
    acceptRow:     "✅ গ্রহণ করুন",
    rejectRow:     "❌ প্রত্যাখ্যান",
    customerPhone: (p) => `📞 গ্রাহক: ${p}`,
    doneBtn:       "শেষ করুন",
    doneRow:       "✅ কাজ সম্পন্ন",
    doneLabel:     (id) => `${id} - শেষ হলে চাপুন`,
    techDone:      (id, c, b) => `✅ ${id} সম্পন্ন।\n💸 কমিশন: ${c} OMR\n💰 ব্যালেন্স: ${b} OMR`,
    lowBalance:    (b, m) => `⚠️ *কম ব্যালেন্স!*\nব্যালেন্স: ${b} OMR\nন্যূনতম: *${m} OMR*\nরিচার্জ করুন।\n📞 অ্যাডমিন যোগাযোগ করুন।`,
    techRejected:  "অর্ডার প্রত্যাখ্যাত।",
    orderNotFound: "অর্ডার পাওয়া যায়নি।",
    alreadyProc:   "অর্ডার ইতিমধ্যে প্রক্রিয়া করা হয়েছে।",
    alreadyDone:   "অর্ডার ইতিমধ্যে সম্পন্ন।",
    info:          (n, p, r, b, a) => `👤 ${n}\n📞 ${p}\n⭐ ${r || "N/A"}\n💰 ${b} OMR\n🟢 ${a ? "উপলব্ধ" : "ব্যস্ত"}`
  }
};

// ─── Lang Selector Rows ───────────────────────────────────────────────────────
const LANG_ROWS = [
  { id: "techlang_ar", title: "🇸🇦 العربية" },
  { id: "techlang_en", title: "🇬🇧 English"  },
  { id: "techlang_hi", title: "🇮🇳 हिन्दी"   },
  { id: "techlang_bn", title: "🇧🇩 বাংলা"    }
];

// ─── كلمات الترحيب المعروفة ────────────────────────────────────────────────────
const GREETINGS = [
  "مرحبا","مرحباً","مرحبه","هلا","هلو","اهلا","أهلا","أهلاً","اهلاً",
  "السلام","السلام عليكم","صباح الخير","مساء الخير","ابدأ","بدء","ابدا",
  "hi","hello","hey","start","begin","yo","sup","helo","helo"
];

function isGreeting(text) {
  const t = text.trim().toLowerCase();
  return GREETINGS.some(g => t === g || t.startsWith(g + " ") || t.includes(g));
}

// ─── Session Helpers ──────────────────────────────────────────────────────────
async function getSession(phone) {
  const doc = await db.collection("sessions").doc(phone).get();
  return doc.exists ? doc.data() : { state: null, data: {} };
}
async function setSession(phone, state, data) {
  await db.collection("sessions").doc(phone).set({
    state,
    data: data || {},
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
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

// ─── دالة مشتركة لعرض قائمة اختيار اللغة للعميل ─────────────────────────────
async function sendLanguageMenu(phone) {
  await sendButtons(phone,
    "مرحباً بك! 👋\nWelcome!\n\nاختر لغتك\nChoose your language",
    [
      { id: "custlang_ar", title: "🇸🇦 العربية" },
      { id: "custlang_en", title: "🇬🇧 English"  }
    ]
  );
}

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

// ─── إرسال أزرار (تُستخدم تلقائياً عند أقل من 3 خيارات) ─────────────────────
async function sendButtons(to, body, buttons) {
  try {
    // واتساب يقبل 1-3 أزرار فقط
    const safeButtons = buttons.slice(0, 3).map(b => ({
      type: "reply",
      reply: {
        id:    String(b.id    || "").substring(0, 256),
        title: String(b.title || "").substring(0, 20)
      }
    }));
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp", to, type: "interactive",
        interactive: {
          type: "button",
          body: { text: String(body || "").substring(0, 1024) },
          action: { buttons: safeButtons }
        }
      },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch(e) {
    console.error("sendButtons ERROR:", e.message);
    if (e.response) console.error("sendButtons DETAILS:", JSON.stringify(e.response.data));
  }
}

// ─── دالة ذكية: قائمة إذا 4+ خيارات، أزرار إذا 3 أو أقل ────────────────────
async function sendMenu(to, body, buttonLabel, rows) {
  if (rows.length > 3) {
    await sendList(to, body, buttonLabel, [{ title: buttonLabel, rows }]);
  } else {
    await sendButtons(to, body, rows.map(r => ({ id: r.id, title: r.title })));
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

function getServiceName(service, lang) {
  // هيكل جديد: name.ar / name.en / name.hi / name.bn
  if (service.name && typeof service.name === "object") {
    if (lang === "ar") return service.name.ar || service.name.en || service.id;
    if (lang === "en") return service.name.en || service.name.ar || service.id;
    if (lang === "hi") return service.name.hi || service.name.en || service.name.ar || service.id;
    if (lang === "bn") return service.name.bn || service.name.en || service.name.ar || service.id;
    return service.name.ar || service.id;
  }
  // هيكل قديم: nameAr / nameEn / nameHi / nameBn
  if (lang === "ar") return service.nameAr || service.name || service.id;
  if (lang === "en") return service.nameEn || service.nameAr || service.name || service.id;
  if (lang === "hi") return service.nameHi || service.nameEn || service.nameAr || service.name || service.id;
  if (lang === "bn") return service.nameBn || service.nameEn || service.nameAr || service.name || service.id;
  return service.nameAr || service.name || service.id;
}

function getTypeNameL(type, lang) {
  if (!type) return "";
  // هيكل جديد: name.ar / name.en / name.hi / name.bn
  if (type.name && typeof type.name === "object") {
    if (lang === "ar") return type.name.ar || type.name.en || "";
    if (lang === "en") return type.name.en || type.name.ar || "";
    if (lang === "hi") return type.name.hi || type.name.en || type.name.ar || "";
    if (lang === "bn") return type.name.bn || type.name.en || type.name.ar || "";
    return type.name.ar || "";
  }
  // هيكل قديم: string أو nameAr/nameEn/nameHi/nameBn
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

// ─── التحقق من المنطقة المخدومة ──────────────────────────────────────────────

// حساب المسافة بين نقطتين بالكيلومتر (Haversine)
function calcDistanceKm(lat1, lng1, lat2, lng2) {
  const R    = 6371; // نصف قطر الأرض بالكيلومتر
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// يرجع المنطقة المخدومة إذا كان الموقع داخلها، أو null إذا خارجها
async function getRegionForLocation(lat, lng) {
  const snap = await db.collection("regions").where("active", "==", true).get();
  for (const doc of snap.docs) {
    const r        = doc.data();
    const centerLat = r.centerLat;
    const centerLng = r.centerLng;
    const radiusKm  = r.radiusKm || r.radius || 10;
    const dist      = calcDistanceKm(lat, lng, centerLat, centerLng);
    if (dist <= radiusKm) return { id: doc.id, ...r };
  }
  return null;
}

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
  const lang = order.lang || "ar";
  const CL2  = CUSTOMER_LANGS[lang] || CUSTOMER_LANGS.ar;

  // ── VIP: إرسال مباشر للفني المختار ─────────────────────────────────────────
  if (order.vip && order.vipTechId) {
    const techSnap = await db.collection("technicians").doc(order.vipTechId).get();
    if (techSnap.exists) {
      const tech = { id: techSnap.id, ...techSnap.data() };
      if (!tech.active) {
        // الفني مشغول → حفظ الطلب بحالة waiting_vip
        await db.collection("orders").doc(orderId).update({ status: "waiting_vip" });
        // سيُرسل له تلقائياً عند تفرغه (في handleDone)
        return;
      }
      // الفني متاح → أرسل له الطلب
      await sendOrderToTech(orderId, order, tech);
      return;
    }
  }

  // ── عادي: البحث عن فني متاح ──────────────────────────────────────────────
  const tech = await getAvailableTech(order.serviceId, order.rejectedTechs || []);

  if (!tech) {
    const ref         = db.collection("orders").doc(orderId);
    const searchStart = order.searchStartedAt;
    if (!searchStart) {
      await ref.update({ status: "searching", searchStartedAt: admin.firestore.FieldValue.serverTimestamp() });
      await sendMessage(normalize(order.customer), CL2.noTech);
      return;
    }
    const elapsed = (Date.now() - searchStart.toDate().getTime()) / 60000;
    if (elapsed >= RETRY_MINUTES) {
      await ref.update({ status: "no_tech" });
      await sendMessage(normalize(order.customer), CL2.noTechFinal(order.orderId));
      await sendMenu(normalize(order.customer), CL2.noTechOptions, CL2.addMoreBtn, [
        { id: `wait_${orderId}`, title: CL2.waitMore },
        { id: "mrhba",           title: CL2.retryNow }
      ]);
    }
    return;
  }

  await sendOrderToTech(orderId, order, tech);
}

// ─── إرسال الطلب لفني محدد ───────────────────────────────────────────────────
async function sendOrderToTech(orderId, order, tech) {
  const TL2       = TECH_LANGS[getTLang(tech)] || TECH_LANGS.ar;
  const techLang  = getTLang(tech);
  const techPhone = normalize(tech.phone);

  // اسم الخدمة والنوع بلغة الفني
  const serviceSnap = await db.collection("services").doc(order.serviceId).get();
  const serviceData = serviceSnap.exists ? serviceSnap.data() : null;
  const svcName = serviceData ? getServiceName({ ...serviceData, id: order.serviceId }, techLang) : order.serviceName;

  // النوع بلغة الفني
  let typeName = order.type || "";
  if (serviceData && serviceData.types) {
    const matchedType = serviceData.types.find(t => {
      if (order.typeId && (t.id === order.typeId)) return true;
      if (t.name && typeof t.name === "object") return Object.values(t.name).includes(order.type);
      return t.nameAr === order.type || t.nameEn === order.type ||
             t.nameHi === order.type || t.nameBn === order.type || t.name === order.type;
    });
    if (matchedType) typeName = getTypeNameL(matchedType, techLang) || order.type;
  }

  // القطع بلغة الفني
  let partsText = "";
  if (order.parts && order.parts.length > 0) {
    const allParts = await getPartsByService(order.serviceId);
    partsText = order.parts.map(op => {
      const fullPart = allParts.find(p => p.id === op.id);
      const pName = fullPart ? getPartName(fullPart, techLang) : op.name;
      return `• ${pName} x${op.qty} = ${op.total} OMR`;
    }).join("\n");
  }

  // المسافة
  let distanceText = "";
  if (tech.lat && tech.lng && order.location) {
    const dist = calcDistanceKm(tech.lat, tech.lng, order.location.latitude, order.location.longitude);
    distanceText = techLang === "ar"
      ? `\n📍 المسافة: ${dist.toFixed(1)} كم`
      : `\n📍 Distance: ${dist.toFixed(1)} km`;
  }

  // إشارة VIP للفني
  const vipBadge = order.vip ? (techLang === "ar" ? "\n⭐ *طلب VIP*" : "\n⭐ *VIP Order*") : "";

  await sendMessage(techPhone,
    TL2.newOrder(order.orderId, svcName, typeName, partsText, order.laborPrice || 0, order.totalPrice || 0)
    + distanceText + vipBadge
  );

  // موقع العميل
  if (order.location) await sendLocation(techPhone, order.location.latitude, order.location.longitude);

  await sendMenu(techPhone,
    techLang === "ar" ? "هل تقبل هذا الطلب؟" : "Accept this order?",
    TL2.acceptBtn,
    [
      { id: `accept_${orderId}`, title: TL2.acceptRow },
      { id: `reject_${orderId}`, title: TL2.rejectRow }
    ]
  );
  await db.collection("orders").doc(orderId).update({
    technicianId: tech.id, techPhone, status: "pending"
  });
}

// ─── اسم القطعة حسب اللغة ────────────────────────────────────────────────────
function getPartName(part, lang) {
  // هيكل جديد: name.ar / name.en / name.hi / name.bn
  if (part.name && typeof part.name === "object") {
    if (lang === "ar") return part.name.ar || part.name.en || "قطعة";
    if (lang === "en") return part.name.en || part.name.ar || "Part";
    if (lang === "hi") return part.name.hi || part.name.en || part.name.ar || "पुर्जा";
    if (lang === "bn") return part.name.bn || part.name.en || part.name.ar || "যন্ত্রাংশ";
    return part.name.ar || "قطعة";
  }
  // هيكل قديم: string
  return part.name || "قطعة";
}

// ─── التحقق من وجود تقييم معلق ──────────────────────────────────────────────
async function getPendingRatingOrder(phone) {
  try {
    const snap = await db.collection("orders")
      .where("customer", "==", phone)
      .where("status", "==", "done")
      .limit(10).get();
    for (const doc of snap.docs) {
      const d = doc.data();
      // التحقق الصريح — التقييم غير موجود إذا كان undefined أو null فقط
      if (d.rating === undefined || d.rating === null) {
        return { id: doc.id, ...d };
      }
    }
    return null;
  } catch(e) {
    console.error("getPendingRatingOrder:", e.message);
    return null;
  }
}

// ─── تحديث بيانات العميل في Firestore ────────────────────────────────────────
async function updateCustomerData(phone, location = null) {
  try {
    const ref = db.collection("customers").doc(phone);
    const snap = await ref.get();
    const now  = admin.firestore.FieldValue.serverTimestamp();
    if (!snap.exists) {
      const data = { phone, firstSeen: now, lastSeen: now, totalOrders: 0 };
      if (location) data.lastLocation = location;
      await ref.set(data);
    } else {
      const update = { lastSeen: now };
      if (location) update.lastLocation = location;
      await ref.update(update);
    }
  } catch(e) { console.error("updateCustomerData:", e.message); }
}

// ─── زيادة عداد الطلبات للعميل ───────────────────────────────────────────────
async function incrementCustomerOrders(phone) {
  try {
    await db.collection("customers").doc(phone).update({
      totalOrders: admin.firestore.FieldValue.increment(1)
    });
  } catch(e) {
    // إذا ما وُجد العميل أنشئه
    await updateCustomerData(phone);
    await db.collection("customers").doc(phone).update({
      totalOrders: admin.firestore.FieldValue.increment(1)
    });
  }
}

// ─── VIP: جلب الفنيين VIP للخدمة ─────────────────────────────────────────────
async function getVipTechs(serviceId) {
  const snap = await db.collection("technicians")
    .where("vip", "==", true)
    .where("services", "array-contains", serviceId).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(t => (t.balance || 0) >= MIN_BALANCE);
}

// ─── VIP: إرسال قائمة الفنيين VIP ────────────────────────────────────────────
async function sendVipTechList(phone, vipTechs, lang, baseTotal) {
  const L2       = CUSTOMER_LANGS[lang] || CUSTOMER_LANGS.ar;
  const VIP_RATE = 0.20;
  const rows = vipTechs.map(t => {
    const vipTotal = Math.round(baseTotal * (1 + VIP_RATE) * 100) / 100;
    const stars    = t.rating ? "⭐".repeat(Math.min(Math.round(t.rating), 5)) : "—";
    const status   = t.active ? (lang === "ar" ? "✅ متاح" : "✅ Available")
                               : (lang === "ar" ? "🔴 مشغول" : "🔴 Busy");
    return {
      id:          `vip_${t.id}`,
      title:       String(t.name || "VIP").substring(0, 24),
      description: `${stars} · ${vipTotal} ر.ع · ${status}`
    };
  });
  rows.push({ id: "vip_skip", title: L2.vipNo });
  await sendList(phone, L2.vipList, L2.vipBtn, [{ title: "VIP ⭐", rows: rows.slice(0, 10) }]);
}

function applyVipRate(total, rate = 0.20) {
  return Math.round(total * (1 + rate) * 100) / 100;
}

async function sendPartsMenu(phone, service, selectedParts, lang) {
  const L2    = CUSTOMER_LANGS[lang] || CUSTOMER_LANGS.ar;
  const parts = await getPartsByService(service.id);
  if (!parts.length) { await sendMessage(phone, L2.noParts); return; }
  const selIds = (selectedParts || []).map(p => p.id);

  // ── فلترة القطع حسب المخزون (stock=0 تُخفى، stock=undefined = غير محدود) ──
  const availableParts = parts.filter(p => p.stock === undefined || p.stock === null || p.stock > 0);

  if (!availableParts.length) {
    await sendMessage(phone, lang === "ar" ? "⚠️ جميع القطع نفدت حالياً." : "⚠️ All parts are out of stock.");
    return;
  }

  const rows = availableParts.map(p => {
    const stockInfo = (p.stock !== undefined && p.stock !== null)
      ? ` (${p.stock} ${lang === "ar" ? "متبقي" : "left"})`
      : "";
    return {
      id: "part_" + p.id,
      title: String(getPartName(p, lang)).substring(0, 24),
      description: `${p.price} ر.ع${stockInfo}` + (selIds.includes(p.id) ? " ✅" : "")
    };
  });

  // ── خيار بدون قطع ─────────────────────────────────────────────────────────
  rows.unshift({ id: "noparts_needed", title: L2.noPartsNeeded, description: lang === "ar" ? "أجرة الخدمة فقط" : "Labor only" });
  if (selectedParts && selectedParts.length > 0) rows.push({ id: "nomore", title: L2.noMore });
  const hasTypes = service.types && service.types.length > 0;
  rows.push({ id: hasTypes ? "back_types" : "back_services", title: hasTypes ? L2.backToTypes : L2.backToServices });
  await sendList(phone, L2.chooseParts(getServiceName(service, lang)), L2.partsBtn,
    [{ title: L2.partsTitle, rows: rows.slice(0, 10) }]
  );
}

// ─── Summary ──────────────────────────────────────────────────────────────────
async function showSummary(phone, session, lang) {
  const L2         = CUSTOMER_LANGS[lang] || CUSTOMER_LANGS.ar;
  const { service, selectedType, parts, vipTechId, vipRate } = session.data;
  const partsTotal  = (parts || []).reduce((s, p) => s + p.total, 0);
  const laborPrice  = selectedType ? selectedType.price : 0;
  const baseTotal   = Math.round((partsTotal + laborPrice) * 100) / 100;
  const totalPrice  = vipTechId ? applyVipRate(baseTotal, vipRate || 0.20) : baseTotal;
  const lines       = (parts || []).map(p => `• ${p.name} x${p.qty} = ${p.total} ر.ع`).join("\n") || (lang === "ar" ? "بدون قطع" : "No parts");
  const vipNote     = vipTechId ? L2.vipSummaryNote(20) : "";
  await sendMessage(phone, L2.summary(lines, laborPrice, Math.round(partsTotal*100)/100, totalPrice) + vipNote);
  await setSession(phone, "confirm", { ...session.data, totalPrice });
  await sendButtons(phone, lang === "ar" ? "هل تؤكد الطلب؟" : "Confirm order?", [
    { id: "confirm",    title: L2.confirmRow  },
    { id: "back_parts", title: L2.backToParts },
    { id: "cancel",     title: L2.cancelRow   }
  ]);
}

// ─── VIP: سؤال العميل هل يريد VIP ────────────────────────────────────────────
async function askVipQuestion(phone, session, lang, baseTotal) {
  const L2       = CUSTOMER_LANGS[lang] || CUSTOMER_LANGS.ar;
  const vipTechs = await getVipTechs(session.data.service.id);
  if (!vipTechs.length) {
    // لا يوجد فنيون VIP → اذهب للملخص مباشرة
    await showSummary(phone, session, lang);
    return;
  }
  await setSession(phone, "vip_question", { ...session.data, baseTotal });
  await sendMenu(phone, L2.vipQuestion, L2.vipBtn, [
    { id: "vip_yes",  title: L2.vipYes },
    { id: "vip_skip", title: L2.vipNo  }
  ]);
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

    // ── Rate Limiting ─────────────────────────────────────────────────────────
    if (checkRateLimit(from)) {
      const tech2 = await getTechByPhone(from);
      if (!tech2) await sendMessage(from, CUSTOMER_LANGS.ar.rateLimited);
      return;
    }

    // ── "طلباتي" — عرض تاريخ العميل ──────────────────────────────────────────
    if (msg.type === "text" && ["طلباتي","my orders","my order","طلبات"].includes(text.toLowerCase())) {
      const session0 = await getSession(from);
      const L0 = CUSTOMER_LANGS[getCLang(session0)] || CUSTOMER_LANGS.ar;
      const mySnap = await db.collection("orders")
        .where("customer", "==", from)
        .limit(5).get();
      if (mySnap.empty) { await sendMessage(from, L0.noOrders); return; }
      const myList = mySnap.docs.map(d => d.data())
        .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
      const lines = myList.map(o => {
        const date = o.createdAt ? new Date(o.createdAt.seconds*1000).toLocaleDateString("ar") : "-";
        return `• 🆔 ${o.orderId} — ${o.serviceName||"-"} — ${(o.totalPrice||0).toFixed(2)} ر.ع — ${date}`;
      }).join("\n");
      await sendMessage(from, L0.myOrders + lines);
      return;
    }

    // ── إلغاء الطلب بعد قبول الفني ───────────────────────────────────────────
    if (text.startsWith("cancel_accepted_")) {
      const orderId0 = text.replace("cancel_accepted_", "");
      const session0 = await getSession(from);
      const L0 = CUSTOMER_LANGS[getCLang(session0)] || CUSTOMER_LANGS.ar;
      const oRef = db.collection("orders").doc(orderId0);
      const oSnap = await oRef.get();
      if (oSnap.exists && oSnap.data().customer === from && oSnap.data().status === "accepted") {
        const oData = oSnap.data();
        await oRef.update({ status: "cancelled", cancelledAt: admin.firestore.FieldValue.serverTimestamp(), cancelledBy: "customer_after_accept" });
        // إعادة تفعيل الفني
        if (oData.technicianId) await db.collection("technicians").doc(oData.technicianId).update({ active: true });
        // إشعار الفني
        if (oData.techPhone) {
          const techDoc = await db.collection("technicians").doc(oData.technicianId||"").get();
          const tLang   = techDoc.exists ? (techDoc.data().lang || "ar") : "ar";
          const TL0     = TECH_LANGS[tLang] || TECH_LANGS.ar;
          await sendMessage(normalize(oData.techPhone), TL0.techRejected);
        }
        await addOrderHistory(orderId0, "cancelled", from, "customer cancelled after accept");
        await clearSession(from);
        await sendMessage(from, L0.orderCancelledByCustomer);
      }
      return;
    }

    // ── فني ───────────────────────────────────────────────────────────────────
    const tech = await getTechByPhone(from);
    if (tech) {
      if (text.startsWith("accept_")) { await handleAccept(text, from, tech); return; }
      if (text.startsWith("reject_")) { await handleReject(text, from, tech); return; }
      if (text.startsWith("done_"))   { await handleDone(text, from, tech);   return; }

      if (text.startsWith("techlang_")) {
        const chosenLang = text.replace("techlang_", "");
        if (TECH_LANGS[chosenLang]) {
          await db.collection("technicians").doc(tech.id).update({ lang: chosenLang });
          const TL2 = TECH_LANGS[chosenLang];
          await sendMessage(from, TL2.info(tech.name, tech.phone, tech.rating, tech.balance||0, tech.active));
        }
        return;
      }

      if (["info","معلومات","जानकारी","তথ্য"].includes(text)) {
        const TL2 = TECH_LANGS[getTLang(tech)] || TECH_LANGS.ar;
        await sendMessage(from, TL2.info(tech.name, tech.phone, tech.rating, tech.balance||0, tech.active));
        return;
      }

      // أي رسالة أخرى من الفني → قائمة اللغات
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

    // ── إلغاء الطلب من قِبل العميل ───────────────────────────────────────────
    if (text.startsWith("cancel_order_")) {
      const orderId = text.replace("cancel_order_", "");
      const session = await getSession(from);
      const L2 = CUSTOMER_LANGS[getCLang(session)] || CUSTOMER_LANGS.ar;
      try {
        const oSnap = await db.collection("orders").doc(orderId).get();
        if (oSnap.exists && oSnap.data().customer === from) {
          await db.collection("orders").doc(orderId).update({
            status: "cancelled",
            cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
            cancelledBy: "customer"
          });
          await clearSession(from);
          await sendMessage(from, L2.orderCancelled(oSnap.data().orderId || orderId));
        }
      } catch(e) { console.error("cancel_order:", e.message); }
      return;
    }

    // ── الانتظار (keep) ───────────────────────────────────────────────────────
    if (text.startsWith("keep_")) {
      const session = await getSession(from);
      const L2 = CUSTOMER_LANGS[getCLang(session)] || CUSTOMER_LANGS.ar;
      await sendMessage(from, L2.noTech);
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

    // ── ✅ التعديل: تعرف على كلمات الترحيب في أي وقت ─────────────────────────
    if (msg.type === "text" && isGreeting(text)) {
      await clearSession(from);
      // تسجيل العميل
      await updateCustomerData(from);
      await sendLanguageMenu(from);
      return;
    }

    // ── اختيار لغة العميل من القائمة ─────────────────────────────────────────
    if (text === "custlang_ar" || text === "custlang_en") {
      const lang = text.replace("custlang_", "");
      await clearSession(from);
      const L2 = CUSTOMER_LANGS[lang];

      // ── 4: تسجيل بيانات العميل ──────────────────────────────────────────────
      await updateCustomerData(from);

      // ── 1: طلب قيد البحث → خيار الانتظار أو الإلغاء ─────────────────────────
      const active = await getActiveOrder(from);
      if (active) {
        if (active.status === "searching") {
          await sendButtons(from, L2.activeSearching(active.orderId), [
            { id: `keep_${active.id}`,   title: L2.keepWaiting },
            { id: `cancel_order_${active.id}`, title: L2.cancelOrder }
          ]);
          await setSession(from, "main", { lang });
          return;
        }
        await sendMessage(from, L2.activeOrder(active.orderId, active.status));
        return;
      }

      // ── 2: تقييم معلق → لا يمكن الطلب قبل التقييم ──────────────────────────
      const pendingRating = await getPendingRatingOrder(from);
      if (pendingRating) {
        await sendMessage(from, L2.needRating);
        await sendRatingPrompt(from, pendingRating.id, lang);
        await setSession(from, "main", { lang });
        return;
      }

      // ── 4: رسالة الخصوصية ────────────────────────────────────────────────────
      await sendMessage(from, L2.privacyNote);

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

    // زائر جديد بدون جلسة → قائمة اللغة
    if (!session.state) {
      await sendLanguageMenu(from);
      return;
    }

    // ── انتهاء الجلسة بعد SESSION_TIMEOUT_MINUTES ────────────────────────────
    if (session.updatedAt) {
      const elapsed = (Date.now() - session.updatedAt.toDate().getTime()) / 60000;
      if (elapsed > SESSION_TIMEOUT_MINUTES) {
        await clearSession(from);
        await sendLanguageMenu(from);
        return;
      }
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
        const typeRows = service.types.map((t, i) => ({
          id: "type_" + i,
          title: String(getTypeNameL(t, lang) || "نوع").substring(0, 24),
          description: t.price + " ر.ع"
        }));
        typeRows.push({ id: "back_services", title: L2.backToServices });
        await sendList(from, getServiceName(service, lang), L2.typesBtn, [{
          title: L2.chooseType, rows: typeRows
        }]);
      } else {
        await setSession(from, "parts", { ...session.data, service, selectedType: { name: getServiceName(service, lang), price: 0 }, parts: [] });
        await sendPartsMenu(from, service, [], lang);
      }
      return;
    }

    // ── type: اختيار النوع ────────────────────────────────────────────────────
    if (session.state === "type") {
      if (text === "back_services") {
        const services = await getServices();
        await setSession(from, "main", { lang });
        await sendList(from, L2.welcome, L2.servicesBtn, [{
          title: L2.servicesTitle,
          rows: services.map(s => ({ id: "service_" + s.id, title: String(getServiceName(s, lang)).substring(0, 24) }))
        }]);
        return;
      }
      if (text.startsWith("type_")) {
        const index   = parseInt(text.replace("type_", ""));
        const service = session.data.service;
        if (!service || isNaN(index) || !service.types[index]) { await sendMessage(from, L2.defaultMsg); return; }
        const selectedType = service.types[index];
        await setSession(from, "parts", { ...session.data, selectedType, parts: [] });
        await sendPartsMenu(from, service, [], lang);
        return;
      }
    }

    // ── parts: اختيار القطع ───────────────────────────────────────────────────
    if (session.state === "parts") {
      if (text === "nomore" || text === "noparts_needed") {
        // حساب السعر الأساسي ثم اسأل عن VIP
        const { selectedType, parts: sp } = session.data;
        const pt = (sp||[]).reduce((s,p)=>s+p.total, 0);
        const lp = selectedType ? selectedType.price : 0;
        const base = Math.round((pt+lp)*100)/100;
        if (text === "noparts_needed") {
          await setSession(from, "parts", { ...session.data, parts: [] });
          session.data.parts = [];
        }
        await askVipQuestion(from, session, lang, base);
        return;
      }
      // رجوع للأنواع
      if (text === "back_types") {
        const service = session.data.service;
        await setSession(from, "type", { ...session.data });
        const typeRows = service.types.map((t, i) => ({
          id: "type_" + i,
          title: String(getTypeNameL(t, lang) || "نوع").substring(0, 24),
          description: t.price + " ر.ع"
        }));
        typeRows.push({ id: "back_services", title: L2.backToServices });
        await sendList(from, getServiceName(service, lang), L2.typesBtn, [{ title: L2.chooseType, rows: typeRows }]);
        return;
      }
      // رجوع للخدمات
      if (text === "back_services") {
        const services = await getServices();
        await setSession(from, "main", { lang });
        await sendList(from, L2.welcome, L2.servicesBtn, [{
          title: L2.servicesTitle,
          rows: services.map(s => ({ id: "service_" + s.id, title: String(getServiceName(s, lang)).substring(0, 24) }))
        }]);
        return;
      }
      if (text.startsWith("part_")) {
        const partId   = text.replace("part_", "");
        const allParts = await getPartsByService(session.data.service.id);
        const part     = allParts.find(p => p.id === partId);
        if (!part) { await sendMessage(from, L2.defaultMsg); return; }

        // ── فحص الحد الأقصى للقطع المختلفة ──────────────────────────────────
        const currentParts = session.data.parts || [];
        const isAlreadyAdded = currentParts.some(p => p.id === partId);
        if (!isAlreadyAdded && currentParts.length >= MAX_PARTS_PER_ORDER) {
          const maxMsg = lang === "ar"
            ? `⚠️ الحد الأقصى ${MAX_PARTS_PER_ORDER} أنواع قطع في طلب واحد.`
            : `⚠️ Maximum ${MAX_PARTS_PER_ORDER} part types per order.`;
          await sendMessage(from, maxMsg);
          await sendPartsMenu(from, session.data.service, currentParts, lang);
          return;
        }

        // ── فحص المخزون ───────────────────────────────────────────────────────
        if (part.stock !== undefined && part.stock !== null && part.stock <= 0) {
          const outMsg = lang === "ar" ? "⚠️ هذه القطعة نفدت من المخزون." : "⚠️ This part is out of stock.";
          await sendMessage(from, outMsg);
          await sendPartsMenu(from, session.data.service, currentParts, lang);
          return;
        }

        await setSession(from, "qty", { ...session.data, pendingPart: part });
        await sendList(from, L2.chooseQty(getPartName(part, lang), part.price), L2.qtyBtn, [{
          title: L2.qtyTitle,
          rows: [
            ...[1,2,3,4,5].map(n => ({ id: "qty_" + n, title: n + (lang==="ar"?" قطع":" pcs") })),
            { id: "back_parts", title: L2.backToParts }
          ]
        }]);
        return;
      }
      if (text === "addmore") { await sendPartsMenu(from, session.data.service, session.data.parts||[], lang); return; }
    }

    // ── qty: اختيار الكمية ────────────────────────────────────────────────────
    if (session.state === "qty") {
      if (text === "back_parts") {
        await setSession(from, "parts", { ...session.data, pendingPart: null });
        await sendPartsMenu(from, session.data.service, session.data.parts||[], lang);
        return;
      }
      if (text.startsWith("qty_")) {
        const qty      = parseInt(text.replace("qty_", ""));
        const part     = session.data.pendingPart;
        const parts    = session.data.parts || [];
        const partName = getPartName(part, lang);
        const total    = Math.round(part.price * qty * 100) / 100;
        const idx      = parts.findIndex(p => p.id === part.id);
        if (idx >= 0) { parts[idx].qty += qty; parts[idx].total += total; }
        else parts.push({ id: part.id, name: partName, qty, unitPrice: part.price, total });
        await sendMessage(from, L2.addedPart(partName, qty, total));
        await setSession(from, "parts", { ...session.data, parts, pendingPart: null });
        await sendMenu(from, L2.addMore, L2.addMoreBtn, [
          { id: "addmore", title: L2.yesMore },
          { id: "nomore",  title: L2.noMore  }
        ]);
        return;
      }
    }

    // ── vip_question: هل يريد VIP؟ ───────────────────────────────────────────
    if (session.state === "vip_question") {
      if (text === "vip_skip") {
        // لا يريد VIP → ملخص عادي
        await setSession(from, "parts", { ...session.data, vipTechId: null });
        await showSummary(from, { ...session, data: { ...session.data, vipTechId: null } }, lang);
        return;
      }
      if (text === "vip_yes") {
        // يريد VIP → عرض قائمة الفنيين VIP
        const vipTechs = await getVipTechs(session.data.service.id);
        if (!vipTechs.length) {
          await sendMessage(from, lang === "ar" ? "⚠️ لا يوجد فنيون VIP متاحون حالياً." : "⚠️ No VIP technicians available.");
          await showSummary(from, { ...session, data: { ...session.data, vipTechId: null } }, lang);
          return;
        }
        await setSession(from, "vip_list", session.data);
        await sendVipTechList(from, vipTechs, lang, session.data.baseTotal || 0);
        return;
      }
    }

    // ── vip_list: اختيار الفني VIP ────────────────────────────────────────────
    if (session.state === "vip_list") {
      if (text === "vip_skip") {
        await showSummary(from, { ...session, data: { ...session.data, vipTechId: null } }, lang);
        return;
      }
      if (text.startsWith("vip_")) {
        const techId   = text.replace("vip_", "");
        const techSnap = await db.collection("technicians").doc(techId).get();
        if (!techSnap.exists) { await sendMessage(from, L2.defaultMsg); return; }
        const tech = { id: techSnap.id, ...techSnap.data() };
        if (tech.active) {
          // الفني متاح → ملخص مع VIP
          const newData = { ...session.data, vipTechId: techId, vipTechName: tech.name, vipRate: 0.20 };
          await setSession(from, "confirm", newData);
          await showSummary(from, { ...session, data: newData }, lang);
        } else {
          // الفني مشغول → اسأل هل ينتظر؟
          await setSession(from, "vip_waiting", { ...session.data, vipTechId: techId, vipTechName: tech.name, vipRate: 0.20 });
          await sendMenu(from, L2.vipBusy(tech.name), L2.vipBtn, [
            { id: "vip_wait_yes", title: L2.vipWaitYes },
            { id: "vip_wait_no",  title: L2.vipWaitNo  }
          ]);
        }
        return;
      }
    }

    // ── vip_waiting: انتظار الفني VIP ────────────────────────────────────────
    if (session.state === "vip_waiting") {
      if (text === "vip_wait_no") {
        // لا ينتظر → ملخص عادي
        await showSummary(from, { ...session, data: { ...session.data, vipTechId: null } }, lang);
        return;
      }
      if (text === "vip_wait_yes") {
        // ينتظر → ملخص مع VIP وحالة waiting_vip
        const newData = { ...session.data };
        await setSession(from, "confirm", newData);
        await sendMessage(from, L2.vipWaiting(session.data.vipTechName || ""));
        await showSummary(from, { ...session, data: newData }, lang);
        return;
      }
    }

    // ── confirm ───────────────────────────────────────────────────────────────
    if (session.state === "confirm") {
      if (text === "cancel")       { await clearSession(from); await sendMessage(from, L2.cancelled); return; }
      if (text === "back_parts")   {
        await setSession(from, "parts", { ...session.data });
        await sendPartsMenu(from, session.data.service, session.data.parts||[], lang);
        return;
      }
      if (text === "confirm") { await setSession(from, "location", session.data); await sendMessage(from, L2.sendLocation); return; }
    }

    // ── location ──────────────────────────────────────────────────────────────
    if (session.state === "location") {
      if (msg.type !== "location") { await sendMessage(from, L2.locationOnly); return; }
      const { service, selectedType, parts } = session.data;
      if (!service) { await sendMessage(from, L2.sessionExp); await clearSession(from); return; }

      // ── التحقق من المنطقة المخدومة ──────────────────────────────────────────
      const userLat    = msg.location.latitude;
      const userLng    = msg.location.longitude;
      const region     = await getRegionForLocation(userLat, userLng);
      if (!region) {
        await sendMessage(from, L2.outOfZone);
        await clearSession(from); // ننهي الجلسة — أي رسالة بعدها تبدأ من جديد
        return;
      }
      // ────────────────────────────────────────────────────────────────────────

      // ── حماية من الطلبات المكررة ─────────────────────────────────────────────
      if (isLocked(from)) return;
      lockOrder(from);

      const partsTotal = (parts||[]).reduce((s,p) => s+p.total, 0);
      const laborPrice = selectedType ? selectedType.price : 0;
      const baseTotal  = Math.round((partsTotal + laborPrice)*100)/100;
      const vipTechId  = session.data.vipTechId  || null;
      const vipRate    = session.data.vipRate     || 0.20;
      const totalPrice = vipTechId ? applyVipRate(baseTotal, vipRate) : baseTotal;
      const orderId    = generateOrderId();
      const orderData  = {
        orderId, customer: from,
        serviceName: getServiceName(service, lang), serviceId: service.id,
        type:   selectedType ? (getTypeNameL(selectedType, lang) || "") : "",
        typeId: selectedType ? (selectedType.id || (selectedType.name && typeof selectedType.name === "object" ? selectedType.name.en || selectedType.name.ar : selectedType.name) || "") : "",
        laborPrice, partsTotal: Math.round(partsTotal*100)/100, totalPrice,
        vip: !!vipTechId, vipTechId, vipRate: vipTechId ? vipRate : null,
        parts: parts || [], status: "searching", lang,
        rejectedTechs: [],
        location: { latitude: userLat, longitude: userLng },
        region:   { id: region.id, name: region.name || "" },
        createdAt:        admin.firestore.FieldValue.serverTimestamp(),
        searchStartedAt:  admin.firestore.FieldValue.serverTimestamp()
      };
      await db.collection("orders").doc(orderId).set(orderData);
      await addOrderHistory(orderId, "searching", from, "Order created");
      await sendMessage(from, L2.orderSent(orderId));
      await clearSession(from);
      unlockOrder(from);

      // ── تحديث بيانات العميل ───────────────────────────────────────────────────
      await updateCustomerData(from, { latitude: userLat, longitude: userLng });
      await incrementCustomerOrders(from);

      await dispatchToTech(orderId, orderData);
      return;
    }

    // أي رسالة غير معروفة
    await sendMessage(from, L2.defaultMsg);

  } catch(err) {
    await logError("WEBHOOK", err, { from: req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from });
  }
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

  await ref.update({
    status:      "accepted",
    technicianId: tech.id,
    techPhone:   normalize(tech.phone),
    techName:    tech.name || "",
    acceptedAt:  admin.firestore.FieldValue.serverTimestamp()
  });
  await db.collection("technicians").doc(tech.id).update({ active: false });

  // تسجيل تاريخ الطلب
  await addOrderHistory(orderId, "accepted", tech.id, `Tech: ${tech.name}`);

  const customerPhone = normalize(order.customer);
  const CL2 = CUSTOMER_LANGS[order.lang||"ar"] || CUSTOMER_LANGS.ar;

  await sendMessage(techPhone, TL2.customerPhone(customerPhone));
  if (order.location) await sendLocation(techPhone, order.location.latitude, order.location.longitude);
  await sendButtons(techPhone, TL2.doneLabel(orderId), [
    { id: "done_" + orderId, title: TL2.doneRow }
  ]);
  await sendMessage(customerPhone, CL2.accepted(tech.name, tech.phone));

  // إشعار تأخر الفني بعد LATE_TECH_MINUTES
  setTimeout(async () => {
    try {
      const freshSnap = await ref.get();
      if (!freshSnap.exists) return;
      const fresh = freshSnap.data();
      if (fresh.status === "accepted") {
        // الطلب لم يُنجز بعد → أشعر العميل
        await sendButtons(normalize(order.customer),
          CL2.techLate(LATE_TECH_MINUTES),
          [
            { id: `keep_order_${orderId}`,          title: CL2.keepOrder },
            { id: `cancel_accepted_${orderId}`,      title: CL2.cancelAfterAccept }
          ]
        );
      }
    } catch(e) { await logError("late_tech_notify", e, { orderId }); }
  }, LATE_TECH_MINUTES * 60 * 1000);
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
  await addOrderHistory(orderId, "searching", tech.id, `Rejected by: ${tech.name}`);
  await sendMessage(techPhone, TL2.techRejected);

  const CL2 = CUSTOMER_LANGS[order.lang||"ar"] || CUSTOMER_LANGS.ar;
  await sendMessage(normalize(order.customer), CL2.rejected(order.orderId));
  await dispatchToTech(orderId, { ...order, rejectedTechs, status: "searching" });
}

async function handleDone(text, techPhone, tech) {
  const orderId = text.replace("done_", "");

  // ── حماية من الضغط المزدوج ────────────────────────────────────────────────
  if (isLocked(orderId)) return;
  lockOrder(orderId);

  const ref     = db.collection("orders").doc(orderId);
  const snap    = await ref.get();
  const TL2     = TECH_LANGS[getTLang(tech)] || TECH_LANGS.ar;
  if (!snap.exists) { unlockOrder(orderId); await sendMessage(techPhone, TL2.orderNotFound); return; }
  const order = snap.data();
  if (order.status === "done") { unlockOrder(orderId); await sendMessage(techPhone, TL2.alreadyDone); return; }

  await ref.update({ status: "done", completedAt: admin.firestore.FieldValue.serverTimestamp() });
  await addOrderHistory(orderId, "done", tech.id, `Commission: ${Math.round(order.totalPrice * COMMISSION * 100)/100}`);
  const techRef  = db.collection("technicians").doc(order.technicianId || tech.id);
  const techSnap = await techRef.get();
  const techData = techSnap.data();

  const commission = Math.round(order.totalPrice * COMMISSION * 100) / 100;
  const newBalance = Math.max(0, Math.round(((techData.balance||0) - commission)*100)/100);

  // ── تحديث إحصائيات الفني ──────────────────────────────────────────────────
  const prevStats       = techData.stats || {};
  const totalOrders     = (prevStats.totalOrders     || 0) + 1;
  const totalEarnings   = Math.round(((prevStats.totalEarnings   || 0) + order.totalPrice) * 100) / 100;
  const totalCommission = Math.round(((prevStats.totalCommission || 0) + commission)        * 100) / 100;

  await techRef.update({
    balance: newBalance,
    active:  true,
    stats: { totalOrders, totalEarnings, totalCommission, lastOrderAt: admin.firestore.FieldValue.serverTimestamp() }
  });

  // ── إرسال أول طلب منتظر للفني VIP (إن وجد) ──────────────────────────────
  try {
    const vipWaiting = await db.collection("orders")
      .where("vipTechId", "==", order.technicianId || tech.id)
      .where("status", "==", "waiting_vip")
      .limit(1).get();
    if (!vipWaiting.empty) {
      const waitDoc   = vipWaiting.docs[0];
      const waitOrder = { id: waitDoc.id, ...waitDoc.data() };
      const techFresh = (await techRef.get()).data();
      // تحقق أن الفني عنده رصيد كافٍ
      if ((techFresh.balance || 0) >= MIN_BALANCE) {
        await techRef.update({ active: false });
        await sendOrderToTech(waitDoc.id, waitOrder, { id: order.technicianId || tech.id, ...techFresh });
      }
    }
  } catch(e) { console.error("VIP waiting dispatch:", e.message); }

  // ── خصم المخزون لكل قطعة في الطلب ────────────────────────────────────────
  if (order.parts && order.parts.length > 0) {
    const batch = db.batch();
    // نجلب القطع من Firestore للتحقق من المخزون
    const partSnaps = await Promise.all(
      order.parts.map(p => db.collection("parts").doc(p.id).get())
    );
    partSnaps.forEach((pSnap, i) => {
      if (!pSnap.exists) return;
      const pData = pSnap.data();
      // نخصم فقط إذا المخزون محدود (ليس undefined/null)
      if (pData.stock !== undefined && pData.stock !== null) {
        const newStock = Math.max(0, pData.stock - order.parts[i].qty);
        batch.update(pSnap.ref, { stock: newStock });
      }
    });
    await batch.commit();
  }

  const CL2           = CUSTOMER_LANGS[order.lang||"ar"] || CUSTOMER_LANGS.ar;
  const customerPhone = normalize(order.customer);

  await sendMessage(customerPhone, CL2.completed(order.orderId));
  await sendMessage(techPhone, TL2.techDone(order.orderId, commission, newBalance));

  if (newBalance < MIN_BALANCE) await sendMessage(techPhone, TL2.lowBalance(newBalance, MIN_BALANCE));
  await sendRatingPrompt(customerPhone, orderId, order.lang || "ar");
  unlockOrder(orderId);
}

// ─── 3: Admin API — تعيين فني يدوياً من لوحة التحكم ─────────────────────────
app.post("/admin/assign", async (req, res) => {
  try {
    const { orderId, techId, adminKey } = req.body;
    if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: "Unauthorized" });
    if (!orderId || !techId) return res.status(400).json({ error: "orderId and techId required" });

    const orderRef  = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return res.status(404).json({ error: "Order not found" });
    const order = orderSnap.data();

    const techRef  = db.collection("technicians").doc(techId);
    const techSnap = await techRef.get();
    if (!techSnap.exists) return res.status(404).json({ error: "Tech not found" });
    const tech = techSnap.data();

    // تحديث الطلب
    const techPhone = normalize(tech.phone);
    await orderRef.update({ status: "pending", technicianId: techId, techPhone, assignedByAdmin: true });
    await techRef.update({ active: false });

    // إرسال الطلب للفني بلغته
    const TL2 = TECH_LANGS[tech.lang || "ar"] || TECH_LANGS.ar;
    const partsText = (order.parts||[]).map(p => `• ${p.name} x${p.qty} = ${p.total} OMR`).join("\n");
    await sendMessage(techPhone, TL2.newOrder(order.orderId, order.serviceName, order.type||"", partsText, order.laborPrice||0, order.totalPrice||0));
    if (order.location) await sendLocation(techPhone, order.location.latitude, order.location.longitude);
    await sendButtons(techPhone,
      tech.lang === "ar" ? "هل تقبل هذا الطلب؟ (تعيين من الإدارة)" : "Accept this order? (Admin assigned)",
      [
        { id: `accept_${orderId}`, title: TL2.acceptRow },
        { id: `reject_${orderId}`, title: TL2.rejectRow }
      ]
    );

    // إشعار العميل
    const CL2 = CUSTOMER_LANGS[order.lang||"ar"] || CUSTOMER_LANGS.ar;
    await sendMessage(normalize(order.customer), CL2.noTech.replace("30 دقيقة", "قريباً").replace("30 min", "soon"));

    res.json({ success: true, message: `Order ${orderId} assigned to tech ${techId}` });
  } catch(e) {
    console.error("Admin assign error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ─── Admin API — عرض إحصائيات فني ───────────────────────────────────────────
app.get("/admin/tech-stats/:techId", async (req, res) => {
  try {
    const { adminKey } = req.query;
    if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: "Unauthorized" });
    const snap = await db.collection("technicians").doc(req.params.techId).get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    const d = snap.data();
    res.json({
      name:            d.name,
      phone:           d.phone,
      balance:         d.balance || 0,
      active:          d.active,
      rating:          d.rating || 0,
      ratingCount:     d.ratingCount || 0,
      stats: {
        totalOrders:      d.stats?.totalOrders      || 0,
        totalEarnings:    d.stats?.totalEarnings     || 0,
        totalCommission:  d.stats?.totalCommission   || 0,
        lastOrderAt:      d.stats?.lastOrderAt       || null
      }
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Admin API — عرض إحصائيات جميع الفنيين ──────────────────────────────────
app.get("/admin/all-stats", async (req, res) => {
  try {
    const { adminKey } = req.query;
    if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: "Unauthorized" });
    const snap = await db.collection("technicians").get();
    const result = snap.docs.map(doc => {
      const d = doc.data();
      return {
        id:              doc.id,
        name:            d.name,
        phone:           d.phone,
        balance:         d.balance || 0,
        active:          d.active,
        rating:          d.rating || 0,
        ratingCount:     d.ratingCount || 0,
        totalOrders:     d.stats?.totalOrders     || 0,
        totalEarnings:   d.stats?.totalEarnings   || 0,
        totalCommission: d.stats?.totalCommission || 0,
      };
    });
    // ترتيب حسب عدد الطلبات
    result.sort((a, b) => b.totalOrders - a.totalOrders);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

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
  } catch(e) { await logError("Background_Search", e); }
}, 5 * 60 * 1000);

// ─── التقرير اليومي — يُرسل كل يوم الساعة 8 صباحاً ──────────────────────────
async function sendDailyReport() {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0,0,0,0);
    const today = new Date();
    today.setHours(0,0,0,0);

    const snap = await db.collection("orders")
      .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(yesterday))
      .where("createdAt", "<",  admin.firestore.Timestamp.fromDate(today))
      .get();

    const orders  = snap.docs.map(d => d.data());
    const done    = orders.filter(o => o.status === "done");
    const revenue = done.reduce((s,o) => s + (o.totalPrice||0), 0);
    const dateStr = yesterday.toLocaleDateString("ar-SA");

    const report = `📊 *التقرير اليومي — ${dateStr}*\n\n` +
      `📋 إجمالي الطلبات: *${orders.length}*\n` +
      `✅ مكتملة: *${done.length}*\n` +
      `❌ ملغاة: *${orders.filter(o=>o.status==="cancelled").length}*\n` +
      `⏳ في الانتظار: *${orders.filter(o=>o.status==="searching").length}*\n` +
      `💰 الإيراد: *${revenue.toFixed(2)} ر.ع*\n` +
      `💸 العمولات: *${Math.round(revenue*COMMISSION*100)/100} ر.ع*`;

    // إرسال لكل المدراء في adminUsers
    const admins = await db.collection("adminUsers").where("role","==","admin").get();
    for (const adm of admins.docs) {
      const phone = adm.data().phone;
      if (phone) await sendMessage(normalize(phone), report);
    }
    await logInfo("daily_report", `Sent to ${admins.size} admins`, { orders: orders.length, revenue });
  } catch(e) { await logError("daily_report", e); }
}

// جدولة التقرير كل 24 ساعة — يبدأ من أقرب الساعة 8 صباحاً
function scheduleDailyReport() {
  const now    = new Date();
  const next8  = new Date();
  next8.setHours(8, 0, 0, 0);
  if (now >= next8) next8.setDate(next8.getDate() + 1);
  const msUntil = next8.getTime() - now.getTime();
  setTimeout(() => {
    sendDailyReport();
    setInterval(sendDailyReport, 24 * 60 * 60 * 1000);
  }, msUntil);
}
scheduleDailyReport();

app.listen(process.env.PORT || 3000, () => console.log("✅ TAQA Server running"));
