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
    welcome:        (svcs) => `أهلاً وسهلاً! 👋\nاختر الخدمة المطلوبة:\n\n${svcs.map((s,i)=>`${i+1}. ${s.name}`).join("\n")}\n\nأو أرسل رقم الخدمة أو *حالة* لمتابعة طلب.`,
    chooseType:     (sName, types) => `🔧 *${sName}*\nاختر نوع الخدمة:\n\n${types.map((t,i)=>`${i+1}. ${t.name} — ${t.price} OMR`).join("\n")}`,
    chooseParts:    "🔩 اختر القطع المطلوبة:\n(أرسل رقم القطعة، يمكنك اختيار أكثر من قطعة)",
    partsMenu:      (parts) => parts.map((p,i)=>`${i+1}. ${p.name} — ${p.price.toFixed(3)} OMR / ${p.unit||"قطعة"}`).join("\n"),
    partAdded:      (name, qty, total) => `✅ تمت إضافة: *${name}* × ${qty}\n\nإجمالي القطع حتى الآن: ${total.toFixed(3)} OMR\n\nأرسل رقم قطعة أخرى أو أرسل *0* للمتابعة.`,
    noneSelected:   "أرسل رقم قطعة أو أرسل *0* للمتابعة بدون قطع.",
    qtyPrompt:      (name, price) => `كم عدد قطع *${name}*؟\n(السعر: ${price.toFixed(3)} OMR للقطعة)\nأرسل الرقم:`,
    invalidInput:   "يرجى إرسال رقم صحيح.",
    couponPrompt:   "🎟 هل لديك كوبون خصم?\nأرسل الكود أو *0* للمتابعة بدون خصم.",
    couponValid:    (code, disc, total) => `✅ كوبون *${code}* مقبول!\n💸 الخصم: ${disc.toFixed(3)} OMR\n💰 الإجمالي بعد الخصم: ${total.toFixed(3)} OMR`,
    couponInvalid:  "❌ الكوبون غير صالح أو منتهي. أرسل *0* للمتابعة.",
    couponUsed:     "❌ هذا الكوبون استُخدم مسبقاً. أرسل *0* للمتابعة.",
    confirmTitle:   (sName, tName, parts, total, disc) =>
      `📋 *ملخص الطلب*\n🔧 الخدمة: ${sName}\n📌 النوع: ${tName}\n${parts !== "-" ? `\n🔩 القطع:\n${parts}` : ""}${disc ? `\n🎟 خصم: -${disc.toFixed(3)} OMR` : ""}\n\n💰 *الإجمالي: ${total.toFixed(3)} OMR*\n\nأرسل *1* للتأكيد أو *2* للإلغاء.`,
    confirmed:      "✅ تم التأكيد!\n📍 أرسل موقعك الحالي لإتمام الطلب.",
    cancelled:      "❌ تم إلغاء الطلب.\nأرسل *مرحبا* للبدء من جديد.",
    locationOnly:   "📍 يرجى إرسال موقعك باستخدام ميزة الموقع في واتساب.",
    sessionExpired: "انتهت الجلسة. أرسل *مرحبا* للبدء.",
    noTech:         "⚠️ لا يوجد فني متاح الآن. حاول لاحقاً.",
    noTechRegion:   (r) => `⚠️ لا يوجد فني متاح في *${r}* الآن. حاول لاحقاً.`,
    regionDetected: (r) => `📍 تم تحديد موقعك في: *${r}*`,
    orderSent:      (id) => `✅ *تم إرسال طلبك!*\n🆔 رقم الطلب: \`${id}\`\nسيتم إشعارك عند القبول.\n\n📄 ستصلك الفاتورة قريباً.\n\nلمتابعة طلبك أرسل:\n*حالة ${id}*`,
    activeOrder:    (id, sName, status) => `لديك طلب نشط:\n🆔 ${id}\n🔧 ${sName}\nالحالة: ${statusLabel(status,"ar")}`,
    defaultMsg:     "أرسل *مرحبا* للبدء.\nأو *حالة [رقم الطلب]* للمتابعة.",
    invalidService: (max) => `يرجى إرسال رقم بين 1 و ${max}.`,
    invalidType:    (max) => `يرجى إرسال رقم بين 1 و ${max}.`,
    techInfo:       (t) => `👤 الاسم: ${t.name}\n📞 الهاتف: ${t.phone}\n⭐ التقييم: ${t.rating?`${t.rating} (${t.ratingCount||0})`:"لا يوجد"}\n💰 الرصيد: ${t.balance||0} OMR\n🟢 الحالة: ${t.active?"متاح":"مشغول"}\n📍 المنطقة: ${t.region||"غير محدد"}`,
    newOrder:       (id, sName, tName, parts, total) => `🔔 *طلب جديد!*\n🆔 ${id}\n🔧 ${sName}\n📌 ${tName}${parts!=="-"?`\n\n🔩 القطع:\n${parts}`:""}\n\n💰 الإجمالي: ${total.toFixed(3)} OMR\n\nأرسل *1* للقبول أو *2* للرفض.`,
    acceptOrder:    "هل تقبل هذا الطلب؟\n1 — قبول\n2 — رفض",
    customerPhone:  (p) => `📞 هاتف العميل: ${p}`,
    orderDoneMsg:   (id) => `أرسل *done ${id}* عند الإنهاء.`,
    accepted:       (name, phone) => `✅ *تم قبول طلبك!*\n👨‍🔧 الفني: ${name}\n📞 ${phone}\nفي الطريق إليك! 🚗`,
    rejected:       (id) => `❌ رفض الفني طلبك.\n🆔 ${id}\nجارٍ البحث عن فني آخر...`,
    noBackupTech:   (id) => `❌ لا يوجد فني متاح حالياً.\n🆔 ${id}\nأرسل *مرحبا* للمحاولة مجدداً.`,
    techRejected:   "تم رفض الطلب.",
    orderNotFound:  "الطلب غير موجود.",
    alreadyProcessed:"الطلب تمت معالجته مسبقاً.",
    alreadyDone:    "الطلب مكتمل مسبقاً.",
    completed:      (id) => `✅ *اكتمل طلبك!*\n🆔 ${id}\nشكراً لثقتك بنا! 🙏`,
    techDone:       (id, fee, bal) => `✅ الطلب ${id} مكتمل.\n💸 العمولة: ${fee.toFixed(3)} OMR\n💰 رصيدك: ${bal.toFixed(3)} OMR`,
    ratePrompt:     (id) => `⭐ كيف تقيّم خدمة الفني؟\n\nأرسل رقم التقييم:\n1 — ⭐ ضعيف\n2 — ⭐⭐ مقبول\n3 — ⭐⭐⭐ جيد\n4 — ⭐⭐⭐⭐ جيد جداً\n5 — ⭐⭐⭐⭐⭐ ممتاز\n\n(أرسل *تقييم_${id}_[الرقم]*)\nمثال: تقييم_${id}_5`,
    ratingDone:     (stars) => `شكراً على تقييمك! منحت الفني ${"⭐".repeat(stars)}`,
    invoiceCaption: (id) => `📄 فاتورة الطلب رقم ${id}`,
    finalInvoice:   (id) => `📄 الفاتورة النهائية للطلب ${id}`,
    trackResult:    (o) => `📋 *تفاصيل الطلب*\n🆔 ${o.orderId}\n🔧 ${o.serviceName}\n📌 ${o.type||""}\n💰 ${(o.totalPrice||o.price||0).toFixed(3)} OMR\n📊 الحالة: ${statusLabel(o.status,"ar")}\n📍 المنطقة: ${o.region||"-"}\n📅 ${o.createdAt?new Date(o.createdAt.seconds*1000).toLocaleDateString("ar-OM"):"-"}`,
    trackNotFound:  "❌ لم يتم العثور على طلب بهذا الرقم.",
    trackPrompt:    "🔍 أرسل رقم الطلب:\nمثال: *حالة ORD-XXXXXXXX*",
  },
  en: {
    welcome:        (svcs) => `Welcome! 👋\nChoose a service:\n\n${svcs.map((s,i)=>`${i+1}. ${s.name}`).join("\n")}\n\nSend the number or *status* to track an order.`,
    chooseType:     (sName, types) => `🔧 *${sName}*\nChoose type:\n\n${types.map((t,i)=>`${i+1}. ${t.name} — ${t.price} OMR`).join("\n")}`,
    chooseParts:    "🔩 Choose required parts:\n(Send part number, you can choose multiple)",
    partsMenu:      (parts) => parts.map((p,i)=>`${i+1}. ${p.name} — ${p.price.toFixed(3)} OMR / ${p.unit||"piece"}`).join("\n"),
    partAdded:      (name, qty, total) => `✅ Added: *${name}* × ${qty}\n\nParts total: ${total.toFixed(3)} OMR\n\nSend another number or *0* to continue.`,
    noneSelected:   "Send a part number or *0* to continue without parts.",
    qtyPrompt:      (name, price) => `How many *${name}*?\n(Price: ${price.toFixed(3)} OMR each)\nSend number:`,
    invalidInput:   "Please send a valid number.",
    couponPrompt:   "🎟 Do you have a coupon?\nSend the code or *0* to continue without discount.",
    couponValid:    (code, disc, total) => `✅ Coupon *${code}* applied!\n💸 Discount: ${disc.toFixed(3)} OMR\n💰 Total after discount: ${total.toFixed(3)} OMR`,
    couponInvalid:  "❌ Invalid or expired coupon. Send *0* to continue.",
    couponUsed:     "❌ Coupon already used. Send *0* to continue.",
    confirmTitle:   (sName, tName, parts, total, disc) =>
      `📋 *Order Summary*\n🔧 Service: ${sName}\n📌 Type: ${tName}\n${parts!=="-"?`\n🔩 Parts:\n${parts}`:""}${disc?`\n🎟 Discount: -${disc.toFixed(3)} OMR`:""}\n\n💰 *Total: ${total.toFixed(3)} OMR*\n\nSend *1* to confirm or *2* to cancel.`,
    confirmed:      "✅ Confirmed!\n📍 Please send your location to complete the order.",
    cancelled:      "❌ Order cancelled.\nSend *mrhba* to start again.",
    locationOnly:   "📍 Please send your location using WhatsApp location feature.",
    sessionExpired: "Session expired. Send *mrhba* to start.",
    noTech:         "⚠️ No technician available now. Try again later.",
    noTechRegion:   (r) => `⚠️ No technician available in *${r}* now. Try later.`,
    regionDetected: (r) => `📍 Your location detected in: *${r}*`,
    orderSent:      (id) => `✅ *Order sent!*\n🆔 Order ID: \`${id}\`\nYou'll be notified when accepted.\n\n📄 Invoice will be sent shortly.\n\nTrack your order:\n*status ${id}*`,
    activeOrder:    (id, sName, status) => `Active order:\n🆔 ${id}\n🔧 ${sName}\nStatus: ${statusLabel(status,"en")}`,
    defaultMsg:     "Send *mrhba* to start.\nOr *status [order ID]* to track.",
    invalidService: (max) => `Please send a number between 1 and ${max}.`,
    invalidType:    (max) => `Please send a number between 1 and ${max}.`,
    techInfo:       (t) => `👤 Name: ${t.name}\n📞 Phone: ${t.phone}\n⭐ Rating: ${t.rating?`${t.rating} (${t.ratingCount||0})`:"N/A"}\n💰 Balance: ${t.balance||0} OMR\n🟢 Status: ${t.active?"Available":"Busy"}\n📍 Region: ${t.region||"N/A"}`,
    newOrder:       (id, sName, tName, parts, total) => `🔔 *New Order!*\n🆔 ${id}\n🔧 ${sName}\n📌 ${tName}${parts!=="-"?`\n\n🔩 Parts:\n${parts}`:""}\n\n💰 Total: ${total.toFixed(3)} OMR\n\nSend *1* to accept or *2* to reject.`,
    acceptOrder:    "Do you accept this order?\n1 — Accept\n2 — Reject",
    customerPhone:  (p) => `📞 Customer phone: ${p}`,
    orderDoneMsg:   (id) => `Send *done ${id}* when finished.`,
    accepted:       (name, phone) => `✅ *Order accepted!*\n👨‍🔧 Tech: ${name}\n📞 ${phone}\nOn the way! 🚗`,
    rejected:       (id) => `❌ Technician rejected your order.\n🆔 ${id}\nSearching for another...`,
    noBackupTech:   (id) => `❌ No technician available.\n🆔 ${id}\nSend *mrhba* to try again.`,
    techRejected:   "Order rejected.",
    orderNotFound:  "Order not found.",
    alreadyProcessed:"Order already processed.",
    alreadyDone:    "Order already completed.",
    completed:      (id) => `✅ *Order completed!*\n🆔 ${id}\nThank you! 🙏`,
    techDone:       (id, fee, bal) => `✅ Order ${id} done.\n💸 Fee: ${fee.toFixed(3)} OMR\n💰 Balance: ${bal.toFixed(3)} OMR`,
    ratePrompt:     (id) => `⭐ Rate the technician:\n\n1 — ⭐ Poor\n2 — ⭐⭐ Fair\n3 — ⭐⭐⭐ Good\n4 — ⭐⭐⭐⭐ Very Good\n5 — ⭐⭐⭐⭐⭐ Excellent\n\nSend: *rate_${id}_[number]*\nExample: rate_${id}_5`,
    ratingDone:     (stars) => `Thanks for rating! You gave ${"⭐".repeat(stars)}`,
    invoiceCaption: (id) => `📄 Invoice for Order ${id}`,
    finalInvoice:   (id) => `📄 Final Invoice for Order ${id}`,
    trackResult:    (o) => `📋 *Order Details*\n🆔 ${o.orderId}\n🔧 ${o.serviceName}\n📌 ${o.type||""}\n💰 ${(o.totalPrice||o.price||0).toFixed(3)} OMR\n📊 Status: ${statusLabel(o.status,"en")}\n📍 Region: ${o.region||"-"}\n📅 ${o.createdAt?new Date(o.createdAt.seconds*1000).toLocaleDateString("en-OM"):"-"}`,
    trackNotFound:  "❌ No order found with this ID.",
    trackPrompt:    "🔍 Send your order ID:\nExample: *status ORD-XXXXXXXX*",
  }
};

