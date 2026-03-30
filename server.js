const express     = require("express");
const axios       = require("axios");
const admin       = require("firebase-admin");
const { v4: uuidv4 } = require("uuid");
const PDFDocument = require("pdfkit");

const app = express();
app.use(express.json());

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY)) });
}
const db = admin.firestore();

const VERIFY_TOKEN    = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN  = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const normalize = (p) => String(p).replace(/\+/g, "");

// ─── Language ─────────────────────────────────────────────────────────────────
const LANGS = {
  ar: {
    welcome:        "أهلاً وسهلاً! اختر الخدمة المطلوبة 👇\n\nأو أرسل *حالة* لمتابعة طلب موجود",
    chooseService:  "الخدمات المتاحة",
    servicesBtn:    "الخدمات",
    chooseType:     "اختر النوع",
    typesBtn:       "الأنواع",
    chooseParts:    "اختر القطع المطلوبة (يمكنك اختيار أكثر من قطعة)",
    partsBtn:       "القطع",
    noParts:        "لا توجد قطع لهذه الخدمة، سيتم المتابعة بدون قطع.",
    partAdded:      (name, qty) => `✅ تمت إضافة: ${name} × ${qty}`,
    currentParts:   (list) => `🛒 القطع المختارة:\n${list}\n\nأرسل *تأكيد* للمتابعة أو اختر قطعة أخرى.`,
    noneSelected:   "لم تختر أي قطع. أرسل *تأكيد* للمتابعة بدون قطع أو اختر قطعة.",
    couponPrompt:   "🎟 هل لديك كوبون خصم؟ أرسله الآن أو أرسل *تخطي* للمتابعة.",
    couponValid:    (code, disc, total) => `✅ كوبون "${code}" مقبول!\n💸 الخصم: ${disc} OMR\n💰 الإجمالي بعد الخصم: ${total} OMR`,
    couponInvalid:  "❌ الكوبون غير صالح أو منتهي الصلاحية. أرسل *تخطي* للمتابعة.",
    couponUsed:     "❌ هذا الكوبون تم استخدامه مسبقاً.",
    confirmTitle:   (sName, tName, parts, total, disc) =>
      `📋 ملخص الطلب\n🔧 الخدمة: ${sName}\n📌 النوع: ${tName}\n\n${parts}${disc ? `\n🎟 خصم: -${disc} OMR` : ""}\n\n💰 الإجمالي: ${total} OMR`,
    confirmBtn:     "الإجراء",
    confirmRow:     "تأكيد الطلب",
    cancelRow:      "إلغاء",
    cancelled:      "تم إلغاء الطلب. أرسل *مرحبا* للبدء من جديد.",
    sendLocation:   "📍 أرسل موقعك الحالي لإتمام الطلب.",
    locationOnly:   "يرجى إرسال موقعك باستخدام ميزة الموقع في واتساب.",
    sessionExpired: "انتهت الجلسة. أرسل *مرحبا* للبدء.",
    noTech:         "⚠️ لا يوجد فني متاح الآن. حاول مرة أخرى لاحقاً.",
    orderSent:      (id) => `✅ تم إرسال طلبك!\n🆔 رقم الطلب: ${id}\nسيتم إشعارك عند قبول الطلب.\n📄 سيصلك الفاتورة قريباً.\n\nلمتابعة طلبك أرسل: *حالة ${id}*`,
    activeOrder:    (id, sName, status) => `لديك طلب نشط:\n🆔 ${id}\n🔧 ${sName}\nالحالة: ${statusLabel(status, "ar")}`,
    serviceNotFound:"الخدمة غير موجودة. أرسل *مرحبا* للبدء.",
    typeError:      "خطأ. أرسل *مرحبا* للبدء من جديد.",
    defaultMsg:     "أرسل *مرحبا* للبدء.\nأو أرسل *حالة [رقم الطلب]* لمتابعة طلب.",
    techInfo:       (name, phone, rating, balance, active) =>
      `👤 الاسم: ${name}\n📞 الهاتف: ${phone}\n⭐ التقييم: ${rating || "لا يوجد"}\n💰 الرصيد: ${balance || 0} OMR\n🟢 الحالة: ${active ? "متاح" : "مشغول"}`,
    newOrder:       (id, sName, tName, parts, total) =>
      `🔔 طلب جديد!\n🆔 ${id}\n🔧 ${sName}\n📋 ${tName}\n\n${parts}\n\n💰 الإجمالي: ${total} OMR`,
    acceptOrder:    "هل تقبل هذا الطلب؟",
    acceptBtn:      "اختر",
    acceptRow:      "قبول الطلب",
    rejectRow:      "رفض الطلب",
    customerPhone:  (phone) => `📞 هاتف العميل: ${phone}`,
    orderDoneBtn:   "إنهاء",
    orderDoneRow:   "إنهاء الطلب",
    orderDoneLabel: (id) => `${id} - اضغط عند الإنهاء`,
    accepted:       (name, phone) => `✅ تم قبول طلبك!\n👨‍🔧 الفني: ${name}\n📞 ${phone}\nفي الطريق إليك.`,
    rejected:       (id) => `❌ عذراً، رفض الفني طلبك.\n🆔 ${id}\nجارٍ البحث عن فني آخر...`,
    noBackupTech:   (id) => `❌ لا يوجد فني متاح حالياً.\n🆔 ${id}\nأرسل *مرحبا* للمحاولة مجدداً.`,
    techRejected:   "تم رفض الطلب.",
    orderNotFound:  "الطلب غير موجود.",
    alreadyProcessed:"الطلب تمت معالجته مسبقاً.",
    alreadyDone:    "الطلب مكتمل مسبقاً.",
    completed:      (id) => `✅ اكتمل طلبك!\n🆔 ${id}\nشكراً لثقتك بنا! 🙏`,
    techDone:       (id, fee, balance) => `✅ الطلب ${id} مكتمل.\n💸 العمولة: ${fee} OMR\n💰 رصيدك: ${balance} OMR`,
    ratePrompt:     "⭐ كيف تقيّم خدمة الفني؟",
    rateBtn:        "التقييم",
    ratingDone:     (stars) => `شكراً على تقييمك! منحت الفني ${stars} ⭐`,
    invoiceCaption: (id) => `📄 فاتورة الطلب رقم ${id}`,
    finalInvoice:   (id) => `📄 الفاتورة النهائية للطلب ${id}`,
    qtyPrompt:      (name) => `كم عدد قطع "${name}"؟\nأرسل رقماً (مثال: 2)`,
    invalidQty:     "يرجى إرسال رقم صحيح.",
    chooseMore:     "اختر قطعة أخرى أو أرسل *تأكيد* للمتابعة.",
    // Order tracking
    trackPrompt:    "🔍 أرسل رقم الطلب للاستعلام عن حالته.\nمثال: *حالة ORD-XXXXXXXX*",
    trackResult:    (o) =>
      `📋 تفاصيل الطلب\n🆔 ${o.orderId}\n🔧 ${o.serviceName}\n📌 ${o.type || ""}\n💰 ${o.totalPrice || o.price || 0} OMR\n📊 الحالة: ${statusLabel(o.status, "ar")}\n📅 ${o.createdAt ? new Date(o.createdAt.seconds*1000).toLocaleDateString("ar-OM") : "-"}`,
    trackNotFound:  "❌ لم يتم العثور على طلب بهذا الرقم.",
  },
  en: {
    welcome:        "Welcome! Choose a service 👇\n\nOr send *status* to track an existing order",
    chooseService:  "Available Services",
    servicesBtn:    "Services",
    chooseType:     "Choose Type",
    typesBtn:       "Types",
    chooseParts:    "Choose required parts (you can select multiple)",
    partsBtn:       "Parts",
    noParts:        "No parts available for this service. Continuing without parts.",
    partAdded:      (name, qty) => `✅ Added: ${name} × ${qty}`,
    currentParts:   (list) => `🛒 Selected parts:\n${list}\n\nSend *confirm* to proceed or choose another part.`,
    noneSelected:   "No parts selected. Send *confirm* to proceed without parts.",
    couponPrompt:   "🎟 Do you have a discount coupon? Send it now or send *skip* to continue.",
    couponValid:    (code, disc, total) => `✅ Coupon "${code}" applied!\n💸 Discount: ${disc} OMR\n💰 Total after discount: ${total} OMR`,
    couponInvalid:  "❌ Invalid or expired coupon. Send *skip* to continue.",
    couponUsed:     "❌ This coupon has already been used.",
    confirmTitle:   (sName, tName, parts, total, disc) =>
      `📋 Order Summary\n🔧 Service: ${sName}\n📌 Type: ${tName}\n\n${parts}${disc ? `\n🎟 Discount: -${disc} OMR` : ""}\n\n💰 Total: ${total} OMR`,
    confirmBtn:     "Action",
    confirmRow:     "Confirm Order",
    cancelRow:      "Cancel",
    cancelled:      "Order cancelled. Send *mrhba* to start again.",
    sendLocation:   "📍 Please send your location to complete the order.",
    locationOnly:   "Please send your location using WhatsApp location feature.",
    sessionExpired: "Session expired. Send *mrhba* to start.",
    noTech:         "⚠️ No technician available right now. Please try again later.",
    orderSent:      (id) => `✅ Order sent!\n🆔 Order ID: ${id}\nYou'll be notified when accepted.\n📄 Invoice will be sent shortly.\n\nTrack your order: *status ${id}*`,
    activeOrder:    (id, sName, status) => `Active order:\n🆔 ${id}\n🔧 ${sName}\nStatus: ${statusLabel(status, "en")}`,
    serviceNotFound:"Service not found. Send *mrhba* to start.",
    typeError:      "Error. Send *mrhba* to restart.",
    defaultMsg:     "Send *mrhba* to start.\nOr send *status [order ID]* to track an order.",
    techInfo:       (name, phone, rating, balance, active) =>
      `👤 Name: ${name}\n📞 Phone: ${phone}\n⭐ Rating: ${rating || "N/A"}\n💰 Balance: ${balance || 0} OMR\n🟢 Status: ${active ? "Available" : "Busy"}`,
    newOrder:       (id, sName, tName, parts, total) =>
      `🔔 New Order!\n🆔 ${id}\n🔧 ${sName}\n📋 ${tName}\n\n${parts}\n\n💰 Total: ${total} OMR`,
    acceptOrder:    "Do you accept this order?",
    acceptBtn:      "Choose",
    acceptRow:      "Accept Order",
    rejectRow:      "Reject Order",
    customerPhone:  (phone) => `📞 Customer phone: ${phone}`,
    orderDoneBtn:   "Finish",
    orderDoneRow:   "Mark as Done",
    orderDoneLabel: (id) => `${id} - Mark when finished`,
    accepted:       (name, phone) => `✅ Order accepted!\n👨‍🔧 Tech: ${name}\n📞 ${phone}\nOn the way!`,
    rejected:       (id) => `❌ Technician rejected your order.\n🆔 ${id}\nSearching for another technician...`,
    noBackupTech:   (id) => `❌ No technician available now.\n🆔 ${id}\nSend *mrhba* to try again.`,
    techRejected:   "Order rejected.",
    orderNotFound:  "Order not found.",
    alreadyProcessed:"Order already processed.",
    alreadyDone:    "Order already completed.",
    completed:      (id) => `✅ Order completed!\n🆔 ${id}\nThank you! 🙏`,
    techDone:       (id, fee, balance) => `✅ Order ${id} done.\n💸 Fee: ${fee} OMR\n💰 Balance: ${balance} OMR`,
    ratePrompt:     "⭐ How would you rate the technician's service?",
    rateBtn:        "Rate",
    ratingDone:     (stars) => `Thanks for your rating! You gave ${stars} ⭐`,
    invoiceCaption: (id) => `📄 Invoice for Order ${id}`,
    finalInvoice:   (id) => `📄 Final Invoice for Order ${id}`,
    qtyPrompt:      (name) => `How many "${name}"?\nSend a number (e.g. 2)`,
    invalidQty:     "Please send a valid number.",
    chooseMore:     "Choose another part or send *confirm* to proceed.",
    trackPrompt:    "🔍 Send your order ID to check its status.\nExample: *status ORD-XXXXXXXX*",
    trackResult:    (o) =>
      `📋 Order Details\n🆔 ${o.orderId}\n🔧 ${o.serviceName}\n📌 ${o.type || ""}\n💰 ${o.totalPrice || o.price || 0} OMR\n📊 Status: ${statusLabel(o.status, "en")}\n📅 ${o.createdAt ? new Date(o.createdAt.seconds*1000).toLocaleDateString("en-OM") : "-"}`,
    trackNotFound:  "❌ No order found with this ID.",
  }
};

