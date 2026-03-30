const express  = require("express");
const axios    = require("axios");
const admin    = require("firebase-admin");
const { v4: uuidv4 } = require("uuid");
const PDFDocument = require("pdfkit");

const app = express();
app.use(express.json());

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY)) });
}
const db = admin.firestore();

const VERIFY_TOKEN   = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const normalize = (p) => String(p).replace(/\+/g, "");

// ─── Language ────────────────────────────────────────────────────────────────
const LANGS = {
  ar: {
    welcome:       "أهلاً وسهلاً! اختر الخدمة المطلوبة 👇",
    chooseService: "الخدمات المتاحة",
    servicesBtn:   "الخدمات",
    chooseType:    "اختر النوع",
    typesBtn:      "الأنواع",
    chooseParts:   "اختر القطع المطلوبة (يمكنك اختيار أكثر من قطعة)",
    partsBtn:      "القطع",
    noParts:       "لا توجد قطع لهذه الخدمة، سيتم المتابعة بدون قطع.",
    partAdded:     (name, qty) => `✅ تمت إضافة: ${name} × ${qty}`,
    currentParts:  (list) => `🛒 القطع المختارة:\n${list}\n\nأرسل *تأكيد* للمتابعة أو اختر قطعة أخرى.`,
    noneSelected:  "لم تختر أي قطع. أرسل *تأكيد* للمتابعة بدون قطع أو اختر قطعة.",
    confirmTitle:  (sName, tName, parts, total) =>
      `📋 ملخص الطلب\n🔧 الخدمة: ${sName}\n📌 النوع: ${tName}\n\n${parts}\n\n💰 الإجمالي: ${total} ريال عماني`,
    confirmBtn:    "الإجراء",
    confirmRow:    "تأكيد الطلب",
    cancelRow:     "إلغاء",
    cancelled:     "تم إلغاء الطلب. أرسل *مرحبا* للبدء من جديد.",
    sendLocation:  "📍 أرسل موقعك الحالي لإتمام الطلب.",
    locationOnly:  "يرجى إرسال موقعك باستخدام ميزة الموقع في واتساب.",
    sessionExpired:"انتهت الجلسة. أرسل *مرحبا* للبدء.",
    noTech:        "⚠️ لا يوجد فني متاح الآن. حاول مرة أخرى لاحقاً.",
    orderSent:     (id) => `✅ تم إرسال طلبك!\n🆔 رقم الطلب: ${id}\nسيتم إشعارك عند قبول الطلب.\n📄 سيصلك الفاتورة قريباً.`,
    activeOrder:   (id, sName, status) => `لديك طلب نشط:\n🆔 ${id}\n🔧 ${sName}\nالحالة: ${statusLabel(status, "ar")}`,
    serviceNotFound:"الخدمة غير موجودة. أرسل *مرحبا* للبدء.",
    typeError:     "خطأ. أرسل *مرحبا* للبدء من جديد.",
    defaultMsg:    "أرسل *مرحبا* للبدء.",
    techInfo:      (name, phone, rating, balance, active) =>
      `👤 الاسم: ${name}\n📞 الهاتف: ${phone}\n⭐ التقييم: ${rating || "لا يوجد"}\n💰 الرصيد: ${balance || 0} ريال عماني\n🟢 الحالة: ${active ? "متاح" : "مشغول"}`,
    newOrder:      (id, sName, tName, parts, total) =>
      `🔔 طلب جديد!\n🆔 ${id}\n🔧 ${sName}\n📋 ${tName}\n\n${parts}\n\n💰 الإجمالي: ${total} ريال عماني`,
    acceptOrder:   "هل تقبل هذا الطلب؟",
    acceptBtn:     "اختر",
    acceptRow:     "قبول الطلب",
    rejectRow:     "رفض الطلب",
    customerPhone: (phone) => `📞 هاتف العميل: ${phone}`,
    orderDoneBtn:  "إنهاء",
    orderDoneRow:  "إنهاء الطلب",
    orderDoneLabel:(id) => `${id} - اضغط عند الإنهاء`,
    accepted:      (name, phone) => `✅ تم قبول طلبك!\n👨‍🔧 الفني: ${name}\n📞 ${phone}\nفي الطريق إليك.`,
    rejected:      (id) => `❌ عذراً، رفض الفني طلبك.\n🆔 ${id}\nأرسل *مرحبا* للمحاولة مجدداً.`,
    techRejected:  "تم رفض الطلب.",
    orderNotFound: "الطلب غير موجود.",
    alreadyProcessed:"الطلب تمت معالجته مسبقاً.",
    alreadyDone:   "الطلب مكتمل مسبقاً.",
    completed:     (id) => `✅ اكتمل طلبك!\n🆔 ${id}\nشكراً لثقتك بنا! 🙏`,
    techDone:      (id, fee, balance) => `✅ الطلب ${id} مكتمل.\n💸 العمولة: ${fee} ريال عماني\n💰 رصيدك: ${balance} ريال عماني`,
    ratePrompt:    "⭐ كيف تقيّم خدمة الفني؟",
    rateBtn:       "التقييم",
    ratingDone:    (stars) => `شكراً على تقييمك! منحت الفني ${stars} ⭐`,
    invoiceCaption:(id) => `📄 فاتورة الطلب رقم ${id}`,
    finalInvoice:  (id) => `📄 الفاتورة النهائية للطلب ${id}`,
    qtyPrompt:     (name) => `كم عدد قطع "${name}"؟\nأرسل رقماً (مثال: 2)`,
    invalidQty:    "يرجى إرسال رقم صحيح.",
    chooseMore:    "اختر قطعة أخرى أو أرسل *تأكيد* للمتابعة.",
  },
  en: {
    welcome:       "Welcome! Please choose a service 👇",
    chooseService: "Available Services",
    servicesBtn:   "Services",
    chooseType:    "Choose Type",
    typesBtn:      "Types",
    chooseParts:   "Choose required parts (you can select multiple)",
    partsBtn:      "Parts",
    noParts:       "No parts available for this service. Continuing without parts.",
    partAdded:     (name, qty) => `✅ Added: ${name} × ${qty}`,
    currentParts:  (list) => `🛒 Selected parts:\n${list}\n\nSend *confirm* to proceed or choose another part.`,
    noneSelected:  "No parts selected. Send *confirm* to proceed without parts or choose a part.",
    confirmTitle:  (sName, tName, parts, total) =>
      `📋 Order Summary\n🔧 Service: ${sName}\n📌 Type: ${tName}\n\n${parts}\n\n💰 Total: ${total} OMR`,
    confirmBtn:    "Action",
    confirmRow:    "Confirm Order",
    cancelRow:     "Cancel",
    cancelled:     "Order cancelled. Send *mrhba* to start again.",
    sendLocation:  "📍 Please send your location to complete the order.",
    locationOnly:  "Please send your location using WhatsApp location feature.",
    sessionExpired:"Session expired. Send *mrhba* to start.",
    noTech:        "⚠️ No technician available right now. Please try again later.",
    orderSent:     (id) => `✅ Order sent!\n🆔 Order ID: ${id}\nYou'll be notified when accepted.\n📄 Invoice will be sent shortly.`,
    activeOrder:   (id, sName, status) => `Active order:\n🆔 ${id}\n🔧 ${sName}\nStatus: ${statusLabel(status, "en")}`,
    serviceNotFound:"Service not found. Send *mrhba* to start.",
    typeError:     "Error. Send *mrhba* to restart.",
    defaultMsg:    "Send *mrhba* to start.",
    techInfo:      (name, phone, rating, balance, active) =>
      `👤 Name: ${name}\n📞 Phone: ${phone}\n⭐ Rating: ${rating || "N/A"}\n💰 Balance: ${balance || 0} OMR\n🟢 Status: ${active ? "Available" : "Busy"}`,
    newOrder:      (id, sName, tName, parts, total) =>
      `🔔 New Order!\n🆔 ${id}\n🔧 ${sName}\n📋 ${tName}\n\n${parts}\n\n💰 Total: ${total} OMR`,
    acceptOrder:   "Do you accept this order?",
    acceptBtn:     "Choose",
    acceptRow:     "Accept Order",
    rejectRow:     "Reject Order",
    customerPhone: (phone) => `📞 Customer phone: ${phone}`,
    orderDoneBtn:  "Finish",
    orderDoneRow:  "Mark as Done",
    orderDoneLabel:(id) => `${id} - Mark when finished`,
    accepted:      (name, phone) => `✅ Order accepted!\n👨‍🔧 Tech: ${name}\n📞 ${phone}\nOn the way!`,
    rejected:      (id) => `❌ Sorry, the technician rejected your order.\n🆔 ${id}\nSend *mrhba* to try again.`,
    techRejected:  "Order rejected.",
    orderNotFound: "Order not found.",
    alreadyProcessed:"Order already processed.",
    alreadyDone:   "Order already completed.",
    completed:     (id) => `✅ Order completed!\n🆔 ${id}\nThank you! 🙏`,
    techDone:      (id, fee, balance) => `✅ Order ${id} done.\n💸 Fee: ${fee} OMR\n💰 Balance: ${balance} OMR`,
    ratePrompt:    "⭐ How would you rate the technician's service?",
    rateBtn:       "Rate",
    ratingDone:    (stars) => `Thanks for your rating! You gave ${stars} ⭐`,
    invoiceCaption:(id) => `📄 Invoice for Order ${id}`,
    finalInvoice:  (id) => `📄 Final Invoice for Order ${id}`,
    qtyPrompt:     (name) => `How many "${name}"?\nSend a number (e.g. 2)`,
    invalidQty:    "Please send a valid number.",
    chooseMore:    "Choose another part or send *confirm* to proceed.",
  }
};