function statusLabel(s, l) {
  return ({ ar:{pending:"قيد الانتظار",accepted:"مقبول",done:"مكتمل",rejected:"مرفوض"}, en:{pending:"Pending",accepted:"Accepted",done:"Done",rejected:"Rejected"} }[l]||{})[s]||s;
}
function getLang(session) { return session?.data?.lang || "ar"; }
function L(session)       { return LANGS[getLang(session)]; }

// ─── Session ──────────────────────────────────────────────────────────────────
async function getSession(p) { const d = await db.collection("sessions").doc(p).get(); return d.exists ? d.data() : { state:null, data:{} }; }
async function setSession(p, state, data) { await db.collection("sessions").doc(p).set({ state, data: data||{} }); }
async function clearSession(p) { await db.collection("sessions").doc(p).delete(); }
function generateOrderId() { return "ORD-" + uuidv4().split("-")[0].toUpperCase(); }

// ─── WhatsApp: plain text only ────────────────────────────────────────────────
async function sendMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product:"whatsapp", to, text:{ body: text } },
      { headers:{ Authorization:`Bearer ${WHATSAPP_TOKEN}`, "Content-Type":"application/json" } }
    );
  } catch(e) { console.error("sendMsg:", e?.message); }
}

async function sendLocation(to, lat, lng) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product:"whatsapp", to, type:"location", location:{ latitude:lat, longitude:lng } },
      { headers:{ Authorization:`Bearer ${WHATSAPP_TOKEN}`, "Content-Type":"application/json" } }
    );
  } catch(e) { console.error("sendLoc:", e?.message); }
}