function statusLabel(status, lang) {
  const labels = {
    ar: { pending:"قيد الانتظار", accepted:"مقبول", done:"مكتمل", rejected:"مرفوض" },
    en: { pending:"Pending", accepted:"Accepted", done:"Done", rejected:"Rejected" }
  };
  return (labels[lang]?.[status]) || status;
}
function getLang(session) { return session?.data?.lang || "ar"; }
function L(session)       { return LANGS[getLang(session)]; }

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
function generateOrderId() { return "ORD-" + uuidv4().split("-")[0].toUpperCase(); }

// ─── WhatsApp Senders ─────────────────────────────────────────────────────────
async function sendMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, text: { body: text } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch(e) { console.error("sendMessage:", e?.message); }
}

async function sendList(to, body, button, sections) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, type: "interactive",
        interactive: { type: "list", body: { text: body }, action: { button, sections } } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch(e) { console.error("sendList:", e?.message); }
}

async function sendLocation(to, lat, lng) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, type: "location", location: { latitude: lat, longitude: lng } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch(e) { console.error("sendLocation:", e?.message); }
}

async function sendDocument(to, pdfBuffer, filename, caption) {
  try {
    const FormData = require("form-data");
    const form = new FormData();
    form.append("file", pdfBuffer, { filename, contentType: "application/pdf" });
    form.append("messaging_product", "whatsapp");
    const uploadRes = await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/media`,
      form,
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, ...form.getHeaders() } }
    );
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, type: "document",
        document: { id: uploadRes.data.id, filename, caption } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch(e) { console.error("sendDocument:", e?.message); }
}

// ─── PDF Invoice ──────────────────────────────────────────────────────────────
function generateInvoicePDF(order, lang) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks = [];
    doc.on("data", d => chunks.push(d));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    const isAr = lang === "ar";

    doc.rect(0, 0, 595, 80).fill("#0a0e1a");
    doc.fillColor("#f59e0b").fontSize(28).font("Helvetica-Bold").text("TAQA", 40, 20);
    doc.fillColor("#ffffff").fontSize(11).font("Helvetica").text(isAr ? "فاتورة خدمة" : "Service Invoice", 40, 52);
    doc.fillColor("#64748b").text(new Date().toLocaleDateString(isAr ? "ar-OM" : "en-OM"), 400, 52, { align: "right" });

    doc.fillColor("#1a2235").rect(0, 82, 595, 70).fill();
    doc.fillColor("#f1f5f9").fontSize(10).font("Helvetica-Bold");
    doc.text(isAr ? "رقم الطلب" : "Order ID",   40, 100);
    doc.text(isAr ? "العميل"    : "Customer",    200, 100);
    doc.text(isAr ? "الخدمة"   : "Service",      360, 100);
    doc.fillColor("#f59e0b").fontSize(11).font("Helvetica");
    doc.text(order.orderId,     40,  118);
    doc.fillColor("#f1f5f9");
    doc.text(order.customer,    200, 118);
    doc.text(order.serviceName, 360, 118);

    let y = 170;
    doc.fillColor("#64748b").fontSize(9).font("Helvetica-Bold");
    doc.text(isAr ? "القطعة / الخدمة" : "Item",  40, y);
    doc.text(isAr ? "الكمية"          : "Qty",   340, y, { width:60, align:"center" });
    doc.text(isAr ? "السعر"           : "Price", 410, y, { width:80, align:"right" });
    doc.text(isAr ? "الإجمالي"        : "Total", 500, y, { width:55, align:"right" });
    y += 18;
    doc.rect(40, y, 515, 1).fill("#1e2d45"); y += 8;

    doc.fillColor("#f1f5f9").fontSize(10).font("Helvetica");
    doc.text(`${order.serviceName} — ${order.type || ""}`, 40, y, { width:280 });
    doc.text("1",                    340, y, { width:60,  align:"center" });
    doc.text(`${order.servicePrice||0}`, 410, y, { width:80, align:"right" });
    doc.text(`${order.servicePrice||0}`, 500, y, { width:55, align:"right" });
    y += 22;

    (order.parts || []).forEach(p => {
      const lt = (p.price * p.qty).toFixed(3);
      doc.text(p.name,          40,  y, { width:280 });
      doc.text(String(p.qty),  340,  y, { width:60,  align:"center" });
      doc.text(`${p.price}`,   410,  y, { width:80,  align:"right" });
      doc.text(lt,             500,  y, { width:55,  align:"right" });
      y += 20;
      if (y > 700) { doc.addPage(); y = 40; }
    });

    y += 10;
    doc.rect(40, y, 515, 1).fill("#1e2d45"); y += 12;
    const subtotal = (order.parts||[]).reduce((s,p)=>s+p.price*p.qty,0) + (order.servicePrice||0);
    const discount = order.discount || 0;
    const afterDisc = subtotal - discount;
    const vat   = Math.round(afterDisc * 0.05 * 1000) / 1000; // 5% VAT Oman
    const total = Math.round((afterDisc + vat) * 1000) / 1000;

    doc.fillColor("#64748b").fontSize(10);
    doc.text(isAr ? "المجموع" : "Subtotal", 350, y);
    doc.fillColor("#f1f5f9").text(`${subtotal.toFixed(3)} OMR`, 500, y, { width:55, align:"right" }); y+=18;
    if (discount > 0) {
      doc.fillColor("#10b981").text(isAr ? "خصم الكوبون" : "Coupon Discount", 350, y);
      doc.text(`-${discount.toFixed(3)} OMR`, 500, y, { width:55, align:"right" }); y+=18;
    }
    doc.fillColor("#64748b").text(isAr ? "ضريبة القيمة المضافة (5%)" : "VAT (5%)", 350, y);
    doc.fillColor("#f1f5f9").text(`${vat.toFixed(3)} OMR`, 500, y, { width:55, align:"right" }); y+=18;

    doc.fillColor("#f59e0b").rect(340, y, 215, 30).fill();
    doc.fillColor("#000").fontSize(12).font("Helvetica-Bold");
    doc.text(isAr ? "الإجمالي" : "Total", 355, y+8);
    doc.text(`${total.toFixed(3)} OMR`, 500, y+8, { width:55, align:"right" });
    y += 50;

    doc.fillColor("#1a2235").rect(40, y, 515, 36).fill();
    doc.fillColor("#64748b").fontSize(9).font("Helvetica");
    doc.text(
      isAr ? "شكراً لاستخدامكم خدمات طاقة. يرجى تقييم الخدمة عبر واتساب." :
             "Thank you for using TAQA services. Please rate us via WhatsApp.",
      50, y+12, { width:495, align:"center" }
    );
    doc.fillColor("#111827").rect(0, 780, 595, 60).fill();
    doc.fillColor("#64748b").fontSize(8).text("TAQA Services  |  Oman", 40, 800, { align:"center", width:515 });
    doc.end();
  });
}

// ─── Coupon System ────────────────────────────────────────────────────────────
async function validateCoupon(code, userId) {
  const snap = await db.collection("coupons").where("code", "==", code.toUpperCase()).limit(1).get();
  if (snap.empty) return { valid: false, reason: "invalid" };
  const doc  = snap.docs[0];
  const data = doc.data();
  if (!data.active) return { valid: false, reason: "invalid" };
  if (data.expiresAt && data.expiresAt.toDate() < new Date()) return { valid: false, reason: "invalid" };
  if (data.usedBy && data.usedBy.includes(userId)) return { valid: false, reason: "used" };
  if (data.maxUses && (data.useCount || 0) >= data.maxUses) return { valid: false, reason: "invalid" };
  return { valid: true, id: doc.id, discount: data.discount || 0, type: data.type || "fixed", code: data.code };
}

async function applyCoupon(couponId, userId) {
  const ref = db.collection("coupons").doc(couponId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d    = snap.data();
    tx.update(ref, {
      useCount: (d.useCount || 0) + 1,
      usedBy:   admin.firestore.FieldValue.arrayUnion(userId)
    });
  });
}

// ─── Parts ────────────────────────────────────────────────────────────────────
async function getPartsByService(serviceId) {
  const snap = await db.collection("parts").where("serviceId", "==", serviceId).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
function buildPartsText(parts) {
  if (!parts || !parts.length) return "-";
  return parts.map(p => `• ${p.name} × ${p.qty} = ${(p.price*p.qty).toFixed(3)} OMR`).join("\n");
}
function calcTotal(order) {
  const partsTotal = (order.parts||[]).reduce((s,p)=>s+p.price*p.qty, 0);
  return Math.round(((order.servicePrice||0) + partsTotal) * 1000) / 1000;
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────
async function getServices() {
  const snap = await db.collection("services").get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function getTechByPhone(phone) {
  const snap = await db.collection("technicians").where("phone", "==", normalize(phone)).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}
async function getAvailableTechs(serviceId) {
  const snap = await db.collection("technicians")
    .where("active", "==", true).where("services", "array-contains", serviceId).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function getActiveOrder(phone) {
  const snap = await db.collection("orders")
    .where("customer", "==", phone).where("status", "in", ["pending","accepted"]).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ─── Rating ───────────────────────────────────────────────────────────────────
async function updateTechRating(techId, stars) {
  const ref = db.collection("technicians").doc(techId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const d     = snap.data();
    const count = (d.ratingCount || 0) + 1;
    const avg   = Math.round((((d.rating||0)*(count-1))+stars)/count*10)/10;
    tx.update(ref, { rating: avg, ratingCount: count });
  });
}
async function sendRatingPrompt(to, orderId, lang) {
  const rows = [1,2,3,4,5].map(s => ({
    id: `rate_${orderId}_${s}`,
    title: "⭐".repeat(s),
    description: lang==="ar"
      ? ["ضعيف","مقبول","جيد","جيد جداً","ممتاز"][s-1]
      : ["Poor","Fair","Good","Very Good","Excellent"][s-1]
  }));
  await sendList(to, LANGS[lang].ratePrompt, LANGS[lang].rateBtn,
    [{ title: lang==="ar"?"اختر تقييمك":"Choose Rating", rows }]);
}

// ─── Order Tracking ───────────────────────────────────────────────────────────
async function handleOrderTracking(from, orderId, lang) {
  const Lx = LANGS[lang];
  const clean = orderId.toUpperCase().replace(/\s/g,"");
  const snap  = await db.collection("orders").doc(clean).get();
  if (!snap.exists) {
    // Try query by orderId field
    const q = await db.collection("orders").where("orderId","==",clean).limit(1).get();
    if (q.empty) { await sendMessage(from, Lx.trackNotFound); return; }
    await sendMessage(from, Lx.trackResult({ ...q.docs[0].data(), orderId: clean }));
    return;
  }
  await sendMessage(from, Lx.trackResult({ ...snap.data(), orderId: clean }));
}

// ─── Assign Tech to Order (with backup) ──────────────────────────────────────
async function assignTechToOrder(orderId, serviceId, excludeIds, lang) {
  const techs = await getAvailableTechs(serviceId);
  const available = techs.filter(t => !excludeIds.includes(t.id));
  if (!available.length) return null;
  // Pick best rated
  available.sort((a, b) => (b.rating||0) - (a.rating||0));
  return available[0];
}

// ─── Parts Menu ───────────────────────────────────────────────────────────────
async function sendPartsMenu(to, parts, Lx) {
  const rows = parts.slice(0, 10).map(p => ({
    id:    "part_" + p.id,
    title: p.name.substring(0, 24),
    description: `${p.price} OMR / ${p.unit || "قطعة"}`
  }));
  await sendList(to, Lx.chooseParts, Lx.partsBtn, [{ title: Lx.partsBtn, rows }]);
}

// ─── Webhook ──────────────────────────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) return res.send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const val = req.body.entry?.[0]?.changes?.[0]?.value;
    if (!val?.messages?.[0]) return;
    const msg  = val.messages[0];
    const from = normalize(msg.from);
    let text = "";
    if (msg.type === "text") text = msg.text.body.trim();
    else if (msg.type === "interactive")
      text = msg.interactive.list_reply?.id || msg.interactive.button_reply?.id || "";
    console.log("FROM:", from, "TEXT:", text);

    // ── Tech commands ────────────────────────────────────────────────────────
    const tech = await getTechByPhone(from);
    if (tech) {
      if (text.startsWith("accept_")) { await handleAccept(text, from, tech); return; }
      if (text.startsWith("reject_")) { await handleReject(text, from, tech); return; }
      if (text.startsWith("done_"))   { await handleDone(text, from, tech);   return; }
      await sendMessage(from, LANGS.ar.techInfo(tech.name, tech.phone,
        tech.rating ? `${tech.rating} (${tech.ratingCount||0})` : null, tech.balance, tech.active));
      return;
    }

    // ── Rating ───────────────────────────────────────────────────────────────
    if (text.startsWith("rate_")) {
      const parts   = text.split("_");
      const stars   = parseInt(parts[parts.length-1]);
      const orderId = parts.slice(1,-1).join("_");
      if (!isNaN(stars) && stars>=1 && stars<=5 && orderId) {
        const oSnap = await db.collection("orders").doc(orderId).get();
        if (oSnap.exists) {
          await updateTechRating(oSnap.data().technicianId, stars);
          await db.collection("orders").doc(orderId).update({ rating: stars });
        }
        const session  = await getSession(from);
        await sendMessage(from, LANGS[getLang(session)].ratingDone(stars));
      }
      return;
    }

    // ── Order Tracking: "حالة ORD-XXX" or "status ORD-XXX" ──────────────────
    const trackMatchAr = text.match(/^حالة\s+(.+)/i);
    const trackMatchEn = text.match(/^status\s+(.+)/i);
    if (trackMatchAr) { await handleOrderTracking(from, trackMatchAr[1], "ar"); return; }
    if (trackMatchEn) { await handleOrderTracking(from, trackMatchEn[1], "en"); return; }
    if (text === "حالة" || text.toLowerCase() === "status") {
      const session = await getSession(from);
      await sendMessage(from, LANGS[getLang(session)].trackPrompt);
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
      const activeLang  = lang || getLang(session) || "ar";
      const Lx          = LANGS[activeLang];
      const activeOrder = await getActiveOrder(from);
      if (activeOrder) { await sendMessage(from, Lx.activeOrder(activeOrder.orderId, activeOrder.serviceName, activeOrder.status)); return; }
      await clearSession(from);
      const services = await getServices();
      await sendList(from, Lx.welcome, Lx.servicesBtn, [{
        title: Lx.chooseService,
        rows: services.map(s => ({ id:"service_"+s.id, title:s.name.substring(0,24) }))
      }]);
      await setSession(from, "main", { lang: activeLang });
      return;
    }

    const Lx = L(session);

    // ── main: pick service ───────────────────────────────────────────────────
    if (session.state === "main" && text.startsWith("service_")) {
      const services = await getServices();
      const service  = services.find(s => s.id === text.replace("service_",""));
      if (!service) { await sendMessage(from, Lx.serviceNotFound); return; }
      await setSession(from, "type", { ...session.data, service });
      await sendList(from, `${service.name}\n${Lx.chooseType}`, Lx.typesBtn, [{
        title: Lx.chooseType,
        rows: service.types.map((t,i) => ({ id:"type_"+i, title:t.name.substring(0,24), description:`${t.price} OMR` }))
      }]);
      return;
    }

    // ── type: pick type ──────────────────────────────────────────────────────
    if (session.state === "type" && text.startsWith("type_")) {
      const index   = parseInt(text.replace("type_",""));
      const service = session.data?.service;
      if (!service || isNaN(index) || !service.types?.[index]) {
        await sendMessage(from, Lx.typeError); await clearSession(from); return;
      }
      const type  = service.types[index];
      const parts = await getPartsByService(service.id);
      if (!parts.length) {
        await setSession(from, "coupon", { ...session.data, selectedType:type, parts:[], servicePrice:type.price });
        await sendMessage(from, Lx.couponPrompt);
      } else {
        await setSession(from, "parts", { ...session.data, selectedType:type, parts:[], servicePrice:type.price, availableParts:parts });
        await sendMessage(from, Lx.chooseParts);
        await sendPartsMenu(from, parts, Lx);
      }
      return;
    }

    // ── parts: pick parts ────────────────────────────────────────────────────
    if (session.state === "parts") {
      const availableParts = session.data.availableParts || [];
      const selectedParts  = session.data.parts || [];
      const pendingPartId  = session.data.pendingPartId;

      if (pendingPartId) {
        const qty = parseInt(text);
        if (isNaN(qty) || qty < 1) { await sendMessage(from, Lx.invalidQty); return; }
        const part = availableParts.find(p => p.id === pendingPartId);
        if (part) {
          const ex = selectedParts.find(p => p.id === pendingPartId);
          if (ex) ex.qty += qty;
          else selectedParts.push({ id:part.id, name:part.name, price:part.price, unit:part.unit||"قطعة", qty });
          await sendMessage(from, Lx.partAdded(part.name, qty));
        }
        await setSession(from, "parts", { ...session.data, parts:selectedParts, pendingPartId:null });
        const cartText = selectedParts.length
          ? Lx.currentParts(selectedParts.map(p=>`• ${p.name} × ${p.qty} — ${(p.price*p.qty).toFixed(3)} OMR`).join("\n"))
          : Lx.noneSelected;
        await sendMessage(from, cartText);
        await sendPartsMenu(from, availableParts, Lx);
        return;
      }
      if (text === "تأكيد" || text.toLowerCase() === "confirm") {
        await setSession(from, "coupon", { ...session.data, parts:selectedParts });
        await sendMessage(from, Lx.couponPrompt);
        return;
      }
      if (text.startsWith("part_")) {
        const part = availableParts.find(p => p.id === text.replace("part_",""));
        if (part) { await setSession(from, "parts", { ...session.data, pendingPartId:part.id }); await sendMessage(from, Lx.qtyPrompt(part.name)); }
        return;
      }
      await sendMessage(from, Lx.chooseMore);
      return;
    }

    // ── coupon ───────────────────────────────────────────────────────────────
    if (session.state === "coupon") {
      const skipWords = ["تخطي","skip","لا","no","بدون"];
      if (skipWords.includes(text.toLowerCase())) {
        // No coupon — go to confirm
        await goToConfirm(from, session, Lx, 0, null);
        return;
      }
      // Try coupon
      const result = await validateCoupon(text, from);
      if (!result.valid) {
        if (result.reason === "used") await sendMessage(from, Lx.couponUsed);
        else await sendMessage(from, Lx.couponInvalid);
        return;
      }
      const rawTotal   = calcTotal({ servicePrice:session.data.servicePrice, parts:session.data.parts });
      const discount   = result.type === "percent"
        ? Math.round(rawTotal * result.discount / 100 * 1000) / 1000
        : result.discount;
      const finalTotal = Math.max(0, Math.round((rawTotal - discount) * 1000) / 1000);
      await sendMessage(from, Lx.couponValid(result.code, discount, finalTotal));
      await setSession(from, session.state, { ...session.data, couponId:result.id, couponCode:result.code, discount });
      await goToConfirm(from, { ...session, data:{ ...session.data, couponId:result.id, couponCode:result.code, discount } }, Lx, discount, result.code);
      return;
    }

    // ── confirm ──────────────────────────────────────────────────────────────
    if (session.state === "confirm") {
      if (text === "no")  { await clearSession(from); await sendMessage(from, Lx.cancelled); return; }
      if (text === "yes") { await setSession(from, "location", session.data); await sendMessage(from, Lx.sendLocation); return; }
    }

    // ── location ─────────────────────────────────────────────────────────────
    if (session.state === "location") {
      if (msg.type !== "location") { await sendMessage(from, Lx.locationOnly); return; }
      const service      = session.data?.service;
      const selectedType = session.data?.selectedType;
      const userLang     = getLang(session);
      if (!service || !selectedType) { await sendMessage(from, Lx.sessionExpired); await clearSession(from); return; }

      const techs = await getAvailableTechs(service.id);
      if (!techs.length) { await sendMessage(from, Lx.noTech); await clearSession(from); return; }
      techs.sort((a,b) => (b.rating||0)-(a.rating||0));
      const chosenTech = techs[0];

      const orderId     = generateOrderId();
      const parts       = session.data.parts || [];
      const rawTotal    = calcTotal({ servicePrice:session.data.servicePrice||selectedType.price, parts });
      const discount    = session.data.discount || 0;
      const totalPrice  = Math.max(0, Math.round((rawTotal-discount)*1000)/1000);
      const partsText   = buildPartsText(parts);

      await db.collection("orders").doc(orderId).set({
        orderId, customer: from,
        serviceName: service.name, serviceId: service.id,
        type: selectedType.name, servicePrice: session.data.servicePrice||selectedType.price,
        parts, totalPrice, discount,
        couponCode: session.data.couponCode || null,
        technicianId: chosenTech.id,
        rejectedTechs: [],
        status: "pending", lang: userLang,
        location: { latitude:msg.location.latitude, longitude:msg.location.longitude },
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Apply coupon usage
      if (session.data.couponId) await applyCoupon(session.data.couponId, from);

      // Notify tech
      const techPhone = normalize(chosenTech.phone);
      await sendMessage(techPhone, LANGS.ar.newOrder(orderId, service.name, selectedType.name, partsText, totalPrice));
      await sendList(techPhone, LANGS.ar.acceptOrder, LANGS.ar.acceptBtn, [{
        title:"Order", rows:[
          { id:"accept_"+orderId, title:LANGS.ar.acceptRow },
          { id:"reject_"+orderId, title:LANGS.ar.rejectRow }
        ]
      }]);

      await sendMessage(from, Lx.orderSent(orderId));
      const pdf = await generateInvoicePDF({ orderId, customer:from, serviceName:service.name, type:selectedType.name, servicePrice:session.data.servicePrice||selectedType.price, parts, discount }, userLang);
      await sendDocument(from, pdf, `invoice_${orderId}.pdf`, Lx.invoiceCaption(orderId));
      await clearSession(from);
      return;
    }

    await sendMessage(from, Lx.defaultMsg);
  } catch(err) { console.error("WEBHOOK ERROR:", err); }
});

// ─── goToConfirm helper ───────────────────────────────────────────────────────
async function goToConfirm(from, session, Lx, discount, couponCode) {
  const service = session.data.service;
  const type    = session.data.selectedType;
  const parts   = session.data.parts || [];
  const raw     = calcTotal({ servicePrice:session.data.servicePrice, parts });
  const total   = Math.max(0, Math.round((raw-discount)*1000)/1000);
  const partsTxt= parts.length ? parts.map(p=>`• ${p.name} × ${p.qty} = ${(p.price*p.qty).toFixed(3)} OMR`).join("\n") : "-";
  await setSession(from, "confirm", { ...session.data, discount, couponCode });
  await sendList(from,
    Lx.confirmTitle(service.name, type.name, partsTxt, total, discount > 0 ? discount : null),
    Lx.confirmBtn,
    [{ title:Lx.confirmBtn, rows:[{ id:"yes", title:Lx.confirmRow },{ id:"no", title:Lx.cancelRow }] }]
  );
}

// ─── Tech Handlers ────────────────────────────────────────────────────────────
async function handleAccept(text, techPhone, tech) {
  const orderId = text.replace("accept_","");
  const ref     = db.collection("orders").doc(orderId);
  const snap    = await ref.get();
  if (!snap.exists) { await sendMessage(techPhone, LANGS.ar.orderNotFound); return; }
  const order = snap.data();
  if (order.status !== "pending") { await sendMessage(techPhone, LANGS.ar.alreadyProcessed); return; }
  await ref.update({ status:"accepted" });
  await db.collection("technicians").doc(order.technicianId).update({ active:false });
  const customerPhone = normalize(order.customer);
  const CL = LANGS[order.lang||"ar"];
  await sendMessage(techPhone, LANGS.ar.customerPhone(customerPhone));
  if (order.location?.latitude) await sendLocation(techPhone, order.location.latitude, order.location.longitude);
  await sendList(techPhone, LANGS.ar.orderDoneLabel(orderId), LANGS.ar.orderDoneBtn, [{
    title:"Order", rows:[{ id:"done_"+orderId, title:LANGS.ar.orderDoneRow }]
  }]);
  await sendMessage(customerPhone, CL.accepted(tech.name, tech.phone));
}

async function handleReject(text, techPhone, tech) {
  const orderId = text.replace("reject_","");
  const ref     = db.collection("orders").doc(orderId);
  const snap    = await ref.get();
  if (!snap.exists) { await sendMessage(techPhone, LANGS.ar.orderNotFound); return; }
  const order = snap.data();
  if (order.status !== "pending") { await sendMessage(techPhone, LANGS.ar.alreadyProcessed); return; }

  await sendMessage(techPhone, LANGS.ar.techRejected);

  // ── Backup tech ──────────────────────────────────────────────────────────
  const rejectedList = [...(order.rejectedTechs||[]), order.technicianId];
  await ref.update({ status:"pending", rejectedTechs: rejectedList });

  const customerPhone = normalize(order.customer);
  const CL = LANGS[order.lang||"ar"];
  await sendMessage(customerPhone, CL.rejected(orderId));

  const backupTech = await assignTechToOrder(orderId, order.serviceId, rejectedList, order.lang||"ar");
  if (!backupTech) {
    await ref.update({ status:"rejected" });
    await sendMessage(customerPhone, CL.noBackupTech(orderId));
    return;
  }
  // Assign backup
  await ref.update({ technicianId: backupTech.id });
  const backupPhone = normalize(backupTech.phone);
  const partsText   = buildPartsText(order.parts);
  await sendMessage(backupPhone, LANGS.ar.newOrder(orderId, order.serviceName, order.type||"", partsText, order.totalPrice));
  await sendList(backupPhone, LANGS.ar.acceptOrder, LANGS.ar.acceptBtn, [{
    title:"Order", rows:[
      { id:"accept_"+orderId, title:LANGS.ar.acceptRow },
      { id:"reject_"+orderId, title:LANGS.ar.rejectRow }
    ]
  }]);
}

async function handleDone(text, techPhone, tech) {
  const orderId = text.replace("done_","");
  const ref     = db.collection("orders").doc(orderId);
  const snap    = await ref.get();
  if (!snap.exists) { await sendMessage(techPhone, LANGS.ar.orderNotFound); return; }
  const order = snap.data();
  if (order.status === "done") { await sendMessage(techPhone, LANGS.ar.alreadyDone); return; }

  await ref.update({ status:"done", completedAt:admin.firestore.FieldValue.serverTimestamp() });
  const techRef  = db.collection("technicians").doc(order.technicianId);
  const techData = (await techRef.get()).data();
  const fee      = Math.round(order.totalPrice * 0.2 * 1000) / 1000;
  const newBal   = Math.max(0, Math.round(((techData?.balance||0)-fee)*1000)/1000);
  await techRef.update({ balance:newBal, active:true });
  await sendMessage(techPhone, LANGS.ar.techDone(orderId, fee, newBal));

  const customerPhone = normalize(order.customer);
  const CL = LANGS[order.lang||"ar"];
  await sendMessage(customerPhone, CL.completed(orderId));
  const pdf = await generateInvoicePDF(order, order.lang||"ar");
  await sendDocument(customerPhone, pdf, `final_invoice_${orderId}.pdf`, CL.finalInvoice(orderId));
  await sendRatingPrompt(customerPhone, orderId, order.lang||"ar");
}

app.listen(process.env.PORT || 3000, () => console.log("✅ TAQA Bot running"));