function statusLabel(status, lang) {
  const labels = {
    ar: { pending:"قيد الانتظار", accepted:"مقبول", done:"مكتمل", rejected:"مرفوض" },
    en: { pending:"Pending", accepted:"Accepted", done:"Done", rejected:"Rejected" }
  };
  return (labels[lang] && labels[lang][status]) || status;
}
function getLang(session) { return (session && session.data && session.data.lang) || "ar"; }
function L(session)       { return LANGS[getLang(session)]; }

// ─── Session ─────────────────────────────────────────────────────────────────
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
function generateOrderId() { return "ORD-" + uuidv4().split("-")[0].toUpperCase(); }

// ─── WhatsApp Senders ────────────────────────────────────────────────────────
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
      { messaging_product: "whatsapp", to, type: "interactive",
        interactive: { type: "list", body: { text: body }, action: { button, sections } } },
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

async function sendDocument(to, pdfBuffer, filename, caption) {
  try {
    // Upload media first
    const FormData = require("form-data");
    const form = new FormData();
    form.append("file", pdfBuffer, { filename, contentType: "application/pdf" });
    form.append("messaging_product", "whatsapp");
    const uploadRes = await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/media`,
      form,
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, ...form.getHeaders() } }
    );
    const mediaId = uploadRes.data.id;
    // Send document
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, type: "document",
        document: { id: mediaId, filename, caption } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch(e) { console.error("sendDocument:", e && e.message); }
}

// ─── PDF Invoice Generator ───────────────────────────────────────────────────
function generateInvoicePDF(order, lang) {
  return new Promise((resolve) => {
    const doc    = new PDFDocument({ margin: 40, size: "A4" });
    const chunks = [];
    doc.on("data", d => chunks.push(d));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));

    const isAr = lang === "ar";

    // Header
    doc.rect(0, 0, 595, 80).fill("#0a0e1a");
    doc.fillColor("#f59e0b").fontSize(28).font("Helvetica-Bold").text("TAQA", 40, 20);
    doc.fillColor("#ffffff").fontSize(11).font("Helvetica").text(isAr ? "فاتورة خدمة" : "Service Invoice", 40, 52);
    doc.fillColor("#64748b").text(new Date().toLocaleDateString(isAr ? "ar-SA" : "en-US"), 400, 52, { align: "right" });

    // Order Info
    doc.fillColor("#0a0e1a").rect(0, 80, 595, 2).fill("#1e2d45");
    doc.fillColor("#1a2235").rect(0, 82, 595, 70).fill();
    doc.fillColor("#f1f5f9").fontSize(10).font("Helvetica-Bold");
    doc.text(isAr ? "رقم الطلب" : "Order ID",     40, 100);
    doc.text(isAr ? "العميل"    : "Customer",       200, 100);
    doc.text(isAr ? "الخدمة"   : "Service",         360, 100);
    doc.fillColor("#f59e0b").fontSize(11).font("Helvetica");
    doc.text(order.orderId,      40,  118);
    doc.fillColor("#f1f5f9");
    doc.text(order.customer,     200, 118);
    doc.text(order.serviceName,  360, 118);

    // Parts Table
    doc.fillColor("#0a0e1a").rect(0, 152, 595, 2).fill("#1e2d45");
    let y = 165;
    doc.fillColor("#64748b").fontSize(9).font("Helvetica-Bold");
    doc.text(isAr ? "القطعة / الخدمة" : "Item / Service", 40, y);
    doc.text(isAr ? "الكمية"          : "Qty",             340, y, { width: 60, align: "center" });
    doc.text(isAr ? "السعر"           : "Unit Price",       410, y, { width: 80, align: "right" });
    doc.text(isAr ? "الإجمالي"        : "Total",            500, y, { width: 55, align: "right" });
    y += 18;
    doc.rect(40, y, 515, 1).fill("#1e2d45"); y += 8;

    // Service line
    doc.fillColor("#f1f5f9").fontSize(10).font("Helvetica");
    doc.text(`${order.serviceName} — ${order.type || ""}`, 40, y, { width: 280 });
    doc.text("1",              340, y, { width: 60, align: "center" });
    doc.text(`${order.servicePrice || 0}`, 410, y, { width: 80, align: "right" });
    doc.text(`${order.servicePrice || 0}`, 500, y, { width: 55, align: "right" });
    y += 20;

    // Parts lines
    const parts = order.parts || [];
    parts.forEach(p => {
      const lineTotal = (p.price * p.qty).toFixed(2);
      doc.fillColor("#f1f5f9").text(p.name, 40, y, { width: 280 });
      doc.text(String(p.qty),   340, y, { width: 60, align: "center" });
      doc.text(`${p.price}`,    410, y, { width: 80, align: "right" });
      doc.text(lineTotal,       500, y, { width: 55, align: "right" });
      y += 20;
      if (y > 700) { doc.addPage(); y = 40; }
    });

    // Totals
    y += 10;
    doc.rect(40, y, 515, 1).fill("#1e2d45"); y += 12;
    const subtotal = parts.reduce((s, p) => s + p.price * p.qty, 0) + (order.servicePrice || 0);
    const vat      = Math.round(subtotal * 0.15 * 100) / 100;
    const total    = Math.round((subtotal + vat) * 100) / 100;

    doc.fillColor("#64748b").fontSize(10).font("Helvetica");
    doc.text(isAr ? "المجموع قبل الضريبة" : "Subtotal", 350, y);
    doc.fillColor("#f1f5f9").text(`${subtotal} OMR`, 500, y, { width: 55, align: "right" }); y += 18;
    doc.fillColor("#64748b").text(isAr ? "ضريبة القيمة المضافة (15%)" : "VAT (15%)", 350, y);
    doc.fillColor("#f1f5f9").text(`${vat} OMR`, 500, y, { width: 55, align: "right" }); y += 18;

    // Total box
    doc.fillColor("#f59e0b").rect(340, y, 215, 30).fill();
    doc.fillColor("#000000").fontSize(12).font("Helvetica-Bold");
    doc.text(isAr ? "الإجمالي" : "Total", 355, y + 8);
    doc.text(`${total} OMR`, 500, y + 8, { width: 55, align: "right" });
    y += 50;

    // Rating note
    doc.fillColor("#1a2235").rect(40, y, 515, 40).fill();
    doc.fillColor("#64748b").fontSize(9).font("Helvetica");
    doc.text(
      isAr ? "شكراً لاستخدامكم خدمات طاقة. يرجى تقييم الخدمة عبر واتساب." : "Thank you for using TAQA services. Please rate us via WhatsApp.",
      50, y + 13, { width: 495, align: "center" }
    );

    // Footer
    doc.fillColor("#0a0e1a").rect(0, 780, 595, 60).fill("#111827");
    doc.fillColor("#64748b").fontSize(8).text("TAQA Services  |  taqa-services.firebaseapp.com", 40, 800, { align: "center", width: 515 });

    doc.end();
  });
}

// ─── Parts helpers ────────────────────────────────────────────────────────────
async function getPartsByService(serviceId) {
  const snap = await db.collection("parts").where("serviceId", "==", serviceId).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function buildPartsText(selectedParts) {
  if (!selectedParts || !selectedParts.length) return "-";
  return selectedParts.map(p => `• ${p.name} × ${p.qty} = ${p.price * p.qty} ريال عماني`).join("\n");
}

function calcTotal(order) {
  const partsTotal = (order.parts || []).reduce((s, p) => s + p.price * p.qty, 0);
  return (order.servicePrice || 0) + partsTotal;
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
    .where("active", "==", true).where("services", "array-contains", serviceId).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}
async function getActiveOrder(phone) {
  const snap = await db.collection("orders")
    .where("customer", "==", phone).where("status", "in", ["pending","accepted"]).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ─── Rating ───────────────────────────────────────────────────────────────────
async function updateTechRating(techId, newStars) {
  const ref = db.collection("technicians").doc(techId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const d = snap.data();
    const count  = (d.ratingCount || 0) + 1;
    const newAvg = Math.round((((d.rating || 0) * (count - 1)) + newStars) / count * 10) / 10;
    tx.update(ref, { rating: newAvg, ratingCount: count });
  });
}

async function sendRatingPrompt(to, orderId, lang) {
  const rows = [1,2,3,4,5].map(s => ({
    id: `rate_${orderId}_${s}`,
    title: "⭐".repeat(s),
    description: lang === "ar"
      ? ["ضعيف","مقبول","جيد","جيد جداً","ممتاز"][s-1]
      : ["Poor","Fair","Good","Very Good","Excellent"][s-1]
  }));
  await sendList(to, LANGS[lang].ratePrompt, LANGS[lang].rateBtn, [{ title: lang === "ar" ? "اختر تقييمك" : "Choose Rating", rows }]);
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

    // ── Technician commands ──────────────────────────────────────────────────
    const tech = await getTechByPhone(from);
    if (tech) {
      if (text.startsWith("accept_")) { await handleAccept(text, from, tech); return; }
      if (text.startsWith("reject_")) { await handleReject(text, from); return; }
      if (text.startsWith("done_"))   { await handleDone(text, from, tech); return; }
      await sendMessage(from, LANGS.ar.techInfo(tech.name, tech.phone, tech.rating ? `${tech.rating} (${tech.ratingCount || 0})` : null, tech.balance, tech.active));
      return;
    }

    // ── Rating handler ───────────────────────────────────────────────────────
    if (text.startsWith("rate_")) {
      const parts   = text.split("_");
      const stars   = parseInt(parts[parts.length - 1]);
      const orderId = parts.slice(1, -1).join("_");
      if (!isNaN(stars) && stars >= 1 && stars <= 5 && orderId) {
        const orderSnap = await db.collection("orders").doc(orderId).get();
        if (orderSnap.exists) {
          await updateTechRating(orderSnap.data().technicianId, stars);
          await db.collection("orders").doc(orderId).update({ rating: stars });
        }
        const session  = await getSession(from);
        const userLang = getLang(session);
        await sendMessage(from, LANGS[userLang].ratingDone(stars));
      }
      return;
    }

    // ── Session ──────────────────────────────────────────────────────────────
    let session = await getSession(from);
    const isStartAr = ["مرحبا","هلا","مرحبً"].includes(text);
    const isStartEn = ["mrhba","hello","hi"].includes(text.toLowerCase());
    const isStart   = isStartAr || isStartEn;
    const lang      = isStartAr ? "ar" : isStartEn ? "en" : null;

    // ── START ────────────────────────────────────────────────────────────────
    if (!session.state || isStart) {
      const activeLang = lang || getLang(session) || "ar";
      const Lx = LANGS[activeLang];
      const activeOrder = await getActiveOrder(from);
      if (activeOrder) {
        await sendMessage(from, Lx.activeOrder(activeOrder.orderId, activeOrder.serviceName, activeOrder.status));
        return;
      }
      await clearSession(from);
      const services = await getServices();
      await sendList(from, Lx.welcome, Lx.servicesBtn, [{
        title: Lx.chooseService,
        rows: services.map(s => ({ id: "service_" + s.id, title: s.name.substring(0, 24) }))
      }]);
      await setSession(from, "main", { lang: activeLang });
      return;
    }

    const Lx = L(session);

    // ── STATE: main — pick service ───────────────────────────────────────────
    if (session.state === "main" && text.startsWith("service_")) {
      const services = await getServices();
      const id       = text.replace("service_", "");
      const service  = services.find(s => s.id === id);
      if (!service) { await sendMessage(from, Lx.serviceNotFound); return; }
      await setSession(from, "type", { ...session.data, service });
      await sendList(from, `${service.name}\n${Lx.chooseType}`, Lx.typesBtn, [{
        title: Lx.chooseType,
        rows: service.types.map((t, i) => ({ id: "type_" + i, title: t.name.substring(0, 24), description: `${t.price} OMR` }))
      }]);
      return;
    }

    // ── STATE: type — pick type ───────────────────────────────────────────────
    if (session.state === "type" && text.startsWith("type_")) {
      const index   = parseInt(text.replace("type_", ""));
      const service = session.data?.service;
      if (!service || isNaN(index) || !service.types?.[index]) {
        await sendMessage(from, Lx.typeError); await clearSession(from); return;
      }
      const type  = service.types[index];
      const parts = await getPartsByService(service.id);

      if (!parts.length) {
        // No parts — skip to confirm
        await setSession(from, "confirm", { ...session.data, selectedType: type, parts: [], servicePrice: type.price });
        const total = type.price;
        const confirmText = Lx.confirmTitle(service.name, type.name, "-", total);
        await sendList(from, confirmText, Lx.confirmBtn, [{
          title: Lx.confirmBtn,
          rows: [{ id: "yes", title: Lx.confirmRow }, { id: "no", title: Lx.cancelRow }]
        }]);
        return;
      }

      // Has parts — go to parts selection
      await setSession(from, "parts", { ...session.data, selectedType: type, parts: [], servicePrice: type.price, availableParts: parts });
      await sendMessage(from, Lx.chooseParts);
      await sendPartsMenu(from, parts, Lx);
      return;
    }

    // ── STATE: parts — pick parts ─────────────────────────────────────────────
    if (session.state === "parts") {
      const availableParts  = session.data.availableParts || [];
      const selectedParts   = session.data.parts || [];
      const pendingPartId   = session.data.pendingPartId;

      // Waiting for quantity input
      if (pendingPartId) {
        const qty = parseInt(text);
        if (isNaN(qty) || qty < 1) { await sendMessage(from, Lx.invalidQty); return; }
        const part = availableParts.find(p => p.id === pendingPartId);
        if (part) {
          const existing = selectedParts.find(p => p.id === pendingPartId);
          if (existing) existing.qty += qty;
          else selectedParts.push({ id: part.id, name: part.name, price: part.price, unit: part.unit || "قطعة", qty });
          await sendMessage(from, Lx.partAdded(part.name, qty));
        }
        await setSession(from, "parts", { ...session.data, parts: selectedParts, pendingPartId: null });
        // Show current cart + menu
        const cartText = selectedParts.length
          ? Lx.currentParts(selectedParts.map(p => `• ${p.name} × ${p.qty} — ${p.price * p.qty} OMR`).join("\n"))
          : Lx.noneSelected;
        await sendMessage(from, cartText);
        await sendPartsMenu(from, availableParts, Lx);
        return;
      }

      // User sends "تأكيد" or "confirm" — proceed
      if (text === "تأكيد" || text.toLowerCase() === "confirm") {
        const service = session.data.service;
        const type    = session.data.selectedType;
        const total   = calcTotal({ servicePrice: session.data.servicePrice, parts: selectedParts });
        const partsText = selectedParts.length ? selectedParts.map(p => `• ${p.name} × ${p.qty} = ${p.price * p.qty} OMR`).join("\n") : "-";
        await setSession(from, "confirm", { ...session.data, parts: selectedParts });
        await sendList(from,
          Lx.confirmTitle(service.name, type.name, partsText, total),
          Lx.confirmBtn,
          [{ title: Lx.confirmBtn, rows: [{ id: "yes", title: Lx.confirmRow }, { id: "no", title: Lx.cancelRow }] }]
        );
        return;
      }

      // User picks a part
      if (text.startsWith("part_")) {
        const partId = text.replace("part_", "");
        const part   = availableParts.find(p => p.id === partId);
        if (part) {
          await setSession(from, "parts", { ...session.data, pendingPartId: partId });
          await sendMessage(from, Lx.qtyPrompt(part.name));
        }
        return;
      }

      await sendMessage(from, Lx.chooseMore);
      return;
    }

    // ── STATE: confirm ────────────────────────────────────────────────────────
    if (session.state === "confirm") {
      if (text === "no")  { await clearSession(from); await sendMessage(from, Lx.cancelled); return; }
      if (text === "yes") { await setSession(from, "location", session.data); await sendMessage(from, Lx.sendLocation); return; }
    }

    // ── STATE: location ───────────────────────────────────────────────────────
    if (session.state === "location") {
      if (msg.type !== "location") { await sendMessage(from, Lx.locationOnly); return; }
      const service      = session.data?.service;
      const selectedType = session.data?.selectedType;
      const userLang     = getLang(session);
      if (!service || !selectedType) { await sendMessage(from, Lx.sessionExpired); await clearSession(from); return; }

      const availableTech = await getAvailableTech(service.id);
      if (!availableTech) { await sendMessage(from, Lx.noTech); await clearSession(from); return; }

      const orderId    = generateOrderId();
      const parts      = session.data.parts || [];
      const total      = calcTotal({ servicePrice: session.data.servicePrice || selectedType.price, parts });
      const partsText  = buildPartsText(parts);

      await db.collection("orders").doc(orderId).set({
        orderId, customer: from,
        serviceName: service.name, serviceId: service.id,
        type: selectedType.name, servicePrice: session.data.servicePrice || selectedType.price,
        parts, totalPrice: total,
        technicianId: availableTech.id,
        status: "pending", lang: userLang,
        location: { latitude: msg.location.latitude, longitude: msg.location.longitude },
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Notify tech
      const techPhone = normalize(availableTech.phone);
      await sendMessage(techPhone, LANGS.ar.newOrder(orderId, service.name, selectedType.name, partsText, total));
      await sendList(techPhone, LANGS.ar.acceptOrder, LANGS.ar.acceptBtn, [{
        title: "Order",
        rows: [{ id: "accept_" + orderId, title: LANGS.ar.acceptRow }, { id: "reject_" + orderId, title: LANGS.ar.rejectRow }]
      }]);

      // Send confirmation + invoice to customer
      await sendMessage(from, Lx.orderSent(orderId));
      const pdfBuf = await generateInvoicePDF({
        orderId, customer: from, serviceName: service.name,
        type: selectedType.name, servicePrice: session.data.servicePrice || selectedType.price,
        parts, totalPrice: total
      }, userLang);
      await sendDocument(from, pdfBuf, `invoice_${orderId}.pdf`, Lx.invoiceCaption(orderId));

      await clearSession(from);
      return;
    }

    await sendMessage(from, Lx.defaultMsg);
  } catch(err) { console.error("WEBHOOK ERROR:", err); }
});

// ─── Parts Menu ───────────────────────────────────────────────────────────────
async function sendPartsMenu(to, parts, Lx) {
  const rows = parts.slice(0, 10).map(p => ({
    id:    "part_" + p.id,
    title: p.name.substring(0, 24),
    description: `${p.price} OMR / ${p.unit || "قطعة"}`
  }));
  await sendList(to, Lx.chooseParts, Lx.partsBtn, [{ title: Lx.partsBtn, rows }]);
}

// ─── Tech Handlers ────────────────────────────────────────────────────────────
async function handleAccept(text, techPhone, tech) {
  const orderId = text.replace("accept_", "");
  const ref     = db.collection("orders").doc(orderId);
  const snap    = await ref.get();
  if (!snap.exists) { await sendMessage(techPhone, LANGS.ar.orderNotFound); return; }
  const order = snap.data();
  if (order.status !== "pending") { await sendMessage(techPhone, LANGS.ar.alreadyProcessed); return; }
  await ref.update({ status: "accepted" });
  await db.collection("technicians").doc(order.technicianId).update({ active: false });

  const customerPhone = normalize(order.customer);
  const customerLang  = order.lang || "ar";

  await sendMessage(techPhone, LANGS.ar.customerPhone(customerPhone));
  if (order.location?.latitude) await sendLocation(techPhone, order.location.latitude, order.location.longitude);
  await sendList(techPhone, LANGS.ar.orderDoneLabel(orderId), LANGS.ar.orderDoneBtn, [{
    title: "Order", rows: [{ id: "done_" + orderId, title: LANGS.ar.orderDoneRow }]
  }]);
  await sendMessage(customerPhone, LANGS[customerLang].accepted(tech.name, tech.phone));
}

async function handleReject(text, techPhone) {
  const orderId = text.replace("reject_", "");
  const ref     = db.collection("orders").doc(orderId);
  const snap    = await ref.get();
  if (!snap.exists) { await sendMessage(techPhone, LANGS.ar.orderNotFound); return; }
  const order = snap.data();
  if (order.status !== "pending") { await sendMessage(techPhone, LANGS.ar.alreadyProcessed); return; }
  await ref.update({ status: "rejected" });
  await sendMessage(techPhone, LANGS.ar.techRejected);
  await sendMessage(normalize(order.customer), LANGS[order.lang || "ar"].rejected(orderId));
}

async function handleDone(text, techPhone, tech) {
  const orderId = text.replace("done_", "");
  const ref     = db.collection("orders").doc(orderId);
  const snap    = await ref.get();
  if (!snap.exists) { await sendMessage(techPhone, LANGS.ar.orderNotFound); return; }
  const order = snap.data();
  if (order.status === "done") { await sendMessage(techPhone, LANGS.ar.alreadyDone); return; }

  await ref.update({ status: "done", completedAt: admin.firestore.FieldValue.serverTimestamp() });

  const techRef  = db.collection("technicians").doc(order.technicianId);
  const techData = (await techRef.get()).data();
  const fee      = Math.round(order.totalPrice * 0.2 * 100) / 100;
  const newBal   = Math.max(0, ((techData?.balance) || 0) - fee);
  await techRef.update({ balance: newBal, active: true });

  await sendMessage(techPhone, LANGS.ar.techDone(orderId, fee, newBal));

  const customerPhone = normalize(order.customer);
  const customerLang  = order.lang || "ar";
  await sendMessage(customerPhone, LANGS[customerLang].completed(orderId));

  // Send final invoice
  const pdfBuf = await generateInvoicePDF(order, customerLang);
  await sendDocument(customerPhone, pdfBuf, `final_invoice_${orderId}.pdf`, LANGS[customerLang].finalInvoice(orderId));

  await sendRatingPrompt(customerPhone, orderId, customerLang);
}

app.listen(process.env.PORT || 3000, () => console.log("Server running"));