async function sendDocument(to, buf, filename, caption) {
  try {
    const FormData = require("form-data");
    const form = new FormData();
    form.append("file", buf, { filename, contentType:"application/pdf" });
    form.append("messaging_product", "whatsapp");
    const up = await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/media`,
      form, { headers:{ Authorization:`Bearer ${WHATSAPP_TOKEN}`, ...form.getHeaders() } }
    );
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product:"whatsapp", to, type:"document", document:{ id:up.data.id, filename, caption } },
      { headers:{ Authorization:`Bearer ${WHATSAPP_TOKEN}`, "Content-Type":"application/json" } }
    );
  } catch(e) { console.error("sendDoc:", e?.message); }
}

// ─── PDF Invoice ──────────────────────────────────────────────────────────────
function generateInvoicePDF(order, lang) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin:40, size:"A4" });
    const chunks = [];
    doc.on("data", d => chunks.push(d));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    const isAr = lang === "ar";

    doc.rect(0,0,595,80).fill("#0a0e1a");
    doc.fillColor("#f59e0b").fontSize(28).font("Helvetica-Bold").text("TAQA", 40, 20);
    doc.fillColor("#ffffff").fontSize(11).font("Helvetica").text(isAr?"فاتورة خدمة":"Service Invoice", 40, 52);
    doc.fillColor("#64748b").text(new Date().toLocaleDateString(isAr?"ar-OM":"en-OM"), 400, 52, { align:"right" });

    doc.fillColor("#1a2235").rect(0,82,595,70).fill();
    doc.fillColor("#f1f5f9").fontSize(10).font("Helvetica-Bold");
    doc.text(isAr?"رقم الطلب":"Order ID",  40, 100);
    doc.text(isAr?"العميل":"Customer",     200, 100);
    doc.text(isAr?"الخدمة":"Service",      360, 100);
    doc.fillColor("#f59e0b").fontSize(11).font("Helvetica");
    doc.text(order.orderId, 40, 118);
    doc.fillColor("#f1f5f9");
    doc.text(order.customer, 200, 118);
    doc.text(order.serviceName, 360, 118);

    let y = 170;
    doc.fillColor("#64748b").fontSize(9).font("Helvetica-Bold");
    doc.text(isAr?"القطعة / الخدمة":"Item",  40, y);
    doc.text(isAr?"الكمية":"Qty",            340, y, {width:60, align:"center"});
    doc.text(isAr?"السعر":"Price",           410, y, {width:80, align:"right"});
    doc.text(isAr?"الإجمالي":"Total",        500, y, {width:55, align:"right"});
    y += 18; doc.rect(40,y,515,1).fill("#1e2d45"); y += 8;

    doc.fillColor("#f1f5f9").fontSize(10).font("Helvetica");
    doc.text(`${order.serviceName} — ${order.type||""}`, 40, y, {width:280});
    doc.text("1", 340, y, {width:60, align:"center"});
    doc.text(`${order.servicePrice||0}`, 410, y, {width:80, align:"right"});
    doc.text(`${order.servicePrice||0}`, 500, y, {width:55, align:"right"});
    y += 22;

    (order.parts||[]).forEach(p => {
      const lt = (p.price * p.qty).toFixed(3);
      doc.text(p.name,         40,  y, {width:280});
      doc.text(String(p.qty), 340,  y, {width:60,  align:"center"});
      doc.text(`${p.price}`,  410,  y, {width:80,  align:"right"});
      doc.text(lt,            500,  y, {width:55,  align:"right"});
      y += 20; if (y > 700) { doc.addPage(); y = 40; }
    });

    y += 10; doc.rect(40,y,515,1).fill("#1e2d45"); y += 12;
    const sub  = (order.parts||[]).reduce((s,p)=>s+p.price*p.qty, 0) + (order.servicePrice||0);
    const disc = order.discount || 0;
    const after = sub - disc;
    const vat  = Math.round(after * 0.05 * 1000) / 1000;
    const total = Math.round((after + vat) * 1000) / 1000;

    doc.fillColor("#64748b").fontSize(10);
    doc.text(isAr?"المجموع":"Subtotal", 350, y);
    doc.fillColor("#f1f5f9").text(`${sub.toFixed(3)} OMR`, 500, y, {width:55, align:"right"}); y+=18;
    if (disc > 0) {
      doc.fillColor("#10b981").text(isAr?"خصم الكوبون":"Coupon", 350, y);
      doc.text(`-${disc.toFixed(3)} OMR`, 500, y, {width:55, align:"right"}); y+=18;
    }
    doc.fillColor("#64748b").text(isAr?"ضريبة 5%":"VAT 5%", 350, y);
    doc.fillColor("#f1f5f9").text(`${vat.toFixed(3)} OMR`, 500, y, {width:55, align:"right"}); y+=18;
    doc.fillColor("#f59e0b").rect(340,y,215,30).fill();
    doc.fillColor("#000").fontSize(12).font("Helvetica-Bold");
    doc.text(isAr?"الإجمالي":"Total", 355, y+8);
    doc.text(`${total.toFixed(3)} OMR`, 500, y+8, {width:55, align:"right"});
    y+=50;

    doc.fillColor("#1a2235").rect(40,y,515,36).fill();
    doc.fillColor("#64748b").fontSize(9).font("Helvetica");
    doc.text(isAr?"شكراً لاستخدامكم خدمات طاقة":"Thank you for using TAQA services", 50, y+12, {width:495, align:"center"});
    doc.fillColor("#111827").rect(0,780,595,60).fill();
    doc.fillColor("#64748b").fontSize(8).text("TAQA Services | Oman", 40, 800, {align:"center", width:515});
    doc.end();
  });
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────
async function getServices() {
  const snap = await db.collection("services").get();
  return snap.docs.map(d => ({ id:d.id, ...d.data() }));
}
async function getTechByPhone(phone) {
  const snap = await db.collection("technicians").where("phone","==", normalize(phone)).get();
  if (snap.empty) return null;
  return { id:snap.docs[0].id, ...snap.docs[0].data() };
}
async function getAvailableTechsByRegion(serviceId, regionName, excludeIds=[]) {
  // Get ALL available techs for this service first
  const snap = await db.collection("technicians")
    .where("active","==",true).where("services","array-contains",serviceId).get();
  let techs = snap.docs.map(d=>({id:d.id,...d.data()})).filter(t=>!excludeIds.includes(t.id));

  // Prefer techs in same region using flexible matching (handles Arabic variations)
  if (regionName && techs.length > 1) {
    const norm = s => (s||"").toLowerCase().replace(/\s+/g,"").replace(/ة/g,"ه").replace(/ى/g,"ي");
    const rNorm = norm(regionName);
    const regional = techs.filter(t => {
      const tNorm = norm(t.region||"");
      return tNorm && (tNorm.includes(rNorm) || rNorm.includes(tNorm));
    });
    if (regional.length) techs = regional;
    // else fallback to all techs (already set)
  }

  techs.sort((a,b)=>(b.rating||0)-(a.rating||0));
  return techs;
}
async function getActiveOrder(phone) {
  const snap = await db.collection("orders")
    .where("customer","==",phone).where("status","in",["pending","accepted"]).limit(1).get();
  if (snap.empty) return null;
  return { id:snap.docs[0].id, ...snap.docs[0].data() };
}
async function getPartsByService(serviceId) {
  const snap = await db.collection("parts").where("serviceId","==",serviceId).get();
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}
async function checkActiveCoupons() {
  try {
    const snap = await db.collection("coupons").where("active","==",true).limit(1).get();
    return !snap.empty;
  } catch(e) { return false; }
}

// ─── Region Detection ─────────────────────────────────────────────────────────
async function detectRegion(lat, lng) {
  try {
    const res = await axios.get(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ar`,
      { headers:{"User-Agent":"TAQA-Bot/1.0"}, timeout:5000 }
    );
    const addr = res.data.address || {};
    return addr.county || addr.state_district || addr.suburb || addr.city || addr.state || null;
  } catch(e) { return null; }
}

// ─── Coupon Validation ────────────────────────────────────────────────────────
async function validateCoupon(code, userId) {
  const snap = await db.collection("coupons").where("code","==",code.toUpperCase()).limit(1).get();
  if (snap.empty) return { valid:false, reason:"invalid" };
  const doc  = snap.docs[0];
  const data = doc.data();
  if (!data.active) return { valid:false, reason:"invalid" };
  if (data.expiresAt && data.expiresAt.toDate() < new Date()) return { valid:false, reason:"invalid" };
  if (data.usedBy && data.usedBy.includes(userId)) return { valid:false, reason:"used" };
  if (data.maxUses && (data.useCount||0) >= data.maxUses) return { valid:false, reason:"invalid" };
  return { valid:true, id:doc.id, discount:data.discount||0, type:data.type||"fixed", code:data.code };
}
async function applyCoupon(couponId, userId) {
  await db.runTransaction(async tx => {
    const ref  = db.collection("coupons").doc(couponId);
    const snap = await tx.get(ref);
    tx.update(ref, { useCount:(snap.data().useCount||0)+1, usedBy:admin.firestore.FieldValue.arrayUnion(userId) });
  });
}

// ─── Rating ───────────────────────────────────────────────────────────────────
async function updateTechRating(techId, stars) {
  await db.runTransaction(async tx => {
    const ref  = db.collection("technicians").doc(techId);
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const d     = snap.data();
    const count = (d.ratingCount||0)+1;
    const avg   = Math.round((((d.rating||0)*(count-1))+stars)/count*10)/10;
    tx.update(ref, { rating:avg, ratingCount:count });
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildPartsText(parts) {
  if (!parts || !parts.length) return "-";
  return parts.map(p=>`• ${p.name} × ${p.qty} = ${(p.price*p.qty).toFixed(3)} OMR`).join("\n");
}
function calcTotal(servicePrice, parts) {
  return Math.round(((servicePrice||0) + (parts||[]).reduce((s,p)=>s+p.price*p.qty,0))*1000)/1000;
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
    const text = (msg.type === "text" ? msg.text.body : "").trim();
    console.log("FROM:", from, "TEXT:", text);

    // ── Technician commands ──────────────────────────────────────────────────
    const tech = await getTechByPhone(from);
    if (tech) {
      await handleTechMessage(from, text, tech);
      return;
    }

    // ── Rating: تقييم_ORD-XXX_5 ─────────────────────────────────────────────
    const rateMatch = text.match(/^(تقييم|rate)_(.+)_([1-5])$/i);
    if (rateMatch) {
      const orderId = rateMatch[2];
      const stars   = parseInt(rateMatch[3]);
      const oSnap   = await db.collection("orders").doc(orderId).get();
      if (oSnap.exists && !oSnap.data().rating) {
        await updateTechRating(oSnap.data().technicianId, stars);
        await db.collection("orders").doc(orderId).update({ rating:stars });
        const session = await getSession(from);
        await sendMessage(from, LANGS[getLang(session)].ratingDone(stars));
      }
      return;
    }

    // ── Order tracking ───────────────────────────────────────────────────────
    const trackAr = text.match(/^حالة\s+(.+)/i);
    const trackEn = text.match(/^status\s+(.+)/i);
    if (trackAr || trackEn) {
      const session = await getSession(from);
      const lang    = getLang(session);
      const orderId = (trackAr?.[1] || trackEn?.[1]).trim().toUpperCase();
      const oSnap   = await db.collection("orders").doc(orderId).get();
      if (!oSnap.exists) {
        const q = await db.collection("orders").where("orderId","==",orderId).limit(1).get();
        if (q.empty) { await sendMessage(from, LANGS[lang].trackNotFound); return; }
        await sendMessage(from, LANGS[lang].trackResult({...q.docs[0].data()})); return;
      }
      await sendMessage(from, LANGS[lang].trackResult({...oSnap.data()}));
      return;
    }
    if (text === "حالة" || text.toLowerCase() === "status") {
      const session = await getSession(from);
      await sendMessage(from, LANGS[getLang(session)].trackPrompt);
      return;
    }

    // ── Tech done command: "done ORD-XXX" ────────────────────────────────────
    const doneMatch = text.match(/^done\s+(ORD-\w+)/i);
    if (doneMatch) {
      const tech2 = await getTechByPhone(from);
      if (tech2) { await handleDone(doneMatch[1].toUpperCase(), from, tech2); }
      return;
    }

    // ── Session flow ─────────────────────────────────────────────────────────
    let session = await getSession(from);
    const isStartAr = ["مرحبا","هلا","مرحبً","ابدا","البداية"].includes(text);
    const isStartEn = ["mrhba","hello","hi","start"].includes(text.toLowerCase());
    const isStart   = isStartAr || isStartEn;
    const newLang   = isStartAr ? "ar" : isStartEn ? "en" : null;

    if (!session.state || isStart) {
      const activeLang  = newLang || getLang(session) || "ar";
      const Lx          = LANGS[activeLang];
      const activeOrder = await getActiveOrder(from);
      if (activeOrder) { await sendMessage(from, Lx.activeOrder(activeOrder.orderId, activeOrder.serviceName, activeOrder.status)); return; }
      await clearSession(from);
      const services = await getServices();
      await sendMessage(from, Lx.welcome(services));
      await setSession(from, "service", { lang:activeLang, services });
      return;
    }

    const Lx = L(session);

    // ── STATE: service ───────────────────────────────────────────────────────
    if (session.state === "service") {
      const services = session.data.services || await getServices();
      const num = parseInt(text);
      if (isNaN(num) || num < 1 || num > services.length) {
        await sendMessage(from, Lx.invalidService(services.length)); return;
      }
      const service = services[num-1];
      await setSession(from, "type", { ...session.data, service, services });
      await sendMessage(from, Lx.chooseType(service.name, service.types));
      return;
    }

    // ── STATE: type ──────────────────────────────────────────────────────────
    if (session.state === "type") {
      const service = session.data.service;
      const num     = parseInt(text);
      if (isNaN(num) || num < 1 || num > service.types.length) {
        await sendMessage(from, Lx.invalidType(service.types.length)); return;
      }
      const type  = service.types[num-1];
      const parts = await getPartsByService(service.id);
      if (!parts.length) {
        // No parts — check coupon then confirm
        await goNextAfterParts(from, { ...session.data, selectedType:type, parts:[], servicePrice:type.price }, Lx);
      } else {
        await setSession(from, "parts", { ...session.data, selectedType:type, parts:[], servicePrice:type.price, availableParts:parts });
        await sendMessage(from, Lx.chooseParts + "\n\n" + Lx.partsMenu(parts) + "\n\n0 — متابعة بدون قطع");
      }
      return;
    }

    // ── STATE: parts ─────────────────────────────────────────────────────────
    if (session.state === "parts") {
      const availableParts = session.data.availableParts || [];
      const selectedParts  = session.data.parts || [];
      const pendingPartIdx = session.data.pendingPartIdx;

      if (pendingPartIdx !== undefined) {
        // Waiting for quantity
        const qty = parseInt(text);
        if (isNaN(qty) || qty < 1) { await sendMessage(from, Lx.invalidInput); return; }
        const part = availableParts[pendingPartIdx];
        const ex   = selectedParts.find(p=>p.id===part.id);
        if (ex) ex.qty += qty; else selectedParts.push({ id:part.id, name:part.name, price:part.price, unit:part.unit||"قطعة", qty });
        const partsTotal = selectedParts.reduce((s,p)=>s+p.price*p.qty,0);
        await setSession(from, "parts", { ...session.data, parts:selectedParts, pendingPartIdx:undefined });
        await sendMessage(from, Lx.partAdded(part.name, qty, partsTotal));
        return;
      }

      if (text === "0") {
        // Done picking parts
        await goNextAfterParts(from, { ...session.data, parts:selectedParts }, Lx);
        return;
      }

      const num = parseInt(text);
      if (isNaN(num) || num < 1 || num > availableParts.length) {
        await sendMessage(from, Lx.noneSelected); return;
      }
      const part = availableParts[num-1];
      await setSession(from, "parts", { ...session.data, pendingPartIdx:num-1 });
      await sendMessage(from, Lx.qtyPrompt(part.name, part.price));
      return;
    }

    // ── STATE: coupon ────────────────────────────────────────────────────────
    if (session.state === "coupon") {
      if (text === "0") {
        await goToConfirm(from, session, Lx, 0, null);
        return;
      }
      const result = await validateCoupon(text, from);
      if (!result.valid) {
        await sendMessage(from, result.reason === "used" ? Lx.couponUsed : Lx.couponInvalid);
        return;
      }
      const raw   = calcTotal(session.data.servicePrice, session.data.parts);
      const disc  = result.type === "percent" ? Math.round(raw*result.discount/100*1000)/1000 : result.discount;
      const final = Math.max(0, Math.round((raw-disc)*1000)/1000);
      await sendMessage(from, Lx.couponValid(result.code, disc, final));
      await setSession(from, "coupon", { ...session.data, couponId:result.id, couponCode:result.code, discount:disc });
      await goToConfirm(from, { ...session, data:{ ...session.data, couponId:result.id, couponCode:result.code, discount:disc } }, Lx, disc, result.code);
      return;
    }

    // ── STATE: confirm ───────────────────────────────────────────────────────
    if (session.state === "confirm") {
      if (text === "2") { await clearSession(from); await sendMessage(from, Lx.cancelled); return; }
      if (text === "1") { await setSession(from, "location", session.data); await sendMessage(from, Lx.confirmed); return; }
      await sendMessage(from, "أرسل *1* للتأكيد أو *2* للإلغاء.");
      return;
    }

    // ── STATE: location ──────────────────────────────────────────────────────
    if (session.state === "location") {
      if (msg.type !== "location") { await sendMessage(from, Lx.locationOnly); return; }
      const service      = session.data.service;
      const selectedType = session.data.selectedType;
      const userLang     = getLang(session);
      if (!service || !selectedType) { await sendMessage(from, Lx.sessionExpired); await clearSession(from); return; }

      const regionName = await detectRegion(msg.location.latitude, msg.location.longitude);
      if (regionName) await sendMessage(from, Lx.regionDetected(regionName));

      const techs = await getAvailableTechsByRegion(service.id, regionName||"", []);
      if (!techs.length) {
        await sendMessage(from, regionName ? Lx.noTechRegion(regionName) : Lx.noTech);
        await clearSession(from); return;
      }
      const chosenTech = techs[0];
      const orderId    = generateOrderId();
      const parts      = session.data.parts || [];
      const rawTotal   = calcTotal(session.data.servicePrice||selectedType.price, parts);
      const discount   = session.data.discount || 0;
      const totalPrice = Math.max(0, Math.round((rawTotal-discount)*1000)/1000);
      const partsText  = buildPartsText(parts);

      await db.collection("orders").doc(orderId).set({
        orderId, customer:from,
        serviceName:service.name, serviceId:service.id,
        type:selectedType.name, servicePrice:session.data.servicePrice||selectedType.price,
        parts, totalPrice, discount,
        couponCode:session.data.couponCode||null,
        technicianId:chosenTech.id, rejectedTechs:[],
        status:"pending", lang:userLang, region:regionName||null,
        location:{ latitude:msg.location.latitude, longitude:msg.location.longitude },
        createdAt:admin.firestore.FieldValue.serverTimestamp()
      });

      if (session.data.couponId) await applyCoupon(session.data.couponId, from);

      const techPhone = normalize(chosenTech.phone);
      await sendMessage(techPhone, LANGS.ar.newOrder(orderId, service.name, selectedType.name, partsText, totalPrice));
      await sendMessage(from, Lx.orderSent(orderId));

      // Send invoice PDF
      const pdf = await generateInvoicePDF({ orderId, customer:from, serviceName:service.name, type:selectedType.name, servicePrice:session.data.servicePrice||selectedType.price, parts, discount }, userLang);
      await sendDocument(from, pdf, `invoice_${orderId}.pdf`, Lx.invoiceCaption(orderId));

      await clearSession(from);
      return;
    }

    await sendMessage(from, Lx.defaultMsg);
  } catch(err) { console.error("WEBHOOK ERROR:", err); }
});

// ─── Helper: go to coupon or confirm directly ─────────────────────────────────
async function goNextAfterParts(from, data, Lx) {
  const hasCoupons = await checkActiveCoupons();
  if (hasCoupons) {
    await setSession(from, "coupon", data);
    await sendMessage(from, Lx.couponPrompt);
  } else {
    await goToConfirm(from, { state:"coupon", data }, Lx, 0, null);
  }
}

async function goToConfirm(from, session, Lx, discount, couponCode) {
  const service  = session.data.service;
  const type     = session.data.selectedType;
  const parts    = session.data.parts || [];
  const raw      = calcTotal(session.data.servicePrice, parts);
  const total    = Math.max(0, Math.round((raw-(discount||0))*1000)/1000);
  const partsTxt = buildPartsText(parts);
  await setSession(from, "confirm", { ...session.data, discount:discount||0, couponCode });
  await sendMessage(from, Lx.confirmTitle(service.name, type.name, partsTxt, total, discount > 0 ? discount : null));
}

// ─── Tech Message Handler ─────────────────────────────────────────────────────
async function handleTechMessage(techPhone, text, tech) {
  // Accept: "1" when pending order assigned to tech
  // Reject: "2" when pending order assigned to tech
  // Done:   "done ORD-XXX"

  // Find pending order for this tech
  if (text === "1" || text === "2") {
    const snap = await db.collection("orders")
      .where("technicianId","==",tech.id).where("status","==","pending").limit(1).get();
    if (snap.empty) { await sendMessage(techPhone, LANGS.ar.orderNotFound); return; }
    const orderId = snap.docs[0].id;
    if (text === "1") await handleAccept(orderId, techPhone, tech);
    else              await handleReject(orderId, techPhone, tech);
    return;
  }

  const doneMatch = text.match(/^done\s+(ORD-\w+)/i);
  if (doneMatch) { await handleDone(doneMatch[1].toUpperCase(), techPhone, tech); return; }

  await sendMessage(techPhone, LANGS.ar.techInfo(tech));
}

async function handleAccept(orderId, techPhone, tech) {
  const ref  = db.collection("orders").doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) { await sendMessage(techPhone, LANGS.ar.orderNotFound); return; }
  const order = snap.data();
  if (order.status !== "pending") { await sendMessage(techPhone, LANGS.ar.alreadyProcessed); return; }

  await ref.update({ status:"accepted" });
  await db.collection("technicians").doc(order.technicianId).update({ active:false });

  const customerPhone = normalize(order.customer);
  const CL = LANGS[order.lang||"ar"];

  await sendMessage(techPhone, LANGS.ar.customerPhone(customerPhone));
  if (order.location?.latitude) await sendLocation(techPhone, order.location.latitude, order.location.longitude);
  await sendMessage(techPhone, LANGS.ar.orderDoneMsg(orderId));
  await sendMessage(customerPhone, CL.accepted(tech.name, tech.phone));
}

async function handleReject(orderId, techPhone, tech) {
  const ref  = db.collection("orders").doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) { await sendMessage(techPhone, LANGS.ar.orderNotFound); return; }
  const order = snap.data();
  if (order.status !== "pending") { await sendMessage(techPhone, LANGS.ar.alreadyProcessed); return; }

  await sendMessage(techPhone, LANGS.ar.techRejected);
  const rejected = [...(order.rejectedTechs||[]), order.technicianId];
  await ref.update({ status:"pending", rejectedTechs:rejected });

  const customerPhone = normalize(order.customer);
  const CL = LANGS[order.lang||"ar"];
  await sendMessage(customerPhone, CL.rejected(orderId));

  // Find backup tech
  const techs = await getAvailableTechsByRegion(order.serviceId, order.region||"", rejected);
  if (!techs.length) {
    await ref.update({ status:"rejected" });
    await sendMessage(customerPhone, CL.noBackupTech(orderId));
    return;
  }
  const backup = techs[0];
  await ref.update({ technicianId:backup.id });
  await sendMessage(normalize(backup.phone), LANGS.ar.newOrder(orderId, order.serviceName, order.type||"", buildPartsText(order.parts), order.totalPrice||0));
}

async function handleDone(orderId, techPhone, tech) {
  const ref  = db.collection("orders").doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) { await sendMessage(techPhone, LANGS.ar.orderNotFound); return; }
  const order = snap.data();
  if (order.status === "done") { await sendMessage(techPhone, LANGS.ar.alreadyDone); return; }

  await ref.update({ status:"done", completedAt:admin.firestore.FieldValue.serverTimestamp() });
  const techRef  = db.collection("technicians").doc(order.technicianId);
  const techData = (await techRef.get()).data();
  const fee      = Math.round((order.totalPrice||0)*0.2*1000)/1000;
  const newBal   = Math.max(0, Math.round(((techData?.balance||0)-fee)*1000)/1000);
  await techRef.update({ balance:newBal, active:true });

  await sendMessage(techPhone, LANGS.ar.techDone(orderId, fee, newBal));

  const customerPhone = normalize(order.customer);
  const CL = LANGS[order.lang||"ar"];
  await sendMessage(customerPhone, CL.completed(orderId));

  // Final invoice
  const pdf = await generateInvoicePDF(order, order.lang||"ar");
  await sendDocument(customerPhone, pdf, `final_invoice_${orderId}.pdf`, CL.finalInvoice(orderId));

  // Rating prompt
  await sendMessage(customerPhone, CL.ratePrompt(orderId));
}

app.listen(process.env.PORT || 3000, () => console.log("✅ TAQA Bot running"));
