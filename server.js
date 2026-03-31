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
    welcome:        "أهلاً وسهلاً بك في شركة رؤية طاقة للخدمات الهندسية! 👋\nاختر الخدمة المطلوبة:",
    chooseService:  "الخدمات المتاحة",
    servicesBtn:    "الخدمات",
    chooseType:     (name) => `🔧 *${name}*\nاختر نوع الخدمة:`,
    typesBtn:       "الأنواع",
    chooseParts:    "🔩 اختر القطع المطلوبة\n(أرسل رقم القطعة، يمكنك اختيار أكثر من قطعة):",
    partsMenu:      (parts) => parts.map((p,i)=>`${i+1}. ${p.name} — ${p.price.toFixed(3)} OMR / ${p.unit||"قطعة"}${p.stock!==undefined?` (متوفر: ${p.stock})`:""}`).join("\n") + "\n\n0 — متابعة بدون قطع",
    partAdded:      (name, qty, total) => `✅ تمت إضافة: *${name}* × ${qty}\nإجمالي القطع: ${total.toFixed(3)} OMR\n\nأرسل رقم قطعة أخرى أو *0* للمتابعة.`,
    qtyPrompt:      (name, price) => `كم عدد قطع *${name}*؟\n(${price.toFixed(3)} OMR للقطعة)\nأرسل الرقم:`,
    invalidInput:   "يرجى إرسال رقم صحيح.",
    invalidPart:    (max) => `يرجى إرسال رقم بين 0 و ${max}.`,
    outOfStock:     (name, stock) => `⚠️ عذراً، *${name}* متوفر ${stock} فقط. أرسل رقماً أقل أو 0 للمتابعة.`,
    couponPrompt:   "🎟 هل لديك كوبون خصم؟\nأرسل الكود أو *0* للمتابعة بدون خصم.",
    couponValid:    (code, disc, total) => `✅ كوبون *${code}* مقبول!\n💸 الخصم: ${disc.toFixed(3)} OMR\n💰 الإجمالي بعد الخصم: ${total.toFixed(3)} OMR`,
    couponInvalid:  "❌ الكوبون غير صالح أو منتهي.\nأرسل *0* للمتابعة.",
    couponUsed:     "❌ هذا الكوبون استُخدم مسبقاً.\nأرسل *0* للمتابعة.",
    confirmTitle:   (sName, tName, parts, servicePrice, partsTotal, disc, total) =>
      `📋 *ملخص الطلب*\n🔧 الخدمة: ${sName} — ${servicePrice.toFixed(3)} OMR\n📌 النوع: ${tName}${parts!=="-"?`\n\n🔩 القطع:\n${parts}\n💡 إجمالي القطع: ${partsTotal.toFixed(3)} OMR`:""}${disc?`\n\n🎟 الخصم: -${disc.toFixed(3)} OMR`:""}\n\n💰 *الإجمالي الكلي: ${total.toFixed(3)} OMR*`,
    confirmYes:     "✅ تأكيد الطلب",
    confirmNo:      "❌ إلغاء",
    confirmed:      "✅ تم التأكيد!\n📍 أرسل موقعك الحالي لإتمام الطلب.",
    cancelled:      "❌ تم إلغاء الطلب.\nأرسل *مرحبا* للبدء من جديد.",
    locationOnly:   "📍 يرجى إرسال موقعك باستخدام ميزة الموقع في واتساب.",
    sessionExpired: "انتهت الجلسة. أرسل *مرحبا* للبدء.",
    noTech:         "⚠️ لا يوجد فني متاح الآن. حاول لاحقاً.",
    noTechRegion:   (r) => `⚠️ لا يوجد فني متاح في *${r}* الآن.\n\n📝 تم حفظ طلبك في قائمة الانتظار وسيتم إشعارك فور توفر فني.\n🆔 رقم الطلب سيُرسَل إليك الآن.`,
    noTechAny:      "⚠️ لا يوجد فني متاح الآن.\n\n📝 تم حفظ طلبك في قائمة الانتظار وسيتم إشعارك فور توفر فني.",
    techAvailableNotify: (id, techName) => `✅ *تم العثور على فني لطلبك!*\n🆔 ${id}\n👨‍🔧 الفني: ${techName}\nسيتواصل معك قريباً.`,
    cancelPrompt:   (id) => `هل تريد إلغاء الطلب *${id}*؟\nأرسل سبب الإلغاء أو *لا* للعودة.`,
    cancelDone:     (id, reason) => `تم إلغاء طلبك\n🆔 ${id}\nالسبب: ${reason}\nشكراً لتواصلك معنا.`,
    cancelNo:       "تم الإبقاء على طلبك. أرسل *مرحبا* للعودة.",
    regionDetected: (r) => `📍 تم تحديد موقعك في: *${r}*`,
    orderSent:      (id) => `✅ *تم إرسال طلبك!*\n🆔 رقم الطلب: ${id}\nسيتم إشعارك عند القبول.\n📄 ستصلك الفاتورة قريباً.\n\nلمتابعة طلبك:\n*حالة ${id}*`,
    activeOrder:    (id, sName, status) => `لديك طلب نشط:\n🆔 ${id}\n🔧 ${sName}\nالحالة: ${statusLabel(status,"ar")}`,
    defaultMsg:     "أرسل *مرحبا* للبدء.\nأو *حالة [رقم الطلب]* للمتابعة.",
    techInfo:       (t) => `👤 الاسم: ${t.name}\n📞 الهاتف: ${t.phone}\n⭐ التقييم: ${t.rating?`${t.rating} (${t.ratingCount||0})`:"لا يوجد"}\n💰 الرصيد: ${(t.balance||0).toFixed(3)} OMR\n🟢 الحالة: ${t.active?"متاح":"مشغول"}\n📍 المنطقة: ${t.region||"غير محدد"}`,
    newOrder:       (id, sName, tName, parts, total) => `🔔 *طلب جديد!*\n🆔 ${id}\n🔧 ${sName}\n📌 ${tName}${parts!=="-"?`\n\n🔩 القطع:\n${parts}`:""}\n\n💰 الإجمالي: ${total.toFixed(3)} OMR`,
    acceptBtn:      "✅ قبول الطلب",
    rejectBtn:      "❌ رفض الطلب",
    customerPhone:  (p) => `📞 هاتف العميل: ${p}`,
    orderDoneBtn:   "✅ إنهاء الطلب",
    orderDoneLabel: (id) => `الطلب ${id} — اضغط عند الإنهاء`,
    accepted:       (name, phone) => `✅ *تم قبول طلبك!*\n👨‍🔧 الفني: ${name}\n📞 ${phone}\nفي الطريق إليك! 🚗`,
    rejected:       (id) => `❌ رفض الفني طلبك.\n🆔 ${id}\nجارٍ البحث عن فني آخر...`,
    noBackupTech:   (id) => `❌ لا يوجد فني متاح حالياً.\n🆔 ${id}\nأرسل *مرحبا* للمحاولة مجدداً.`,
    techRejected:   "تم رفض الطلب.",
    orderNotFound:  "الطلب غير موجود.",
    alreadyProcessed:"الطلب تمت معالجته مسبقاً.",
    alreadyDone:    "الطلب مكتمل مسبقاً.",
    completed:      (id) => `✅ *اكتمل طلبك!*\n🆔 ${id}\nشكراً لثقتك بنا! 🙏`,
    techDone:       (id, fee, bal) => `✅ الطلب ${id} مكتمل.\n💸 العمولة: ${fee.toFixed(3)} OMR\n💰 رصيدك: ${bal.toFixed(3)} OMR`,
    ratePrompt:     (id) => `⭐ *قيّم خدمة الفني*\nأرسل رقماً من 1 إلى 5:\n\n1 — ⭐ ضعيف\n2 — ⭐⭐ مقبول\n3 — ⭐⭐⭐ جيد\n4 — ⭐⭐⭐⭐ جيد جداً\n5 — ⭐⭐⭐⭐⭐ ممتاز`,
    ratingDone:     (s) => `شكراً على تقييمك! ${"⭐".repeat(s)}`,
    invoiceCaption: (id) => `📄 فاتورة الطلب ${id}`,
    finalInvoice:   (id) => `📄 الفاتورة النهائية للطلب ${id}`,
    waitingQueue:   (id) => `⏳ *تم تسجيل طلبك في قائمة الانتظار!*\n🆔 رقم الطلب: ${id}\n\nسيتم إشعارك فوراً عند توفر فني.\n\nلمتابعة طلبك:\n*حالة ${id}*`,
    techAvailable:  (id) => `✅ *تم توفر فني لطلبك!*\n🆔 ${id}\nجارٍ إرسال الطلب للفني...`,
    cancelPrompt:   (id) => `هل تريد إلغاء الطلب ${id}؟\nأرسل سبب الإلغاء أو أرسل *لا* للرجوع.`,
    cancelDone:     (id) => `✅ تم إلغاء الطلب ${id}.\nشكراً لك.`,
    cancelNo:       "تم الإبقاء على طلبك.",
    orderMenu:      (o) => `📋 *تفاصيل الطلب*\n🆔 ${o.orderId}\n🔧 ${o.serviceName}\n📌 ${o.type||""}\n💰 ${(o.totalPrice||0).toFixed(3)} OMR\n📊 الحالة: ${statusLabel(o.status,"ar")}\n📍 المنطقة: ${o.region||"-"}\n\nأرسل *إلغاء_${o.orderId}* لإلغاء الطلب.`,
    trackResult:    (o) => `📋 *تفاصيل الطلب*\n🆔 ${o.orderId}\n🔧 ${o.serviceName}\n📌 ${o.type||""}\n💰 ${(o.totalPrice||o.price||0).toFixed(3)} OMR\n📊 الحالة: ${statusLabel(o.status,"ar")}\n📍 المنطقة: ${o.region||"-"}\n📅 ${o.createdAt?new Date(o.createdAt.seconds*1000).toLocaleDateString("ar-OM"):"-"}`,
    trackNotFound:  "❌ لم يتم العثور على طلب بهذا الرقم.",
    trackPrompt:    "🔍 أرسل رقم الطلب:\nمثال: *حالة ORD-XXXXXXXX*",
  },
  en: {
    welcome:        "Welcome! 👋\nChoose a service:",
    chooseService:  "Available Services",
    servicesBtn:    "Services",
    chooseType:     (name) => `🔧 *${name}*\nChoose service type:`,
    typesBtn:       "Types",
    chooseParts:    "🔩 Choose required parts\n(Send part number, you can choose multiple):",
    partsMenu:      (parts) => parts.map((p,i)=>`${i+1}. ${p.name} — ${p.price.toFixed(3)} OMR / ${p.unit||"piece"}${p.stock!==undefined?` (available: ${p.stock})`:""}`).join("\n") + "\n\n0 — Continue without parts",
    partAdded:      (name, qty, total) => `✅ Added: *${name}* × ${qty}\nParts total: ${total.toFixed(3)} OMR\n\nSend another number or *0* to continue.`,
    qtyPrompt:      (name, price, stock) => `How many *${name}*?\n(${price.toFixed(3)} OMR each)${stock!==undefined?`\nAvailable: ${stock}`:""  }\nSend number:`,
    invalidInput:   "Please send a valid number.",
    invalidPart:    (max) => `Please send a number between 0 and ${max}.`,
    outOfStock:     (name, stock) => `⚠️ Sorry, only ${stock} *${name}* available. Send a smaller number or 0 to continue.`,
    couponPrompt:   "🎟 Do you have a coupon?\nSend the code or *0* to continue without discount.",
    couponValid:    (code, disc, total) => `✅ Coupon *${code}* applied!\n💸 Discount: ${disc.toFixed(3)} OMR\n💰 Total: ${total.toFixed(3)} OMR`,
    couponInvalid:  "❌ Invalid or expired coupon.\nSend *0* to continue.",
    couponUsed:     "❌ Coupon already used.\nSend *0* to continue.",
    confirmTitle:   (sName, tName, parts, servicePrice, partsTotal, disc, total) =>
      `📋 *Order Summary*\n🔧 Service: ${sName} — ${servicePrice.toFixed(3)} OMR\n📌 Type: ${tName}${parts!=="-"?`\n\n🔩 Parts:\n${parts}\n💡 Parts total: ${partsTotal.toFixed(3)} OMR`:""}${disc?`\n\n🎟 Discount: -${disc.toFixed(3)} OMR`:""}\n\n💰 *Grand Total: ${total.toFixed(3)} OMR*`,
    confirmYes:     "✅ Confirm Order",
    confirmNo:      "❌ Cancel",
    confirmed:      "✅ Confirmed!\n📍 Please send your location to complete the order.",
    cancelled:      "❌ Order cancelled.\nSend *mrhba* to start again.",
    locationOnly:   "📍 Please send your location using WhatsApp location feature.",
    sessionExpired: "Session expired. Send *mrhba* to start.",
    noTech:         "⚠️ No technician available now. Try again later.",
    noTechRegion:   (r) => `⚠️ No technician available in *${r}* now.\n\n📝 Your order has been saved in the waiting queue. You will be notified when a technician is available.`,
    noTechAny:      "⚠️ No technician available now.\n\n📝 Your order has been saved in the waiting queue. You will be notified when a technician is available.",
    techAvailableNotify: (id, techName) => `✅ *A technician has been found for your order!*\n🆔 ${id}\n👨‍🔧 Tech: ${techName}\nThey will contact you shortly.`,
    cancelPrompt:   (id) => `Do you want to cancel order *${id}*?\nSend the reason or *no* to go back.`,
    cancelDone:     (id, reason) => `Order cancelled\n🆔 ${id}\nReason: ${reason}\nThank you for contacting us.`,
    cancelNo:       "Your order is still active. Send *mrhba* to return.",
    regionDetected: (r) => `📍 Your location detected in: *${r}*`,
    orderSent:      (id) => `✅ *Order sent!*\n🆔 Order ID: ${id}\nYou'll be notified when accepted.\n📄 Invoice coming shortly.\n\nTrack order:\n*status ${id}*`,
    activeOrder:    (id, sName, status) => `Active order:\n🆔 ${id}\n🔧 ${sName}\nStatus: ${statusLabel(status,"en")}`,
    defaultMsg:     "Send *mrhba* to start.\nOr *status [order ID]* to track.",
    techInfo:       (t) => `👤 Name: ${t.name}\n📞 Phone: ${t.phone}\n⭐ Rating: ${t.rating?`${t.rating} (${t.ratingCount||0})`:"N/A"}\n💰 Balance: ${(t.balance||0).toFixed(3)} OMR\n🟢 Status: ${t.active?"Available":"Busy"}\n📍 Region: ${t.region||"N/A"}`,
    newOrder:       (id, sName, tName, parts, total) => `🔔 *New Order!*\n🆔 ${id}\n🔧 ${sName}\n📌 ${tName}${parts!=="-"?`\n\n🔩 Parts:\n${parts}`:""}\n\n💰 Total: ${total.toFixed(3)} OMR`,
    acceptBtn:      "✅ Accept Order",
    rejectBtn:      "❌ Reject Order",
    customerPhone:  (p) => `📞 Customer phone: ${p}`,
    orderDoneBtn:   "✅ Mark as Done",
    orderDoneLabel: (id) => `Order ${id} — tap when finished`,
    accepted:       (name, phone) => `✅ *Order accepted!*\n👨‍🔧 Tech: ${name}\n📞 ${phone}\nOn the way! 🚗`,
    rejected:       (id) => `❌ Technician rejected your order.\n🆔 ${id}\nSearching for another...`,
    noBackupTech:   (id) => `❌ No technician available.\n🆔 ${id}\nSend *mrhba* to try again.`,
    techRejected:   "Order rejected.",
    orderNotFound:  "Order not found.",
    alreadyProcessed:"Order already processed.",
    alreadyDone:    "Order already completed.",
    completed:      (id) => `✅ *Order completed!*\n🆔 ${id}\nThank you! 🙏`,
    techDone:       (id, fee, bal) => `✅ Order ${id} done.\n💸 Fee: ${fee.toFixed(3)} OMR\n💰 Balance: ${bal.toFixed(3)} OMR`,
    ratePrompt:     (id) => `⭐ *Rate the technician*\nSend a number from 1 to 5:\n\n1 — ⭐ Poor\n2 — ⭐⭐ Fair\n3 — ⭐⭐⭐ Good\n4 — ⭐⭐⭐⭐ Very Good\n5 — ⭐⭐⭐⭐⭐ Excellent`,
    ratingDone:     (s) => `Thanks for rating! ${"⭐".repeat(s)}`,
    invoiceCaption: (id) => `📄 Invoice for Order ${id}`,
    finalInvoice:   (id) => `📄 Final Invoice for Order ${id}`,
    waitingQueue:   (id) => `⏳ *Your order is in the waiting queue!*\n🆔 Order ID: ${id}\n\nYou'll be notified as soon as a technician is available.\n\nTrack your order:\n*status ${id}*`,
    techAvailable:  (id) => `✅ *A technician is now available for your order!*\n🆔 ${id}\nSending order to technician...`,
    cancelPrompt:   (id) => `Do you want to cancel order ${id}?\nSend the reason or send *no* to go back.`,
    cancelDone:     (id) => `✅ Order ${id} has been cancelled.\nThank you.`,
    cancelNo:       "Your order is still active.",
    orderMenu:      (o) => `📋 *Order Details*\n🆔 ${o.orderId}\n🔧 ${o.serviceName}\n📌 ${o.type||""}\n💰 ${(o.totalPrice||0).toFixed(3)} OMR\n📊 Status: ${statusLabel(o.status,"en")}\n📍 Region: ${o.region||"-"}\n\nSend *cancel_${o.orderId}* to cancel this order.`,
    trackResult:    (o) => `📋 *Order Details*\n🆔 ${o.orderId}\n🔧 ${o.serviceName}\n📌 ${o.type||""}\n💰 ${(o.totalPrice||o.price||0).toFixed(3)} OMR\n📊 Status: ${statusLabel(o.status,"en")}\n📍 Region: ${o.region||"-"}\n📅 ${o.createdAt?new Date(o.createdAt.seconds*1000).toLocaleDateString("en-OM"):"-"}`,
    trackNotFound:  "❌ No order found with this ID.",
    trackPrompt:    "🔍 Send your order ID:\nExample: *status ORD-XXXXXXXX*",
  }
};

function statusLabel(s, l) {
  return ({ar:{pending:"قيد الانتظار",accepted:"مقبول",done:"مكتمل",rejected:"مرفوض"},en:{pending:"Pending",accepted:"Accepted",done:"Done",rejected:"Rejected"}}[l]||{})[s]||s;
}
function getLang(s) { return s?.data?.lang || "ar"; }
function L(s)       { return LANGS[getLang(s)]; }

// ─── Session ──────────────────────────────────────────────────────────────────
async function getSession(p) { const d = await db.collection("sessions").doc(p).get(); return d.exists?d.data():{state:null,data:{}}; }
async function setSession(p, state, data) { await db.collection("sessions").doc(p).set({state,data:data||{}}); }
async function clearSession(p) { await db.collection("sessions").doc(p).delete(); }
function generateOrderId() { return "ORD-" + uuidv4().split("-")[0].toUpperCase(); }

// ─── WhatsApp Senders ─────────────────────────────────────────────────────────
async function sendMessage(to, text) {
  try {
    await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {messaging_product:"whatsapp",to,text:{body:text}},
      {headers:{Authorization:`Bearer ${WHATSAPP_TOKEN}`,"Content-Type":"application/json"}});
  } catch(e) { console.error("sendMsg:", e?.message); }
}

// List — for services and types (many options)
async function sendList(to, body, button, sections) {
  try {
    await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {messaging_product:"whatsapp",to,type:"interactive",interactive:{type:"list",body:{text:body},action:{button,sections}}},
      {headers:{Authorization:`Bearer ${WHATSAPP_TOKEN}`,"Content-Type":"application/json"}});
  } catch(e) { console.error("sendList:", e?.message); }
}

// Buttons — for confirm/accept/reject/done (max 3)
async function sendButtons(to, body, buttons) {
  try {
    await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {messaging_product:"whatsapp",to,type:"interactive",interactive:{
        type:"button",body:{text:body},
        action:{buttons:buttons.slice(0,3).map(b=>({type:"reply",reply:{id:b.id,title:b.title.substring(0,20)}}))}
      }},
      {headers:{Authorization:`Bearer ${WHATSAPP_TOKEN}`,"Content-Type":"application/json"}});
  } catch(e) { console.error("sendButtons:", e?.message); }
}

async function sendLocation(to, lat, lng) {
  try {
    await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {messaging_product:"whatsapp",to,type:"location",location:{latitude:lat,longitude:lng}},
      {headers:{Authorization:`Bearer ${WHATSAPP_TOKEN}`,"Content-Type":"application/json"}});
  } catch(e) { console.error("sendLoc:", e?.message); }
}

async function sendDocument(to, buf, filename, caption) {
  try {
    const FormData = require("form-data");
    const form = new FormData();
    form.append("file", buf, {filename, contentType:"application/pdf"});
    form.append("messaging_product","whatsapp");
    const up = await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/media`, form,
      {headers:{Authorization:`Bearer ${WHATSAPP_TOKEN}`,...form.getHeaders()}});
    await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {messaging_product:"whatsapp",to,type:"document",document:{id:up.data.id,filename,caption}},
      {headers:{Authorization:`Bearer ${WHATSAPP_TOKEN}`,"Content-Type":"application/json"}});
  } catch(e) { console.error("sendDoc:", e?.message); }
}

// ─── PDF Invoice ──────────────────────────────────────────────────────────────
function generateInvoicePDF(order, lang) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({margin:40,size:"A4"});
    const chunks = [];
    doc.on("data",d=>chunks.push(d));
    doc.on("end",()=>resolve(Buffer.concat(chunks)));
    const isAr = lang==="ar";
    doc.rect(0,0,595,80).fill("#0a0e1a");
    doc.fillColor("#f59e0b").fontSize(28).font("Helvetica-Bold").text("TAQA",40,20);
    doc.fillColor("#ffffff").fontSize(11).font("Helvetica").text(isAr?"فاتورة خدمة":"Service Invoice",40,52);
    doc.fillColor("#64748b").text(new Date().toLocaleDateString(isAr?"ar-OM":"en-OM"),400,52,{align:"right"});
    doc.fillColor("#1a2235").rect(0,82,595,70).fill();
    doc.fillColor("#f1f5f9").fontSize(10).font("Helvetica-Bold");
    doc.text(isAr?"رقم الطلب":"Order ID",40,100); doc.text(isAr?"العميل":"Customer",200,100); doc.text(isAr?"الخدمة":"Service",360,100);
    doc.fillColor("#f59e0b").fontSize(11).font("Helvetica");
    doc.text(order.orderId,40,118); doc.fillColor("#f1f5f9"); doc.text(order.customer,200,118); doc.text(order.serviceName,360,118);
    let y=170;
    doc.fillColor("#64748b").fontSize(9).font("Helvetica-Bold");
    doc.text(isAr?"القطعة":"Item",40,y); doc.text(isAr?"الكمية":"Qty",340,y,{width:60,align:"center"});
    doc.text(isAr?"السعر":"Price",410,y,{width:80,align:"right"}); doc.text(isAr?"الإجمالي":"Total",500,y,{width:55,align:"right"});
    y+=18; doc.rect(40,y,515,1).fill("#1e2d45"); y+=8;
    doc.fillColor("#f1f5f9").fontSize(10).font("Helvetica");
    doc.text(`${order.serviceName} — ${order.type||""}`,40,y,{width:280});
    doc.text("1",340,y,{width:60,align:"center"}); doc.text(`${order.servicePrice||0}`,410,y,{width:80,align:"right"}); doc.text(`${order.servicePrice||0}`,500,y,{width:55,align:"right"});
    y+=22;
    (order.parts||[]).forEach(p=>{
      const lt=(p.price*p.qty).toFixed(3);
      doc.text(p.name,40,y,{width:280}); doc.text(String(p.qty),340,y,{width:60,align:"center"});
      doc.text(`${p.price}`,410,y,{width:80,align:"right"}); doc.text(lt,500,y,{width:55,align:"right"});
      y+=20; if(y>700){doc.addPage();y=40;}
    });
    y+=10; doc.rect(40,y,515,1).fill("#1e2d45"); y+=12;
    const sub=(order.parts||[]).reduce((s,p)=>s+p.price*p.qty,0)+(order.servicePrice||0);
    const disc=order.discount||0; const after=sub-disc;
    const vat=Math.round(after*0.05*1000)/1000; const total=Math.round((after+vat)*1000)/1000;
    doc.fillColor("#64748b").fontSize(10);
    doc.text(isAr?"المجموع":"Subtotal",350,y); doc.fillColor("#f1f5f9").text(`${sub.toFixed(3)} OMR`,500,y,{width:55,align:"right"}); y+=18;
    if(disc>0){doc.fillColor("#10b981").text(isAr?"خصم الكوبون":"Coupon",350,y); doc.text(`-${disc.toFixed(3)} OMR`,500,y,{width:55,align:"right"}); y+=18;}
    doc.fillColor("#64748b").text(isAr?"ضريبة 5%":"VAT 5%",350,y); doc.fillColor("#f1f5f9").text(`${vat.toFixed(3)} OMR`,500,y,{width:55,align:"right"}); y+=18;
    doc.fillColor("#f59e0b").rect(340,y,215,30).fill(); doc.fillColor("#000").fontSize(12).font("Helvetica-Bold");
    doc.text(isAr?"الإجمالي":"Total",355,y+8); doc.text(`${total.toFixed(3)} OMR`,500,y+8,{width:55,align:"right"});
    y+=50; doc.fillColor("#1a2235").rect(40,y,515,36).fill();
    doc.fillColor("#64748b").fontSize(9).font("Helvetica").text(isAr?"شكراً لاستخدامكم خدمات طاقة":"Thank you for using TAQA services",50,y+12,{width:495,align:"center"});
    doc.fillColor("#111827").rect(0,780,595,60).fill();
    doc.fillColor("#64748b").fontSize(8).text("TAQA Services | Oman",40,800,{align:"center",width:515});
    doc.end();
  });
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────
async function getServices() {
  const snap = await db.collection("services").get();
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}
async function getTechByPhone(phone) {
  const snap = await db.collection("technicians").where("phone","==",normalize(phone)).get();
  if(snap.empty) return null;
  return {id:snap.docs[0].id,...snap.docs[0].data()};
}
async function getAvailableTechs(serviceId, regionName, excludeIds=[]) {
  const snap = await db.collection("technicians")
    .where("active","==",true).where("services","array-contains",serviceId).get();
  let techs = snap.docs.map(d=>({id:d.id,...d.data()})).filter(t=>!excludeIds.includes(t.id));
  // Prefer same region (flexible Arabic match)
  if(regionName && techs.length > 1){
    const norm = s=>(s||"").toLowerCase().replace(/\s+/g,"").replace(/ة/g,"ه").replace(/ى/g,"ي");
    const rn   = norm(regionName);
    const reg  = techs.filter(t=>{const tn=norm(t.region||"");return tn&&(tn.includes(rn)||rn.includes(tn));});
    if(reg.length) techs = reg;
  }
  techs.sort((a,b)=>(b.rating||0)-(a.rating||0));
  return techs;
}
async function getActiveOrder(phone) {
  const snap = await db.collection("orders").where("customer","==",phone).where("status","in",["pending","accepted"]).limit(1).get();
  if(snap.empty) return null;
  return {id:snap.docs[0].id,...snap.docs[0].data()};
}
async function getPartsByService(serviceId) {
  const snap = await db.collection("parts").where("serviceId","==",serviceId).get();
  return snap.docs.map(d=>({id:d.id,...d.data()}))
    .filter(p => p.stock === undefined || p.stock > 0); // exclude out-of-stock
}
async function checkActiveCoupons() {
  try { const s=await db.collection("coupons").where("active","==",true).limit(1).get(); return !s.empty; }
  catch(e){ return false; }
}

// ─── Region Detection ─────────────────────────────────────────────────────────
async function detectRegion(lat, lng) {
  try {
    const res = await axios.get(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ar`,
      {headers:{"User-Agent":"TAQA-Bot/1.0"},timeout:5000}
    );
    const a = res.data.address||{};
    return a.county||a.state_district||a.suburb||a.city||a.state||null;
  } catch(e){ return null; }
}

// ─── Coupon ───────────────────────────────────────────────────────────────────
async function validateCoupon(code, userId) {
  const snap = await db.collection("coupons").where("code","==",code.toUpperCase()).limit(1).get();
  if(snap.empty) return {valid:false,reason:"invalid"};
  const doc=snap.docs[0]; const data=doc.data();
  if(!data.active) return {valid:false,reason:"invalid"};
  if(data.expiresAt&&data.expiresAt.toDate()<new Date()) return {valid:false,reason:"invalid"};
  if(data.usedBy&&data.usedBy.includes(userId)) return {valid:false,reason:"used"};
  if(data.maxUses&&(data.useCount||0)>=data.maxUses) return {valid:false,reason:"invalid"};
  return {valid:true,id:doc.id,discount:data.discount||0,type:data.type||"fixed",code:data.code};
}
async function applyCoupon(couponId, userId) {
  await db.runTransaction(async tx=>{
    const ref=db.collection("coupons").doc(couponId); const snap=await tx.get(ref);
    tx.update(ref,{useCount:(snap.data().useCount||0)+1,usedBy:admin.firestore.FieldValue.arrayUnion(userId)});
  });
}

// ─── Rating ───────────────────────────────────────────────────────────────────
async function updateTechRating(techId, stars) {
  await db.runTransaction(async tx=>{
    const ref=db.collection("technicians").doc(techId); const snap=await tx.get(ref);
    if(!snap.exists) return;
    const d=snap.data(); const count=(d.ratingCount||0)+1;
    tx.update(ref,{rating:Math.round((((d.rating||0)*(count-1))+stars)/count*10)/10,ratingCount:count});
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildPartsText(parts) {
  if(!parts||!parts.length) return "-";
  return parts.map(p=>`• ${p.name} × ${p.qty} = ${(p.price*p.qty).toFixed(3)} OMR`).join("\n");
}
function calcTotal(servicePrice, parts) {
  return Math.round(((servicePrice||0)+(parts||[]).reduce((s,p)=>s+p.price*p.qty,0))*1000)/1000;
}

// ─── Webhook ──────────────────────────────────────────────────────────────────
app.get("/webhook",(req,res)=>{
  if(req.query["hub.verify_token"]===VERIFY_TOKEN) return res.send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

app.post("/webhook", async(req,res)=>{
  res.sendStatus(200);
  try {
    const val = req.body.entry?.[0]?.changes?.[0]?.value;
    if(!val?.messages?.[0]) return;
    const msg  = val.messages[0];
    const from = normalize(msg.from);

    // Extract text from text or interactive messages
    let text = "";
    if(msg.type==="text") text = msg.text.body.trim();
    else if(msg.type==="interactive") {
      text = msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || "";
    }
    console.log("FROM:", from, "TYPE:", msg.type, "TEXT:", text);

    // ── Tech handler ─────────────────────────────────────────────────────────
    const tech = await getTechByPhone(from);
    if(tech) { await handleTechMessage(from, text, msg, tech); return; }

    // ── Rating: handled via session state "rating" ─────────────────────────────
    // Legacy support: تقييم_ORD-XXX_5
    const rateMatch = text.match(/^(تقييم|rate)_(.+)_([1-5])$/i);
    if(rateMatch){
      const orderId=rateMatch[2]; const stars=parseInt(rateMatch[3]);
      const oSnap=await db.collection("orders").doc(orderId).get();
      if(oSnap.exists&&!oSnap.data().rating){
        await updateTechRating(oSnap.data().technicianId, stars);
        await db.collection("orders").doc(orderId).update({rating:stars});
        const session=await getSession(from);
        await sendMessage(from, LANGS[getLang(session)].ratingDone(stars));
      }
      return;
    }

    // ── Order tracking ────────────────────────────────────────────────────────
    // Cancel order: إلغاء_ORD-XXX or cancel_ORD-XXX
    const cancelAr = text.match(/^إلغاء_(.+)/i);
    const cancelEn = text.match(/^cancel_(.+)/i);
    if(cancelAr||cancelEn){
      const session=await getSession(from);
      const lang=getLang(session);
      const orderId=(cancelAr?.[1]||cancelEn?.[1]).trim().toUpperCase();
      const oSnap=await db.collection("orders").doc(orderId).get();
      if(!oSnap.exists){ await sendMessage(from,LANGS[lang].trackNotFound); return; }
      const order=oSnap.data();
      if(order.customer!==from){ await sendMessage(from,LANGS[lang].trackNotFound); return; }
      if(["done","rejected","cancelled"].includes(order.status)){
        await sendMessage(from, LANGS[lang].trackResult(order)); return;
      }
      // Ask for cancel reason
      await setSession(from,"cancel_reason",{lang,orderId,order});
      await sendMessage(from, LANGS[lang].cancelPrompt(orderId));
      return;
    }

    // Cancel reason state handled below in session flow
    const trackAr = text.match(/^حالة\s+(.+)/i);
    const trackEn = text.match(/^status\s+(.+)/i);
    if(trackAr||trackEn){
      const session=await getSession(from); const lang=getLang(session);
      const id=(trackAr?.[1]||trackEn?.[1]).trim().toUpperCase();
      let oSnap=await db.collection("orders").doc(id).get();
      if(!oSnap.exists){ const q=await db.collection("orders").where("orderId","==",id).limit(1).get(); if(!q.empty) oSnap=q.docs[0]; }
      await sendMessage(from, oSnap?.exists?LANGS[lang].trackResult({...(oSnap.data?oSnap.data():oSnap.data())}):LANGS[lang].trackNotFound);
      return;
    }
    if(text==="حالة"||text.toLowerCase()==="status"){
      const session=await getSession(from);
      await sendMessage(from, LANGS[getLang(session)].trackPrompt); return;
    }

    // ── Session flow ──────────────────────────────────────────────────────────
    let session = await getSession(from);
    const isStartAr = ["مرحبا","هلا","مرحبً","ابدا"].includes(text);
    const isStartEn = ["mrhba","hello","hi","start"].includes(text.toLowerCase());
    const isStart   = isStartAr || isStartEn;
    const newLang   = isStartAr?"ar":isStartEn?"en":null;

    // ── STATE: cancel_reason ────────────────────────────────────────────────
    if(session.state==="cancel_reason"){
      const lang     = session.data.lang||"ar";
      const Lc       = LANGS[lang];
      const orderId  = session.data.orderId;
      const docId    = session.data.orderDocId;
      const isWaiting= session.data.isWaiting||false;

      if(text.toLowerCase()==="لا"||text.toLowerCase()==="no"){
        await clearSession(from);
        await sendMessage(from, Lc.cancelNo);
        return;
      }
      const reason = text;
      const cancelData = { status:"cancelled", cancelledAt:admin.firestore.FieldValue.serverTimestamp(), cancelReason:reason, cancelledBy:"customer" };
      if(isWaiting){
        await db.collection("waiting_orders").doc(docId).update(cancelData);
      } else {
        await db.collection("orders").doc(docId).update(cancelData);
        // Free up tech if accepted
        const oSnap = await db.collection("orders").doc(docId).get();
        const oData = oSnap.data();
        if(oData?.technicianId && oData?.status==="accepted"){
          await db.collection("technicians").doc(oData.technicianId).update({active:true});
        }
      }
      await clearSession(from);
      await sendMessage(from, Lc.cancelDone(orderId, reason));
      return;
    }

    if(!session.state||isStart){
      const lang     = newLang||getLang(session)||"ar";
      const Lx       = LANGS[lang];
      const active   = await getActiveOrder(from);
      if(active){ await sendMessage(from, Lx.activeOrder(active.orderId,active.serviceName,active.status)); return; }
      await clearSession(from);
      const services = await getServices();
      // Services as LIST
      await sendList(from, Lx.welcome, Lx.servicesBtn, [{
        title: Lx.chooseService,
        rows: services.map((s,i)=>({id:"svc_"+i, title:s.name.substring(0,24)}))
      }]);
      await setSession(from, "service", {lang, services});
      return;
    }

    const Lx = L(session);

    // ── service ───────────────────────────────────────────────────────────────
    if(session.state==="service"){
      const services = session.data.services||[];
      let idx = -1;
      if(text.startsWith("svc_")) idx=parseInt(text.replace("svc_",""));
      else { const n=parseInt(text); if(!isNaN(n)&&n>=1&&n<=services.length) idx=n-1; }
      if(idx<0||idx>=services.length){ await sendMessage(from,`يرجى اختيار خدمة من القائمة.`); return; }
      const service = services[idx];
      // Types as LIST
      await sendList(from, Lx.chooseType(service.name), Lx.typesBtn, [{
        title: Lx.typesBtn,
        rows: service.types.map((t,i)=>({id:"typ_"+i, title:t.name.substring(0,24), description:`${t.price} OMR`}))
      }]);
      await setSession(from,"type",{...session.data,service});
      return;
    }

    // ── type ──────────────────────────────────────────────────────────────────
    if(session.state==="type"){
      const service = session.data.service;
      let idx = -1;
      if(text.startsWith("typ_")) idx=parseInt(text.replace("typ_",""));
      else { const n=parseInt(text); if(!isNaN(n)&&n>=1&&n<=service.types.length) idx=n-1; }
      if(idx<0||idx>=service.types.length){ await sendMessage(from,`يرجى اختيار نوع من القائمة.`); return; }
      const type  = service.types[idx];
      const parts = await getPartsByService(service.id);
      if(!parts.length){
        // No parts for this service — skip
        await goNextAfterParts(from,{...session.data,selectedType:type,parts:[],servicePrice:type.price},Lx);
      } else {
        // Ask if customer wants parts
        await setSession(from,"parts_ask",{...session.data,selectedType:type,parts:[],servicePrice:type.price,availableParts:parts});
        const partsAskMsg = getLang(session)==="ar"
          ? `🔩 *هل تريد إضافة قطع غيار؟*\n\nالقطع المتاحة لهذه الخدمة:\n${Lx.partsMenu(parts)}\n\nأرسل رقم القطعة للإضافة أو *0* للمتابعة بدون قطع.`
          : `🔩 *Do you want to add spare parts?*\n\nAvailable parts:\n${Lx.partsMenu(parts)}\n\nSend part number to add or *0* to continue without parts.`;
        await sendMessage(from, partsAskMsg);
      }
      return;
    }

    // ── parts_ask & parts — unified handler ─────────────────────────────────────
    if(session.state==="parts_ask") session.state="parts";
    if(session.state==="parts"){
      const avail   = session.data.availableParts||[];
      const selected= session.data.parts||[];
      const pending = session.data.pendingPartIdx;

      if(pending!==undefined){
        // "0" while waiting for qty = cancel part selection, go back to menu
        if(text==="0"){
          await setSession(from,"parts",{...session.data,pendingPartIdx:undefined});
          const avail2=session.data.availableParts||[];
          const menuMsg=getLang(session)==="ar"
            ? `اختر رقم القطعة أو *0* للمتابعة:\n\n${avail2.map((p,i)=>`${i+1}. ${p.name} — ${p.price.toFixed(3)} OMR`).join("\n")}\n\n0 — متابعة بدون إضافة`
            : `Choose part number or *0* to continue:\n\n${avail2.map((p,i)=>`${i+1}. ${p.name} — ${p.price.toFixed(3)} OMR`).join("\n")}\n\n0 — Continue`;
          await sendMessage(from, menuMsg);
          return;
        }
        const qty=parseInt(text);
        if(isNaN(qty)||qty<1){ await sendMessage(from,Lx.invalidInput); return; }
        const part=avail[pending];
        // Stock check
        if(part.stock !== undefined){
          const alreadySelected = selected.find(p=>p.id===part.id)?.qty||0;
          const maxAllowed = part.stock - alreadySelected;
          if(qty > maxAllowed){
            await sendMessage(from, Lx.outOfStock(part.name, maxAllowed>0?maxAllowed:0));
            if(maxAllowed<=0) await setSession(from,"parts",{...session.data,pendingPartIdx:undefined});
            return;
          }
        }
        const ex=selected.find(p=>p.id===part.id);
        if(ex) ex.qty+=qty; else selected.push({id:part.id,name:part.name,price:part.price,unit:part.unit||"قطعة",qty,stock:part.stock});
        const ptotal=selected.reduce((s,p)=>s+p.price*p.qty,0);
        const newData = {...session.data, parts:selected, pendingPartIdx:undefined};
        await setSession(from,"parts", newData);
        const avail2 = newData.availableParts||[];
        const addedMsg = getLang(session)==="ar"
          ? `✅ تمت إضافة: *${part.name}* × ${qty}\n💡 إجمالي القطع: ${ptotal.toFixed(3)} OMR\n\nأرسل رقم قطعة أخرى أو *0* للمتابعة:\n\n${avail2.map((p,i)=>`${i+1}. ${p.name} — ${p.price.toFixed(3)} OMR`).join("\n")}\n\n0 — المتابعة للتأكيد`
          : `✅ Added: *${part.name}* × ${qty}\n💡 Parts total: ${ptotal.toFixed(3)} OMR\n\nSend another number or *0* to continue:\n\n${avail2.map((p,i)=>`${i+1}. ${p.name} — ${p.price.toFixed(3)} OMR`).join("\n")}\n\n0 — Continue to confirm`;
        await sendMessage(from, addedMsg);
        return;
      }

      if(text==="0"){ await goNextAfterParts(from,{...session.data,parts:selected},Lx); return; }

      const num=parseInt(text);
      if(isNaN(num)||num<1||num>avail.length){ await sendMessage(from,Lx.invalidPart(avail.length)); return; }
      const part=avail[num-1];
      await setSession(from,"parts",{...session.data,pendingPartIdx:num-1});
      await sendMessage(from,Lx.qtyPrompt(part.name,part.price,part.stock));
      return;
    }

    // ── coupon ────────────────────────────────────────────────────────────────
    if(session.state==="coupon"){
      if(text==="0"){ await goToConfirm(from,session,Lx,0,null); return; }
      const result=await validateCoupon(text,from);
      if(!result.valid){ await sendMessage(from,result.reason==="used"?Lx.couponUsed:Lx.couponInvalid); return; }
      const raw=calcTotal(session.data.servicePrice,session.data.parts);
      const disc=result.type==="percent"?Math.round(raw*result.discount/100*1000)/1000:result.discount;
      const final=Math.max(0,Math.round((raw-disc)*1000)/1000);
      await sendMessage(from,Lx.couponValid(result.code,disc,final));
      const newData={...session.data,couponId:result.id,couponCode:result.code,discount:disc};
      await setSession(from,"coupon",newData);
      await goToConfirm(from,{...session,data:newData},Lx,disc,result.code);
      return;
    }

    // ── confirm — BUTTONS ─────────────────────────────────────────────────────
    if(session.state==="confirm"){
      if(text==="confirm_no"||text==="2"){ await clearSession(from); await sendMessage(from,Lx.cancelled); return; }
      if(text==="confirm_yes"||text==="1"){ await setSession(from,"location",session.data); await sendMessage(from,Lx.confirmed); return; }
      // Resend buttons if invalid
      await goToConfirm(from,session,Lx,session.data.discount||0,session.data.couponCode||null);
      return;
    }

    // ── location ──────────────────────────────────────────────────────────────
    if(session.state==="location"){
      if(msg.type!=="location"){ await sendMessage(from,Lx.locationOnly); return; }
      const service=session.data.service; const selectedType=session.data.selectedType;
      const userLang=getLang(session);
      if(!service||!selectedType){ await sendMessage(from,Lx.sessionExpired); await clearSession(from); return; }

      const regionName=await detectRegion(msg.location.latitude,msg.location.longitude);
      if(regionName) await sendMessage(from,Lx.regionDetected(regionName));

      const techs=await getAvailableTechs(service.id,regionName||"",[]);
      if(!techs.length){
        // Save to waiting queue
        const waitId = generateOrderId();
        await db.collection("waiting_orders").doc(waitId).set({
          orderId: waitId, customer: from,
          serviceName: service.name, serviceId: service.id,
          type: selectedType.name, servicePrice: session.data.servicePrice||selectedType.price,
          parts, totalPrice, discount,
          couponCode: session.data.couponCode||null,
          region: regionName||null, lang: userLang,
          location:{latitude:msg.location.latitude,longitude:msg.location.longitude},
          status: "waiting",
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        await sendMessage(from, regionName ? Lx.noTechRegion(regionName) : Lx.noTechAny);
        await sendMessage(from, Lx.orderSent(waitId));
        await clearSession(from); return;
      }

      const chosenTech=techs[0];
      const orderId=generateOrderId();
      const parts=session.data.parts||[];
      const rawTotal=calcTotal(session.data.servicePrice||selectedType.price,parts);
      const discount=session.data.discount||0;
      const totalPrice=Math.max(0,Math.round((rawTotal-discount)*1000)/1000);
      const partsText=buildPartsText(parts);

      await db.collection("orders").doc(orderId).set({
        orderId, customer:from,
        serviceName:service.name, serviceId:service.id,
        type:selectedType.name, servicePrice:session.data.servicePrice||selectedType.price,
        parts, totalPrice, discount,
        couponCode:session.data.couponCode||null,
        technicianId:chosenTech.id, rejectedTechs:[],
        status:"pending", lang:userLang, region:regionName||null,
        location:{latitude:msg.location.latitude,longitude:msg.location.longitude},
        createdAt:admin.firestore.FieldValue.serverTimestamp()
      });

      if(session.data.couponId) await applyCoupon(session.data.couponId,from);

      // Notify tech with BUTTONS (accept/reject)
      const techPhone=normalize(chosenTech.phone);
      await sendButtons(techPhone,
        LANGS.ar.newOrder(orderId,service.name,selectedType.name,partsText,totalPrice),
        [{id:"accept_"+orderId,title:LANGS.ar.acceptBtn},{id:"reject_"+orderId,title:LANGS.ar.rejectBtn}]
      );

      await sendMessage(from,Lx.orderSent(orderId));
      const pdf=await generateInvoicePDF({orderId,customer:from,serviceName:service.name,type:selectedType.name,servicePrice:session.data.servicePrice||selectedType.price,parts,discount},userLang);
      await sendDocument(from,pdf,`invoice_${orderId}.pdf`,Lx.invoiceCaption(orderId));
      await clearSession(from);
      return;
    }

    // ── rating state — customer replies 1-5 ────────────────────────────────────
    if(session.state==="rating"){
      const stars = parseInt(text);
      if(isNaN(stars)||stars<1||stars>5){
        await sendMessage(from, getLang(session)==="ar"?"يرجى إرسال رقم بين 1 و 5":"Please send a number between 1 and 5");
        return;
      }
      const { orderId, technicianId, lang } = session.data;
      try {
        // Update tech rating
        await updateTechRating(technicianId, stars);
        // Save rating in order
        const oSnap = await db.collection("orders").doc(orderId).get();
        if(oSnap.exists && !oSnap.data().rating){
          await db.collection("orders").doc(orderId).update({ rating: stars });
        }
        await clearSession(from);
        await sendMessage(from, LANGS[lang||"ar"].ratingDone(stars));
      } catch(e) {
        console.error("rating state error:", e?.message);
        await clearSession(from);
      }
      return;
    }

    // ── cancel_reason state ─────────────────────────────────────────────────
    if(session.state==="cancel_reason"){
      const lang    = session.data.lang||"ar";
      const orderId = session.data.orderId;
      const Lx2     = LANGS[lang];
      if(text==="لا"||text.toLowerCase()==="no"){
        await clearSession(from);
        await sendMessage(from, Lx2.cancelNo);
        return;
      }
      // Save cancellation with reason
      await db.collection("orders").doc(orderId).update({
        status:"cancelled",
        cancelReason:text,
        cancelledAt:admin.firestore.FieldValue.serverTimestamp(),
        cancelledBy:"customer"
      });
      // Free tech if assigned
      const order=session.data.order;
      if(order.technicianId&&order.status==="accepted"){
        await db.collection("technicians").doc(order.technicianId).update({active:true});
      }
      await clearSession(from);
      await sendMessage(from, Lx2.cancelDone(orderId));
      return;
    }

    await sendMessage(from,Lx.defaultMsg);
  } catch(err){ console.error("WEBHOOK ERROR:", err); }
});

// ─── goNextAfterParts ─────────────────────────────────────────────────────────
async function goNextAfterParts(from, data, Lx) {
  const hasCoupons=await checkActiveCoupons();
  if(hasCoupons){ await setSession(from,"coupon",data); await sendMessage(from,Lx.couponPrompt); }
  else { await goToConfirm(from,{state:"coupon",data},Lx,0,null); }
}

// ─── goToConfirm — sends BUTTONS ─────────────────────────────────────────────
async function goToConfirm(from, session, Lx, discount, couponCode) {
  const service     = session.data.service;
  const type        = session.data.selectedType;
  const parts       = session.data.parts||[];
  const servicePrice= session.data.servicePrice||0;
  const partsTotal  = parts.reduce((s,p)=>s+p.price*p.qty,0);
  const raw         = Math.round((servicePrice+partsTotal)*1000)/1000;
  const disc        = discount||0;
  const total       = Math.max(0,Math.round((raw-disc)*1000)/1000);
  const partsTxt    = buildPartsText(parts);
  await setSession(from,"confirm",{...session.data,discount:disc,couponCode,totalPrice:total});
  await sendButtons(from,
    Lx.confirmTitle(service.name, type.name, partsTxt, servicePrice, partsTotal, disc>0?disc:null, total),
    [{id:"confirm_yes",title:Lx.confirmYes},{id:"confirm_no",title:Lx.confirmNo}]
  );
}

// ─── Tech Handlers ────────────────────────────────────────────────────────────
async function handleTechMessage(techPhone, text, msg, tech) {
  // Accept button: accept_ORD-XXX
  if(text.startsWith("accept_")){ await handleAccept(text.replace("accept_",""),techPhone,tech); return; }
  // Reject button: reject_ORD-XXX
  if(text.startsWith("reject_")){ await handleReject(text.replace("reject_",""),techPhone,tech); return; }
  // Done button: done_ORD-XXX
  if(text.startsWith("done_")){ await handleDone(text.replace("done_",""),techPhone,tech); return; }
  // Text fallback
  await sendMessage(techPhone, LANGS.ar.techInfo(tech));
}

async function handleAccept(orderId, techPhone, tech) {
  const ref=db.collection("orders").doc(orderId); const snap=await ref.get();
  if(!snap.exists){ await sendMessage(techPhone,LANGS.ar.orderNotFound); return; }
  const order=snap.data();
  if(order.status!=="pending"){ await sendMessage(techPhone,LANGS.ar.alreadyProcessed); return; }
  await ref.update({status:"accepted"});
  await db.collection("technicians").doc(order.technicianId).update({active:false});
  const customerPhone=normalize(order.customer);
  const CL=LANGS[order.lang||"ar"];
  await sendMessage(techPhone,LANGS.ar.customerPhone(customerPhone));
  if(order.location?.latitude) await sendLocation(techPhone,order.location.latitude,order.location.longitude);
  // Done button for tech
  await sendButtons(techPhone, LANGS.ar.orderDoneLabel(orderId), [{id:"done_"+orderId,title:LANGS.ar.orderDoneBtn}]);
  await sendMessage(customerPhone,CL.accepted(tech.name,tech.phone));
}

async function handleReject(orderId, techPhone, tech) {
  const ref=db.collection("orders").doc(orderId); const snap=await ref.get();
  if(!snap.exists){ await sendMessage(techPhone,LANGS.ar.orderNotFound); return; }
  const order=snap.data();
  if(order.status!=="pending"){ await sendMessage(techPhone,LANGS.ar.alreadyProcessed); return; }
  await sendMessage(techPhone,LANGS.ar.techRejected);
  const rejected=[...(order.rejectedTechs||[]),order.technicianId];
  await ref.update({status:"pending",rejectedTechs:rejected});
  const customerPhone=normalize(order.customer);
  const CL=LANGS[order.lang||"ar"];
  await sendMessage(customerPhone,CL.rejected(orderId));
  const backup=await getAvailableTechs(order.serviceId,order.region||"",rejected);
  if(!backup.length){ await ref.update({status:"rejected"}); await sendMessage(customerPhone,CL.noBackupTech(orderId)); return; }
  await ref.update({technicianId:backup[0].id});
  await sendButtons(normalize(backup[0].phone),
    LANGS.ar.newOrder(orderId,order.serviceName,order.type||"",buildPartsText(order.parts),order.totalPrice||0),
    [{id:"accept_"+orderId,title:LANGS.ar.acceptBtn},{id:"reject_"+orderId,title:LANGS.ar.rejectBtn}]
  );
}

async function handleDone(orderId, techPhone, tech) {
  const ref=db.collection("orders").doc(orderId); const snap=await ref.get();
  if(!snap.exists){ await sendMessage(techPhone,LANGS.ar.orderNotFound); return; }
  const order=snap.data();
  if(order.status==="done"){ await sendMessage(techPhone,LANGS.ar.alreadyDone); return; }
  await ref.update({status:"done",completedAt:admin.firestore.FieldValue.serverTimestamp()});
  const techRef=db.collection("technicians").doc(order.technicianId);
  const techData=(await techRef.get()).data();
  const fee=Math.round((order.totalPrice||0)*0.2*1000)/1000;
  const newBal=Math.max(0,Math.round(((techData?.balance||0)-fee)*1000)/1000);
  await techRef.update({balance:newBal,active:true});
  // Deduct parts stock
  if(order.parts && order.parts.length){
    const batch = db.batch();
    for(const p of order.parts){
      if(!p.id) continue;
      const pRef = db.collection("parts").doc(p.id);
      const pSnap = await pRef.get();
      if(pSnap.exists && pSnap.data().stock !== undefined){
        batch.update(pRef, { stock: Math.max(0, pSnap.data().stock - p.qty) });
      }
    }
    await batch.commit();
  }
  // Check waiting queue for this service
  processWaitingQueue(order.serviceId, order.region||null).catch(console.error);
  await sendMessage(techPhone,LANGS.ar.techDone(orderId,fee,newBal));
  const customerPhone=normalize(order.customer);
  const CL=LANGS[order.lang||"ar"];
  await sendMessage(customerPhone,CL.completed(orderId));
  const pdf=await generateInvoicePDF(order,order.lang||"ar");
  await sendDocument(customerPhone,pdf,`final_invoice_${orderId}.pdf`,CL.finalInvoice(orderId));
  // Save rating session so customer just replies with 1-5
  await db.collection("sessions").doc(normalize(order.customer)).set({
    state: "rating",
    data: { lang: order.lang||"ar", orderId, technicianId: order.technicianId }
  });
  await sendMessage(customerPhone, CL.ratePrompt(orderId));
}

// ─── Admin Assign Endpoint ────────────────────────────────────────────────────
// Called from dashboard to notify tech via WhatsApp after admin assigns order
app.post("/admin/assign", async(req,res)=>{
  try {
    const { orderId, techId } = req.body;
    if(!orderId||!techId) return res.status(400).json({error:"orderId and techId required"});

    const [orderSnap, techSnap] = await Promise.all([
      db.collection("orders").doc(orderId).get(),
      db.collection("technicians").doc(techId).get()
    ]);
    if(!orderSnap.exists) return res.status(404).json({error:"Order not found"});
    if(!techSnap.exists)  return res.status(404).json({error:"Tech not found"});

    const order = orderSnap.data();
    const tech  = techSnap.data();
    const techPhone = normalize(tech.phone);
    const partsText = buildPartsText(order.parts||[]);

    // Send WhatsApp buttons to tech
    await sendButtons(techPhone,
      LANGS.ar.newOrder(order.orderId, order.serviceName, order.type||"", partsText, order.totalPrice||0),
      [{id:"accept_"+orderId, title:LANGS.ar.acceptBtn}, {id:"reject_"+orderId, title:LANGS.ar.rejectBtn}]
    );

    res.json({success:true, techName:tech.name, techPhone:tech.phone});
  } catch(e) {
    console.error("admin/assign:", e?.message);
    res.status(500).json({error:e.message});
  }
});

// ── Waiting Queue Checker (called via endpoint or on tech activation) ─────────
// When a tech becomes available, check waiting_orders and assign
async function processWaitingQueue(serviceId, region) {
  try {
    let q = db.collection("waiting_orders").where("status","==","waiting").where("serviceId","==",serviceId);
    const snap = await q.get();
    if(snap.empty) return;

    for(const doc of snap.docs){
      const order = doc.data();
      const techs = await getAvailableTechs(serviceId, order.region||"", []);
      if(!techs.length) continue;

      const tech   = techs[0];
      const orderId = order.orderId;

      // Move to orders collection
      await db.collection("orders").doc(orderId).set({
        ...order,
        technicianId: tech.id,
        rejectedTechs: [],
        status: "pending",
        movedFromWaiting: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      await doc.ref.update({status:"assigned"});
      await db.collection("technicians").doc(tech.id).update({active:false});

      // Notify customer
      const CL = LANGS[order.lang||"ar"];
      await sendMessage(normalize(order.customer), CL.techAvailableNotify(orderId, tech.name));

      // Notify tech
      const partsText = buildPartsText(order.parts||[]);
      await sendButtons(normalize(tech.phone),
        LANGS.ar.newOrder(orderId, order.serviceName, order.type||"", partsText, order.totalPrice||0),
        [{id:"accept_"+orderId, title:LANGS.ar.acceptBtn},{id:"reject_"+orderId, title:LANGS.ar.rejectBtn}]
      );
    }
  } catch(e){ console.error("processWaitingQueue:", e?.message); }
}

// ── Admin endpoint: trigger waiting queue (call after adding a tech) ──────────
app.post("/admin/process-waiting", async(req,res)=>{
  try {
    const { serviceId, region } = req.body;
    await processWaitingQueue(serviceId||null, region||null);
    res.json({success:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Patch handleDone to process waiting queue after tech freed
const _origHandleDone = handleDone;

// ── Waiting Queue Checker — runs every 2 min ──────────────────────────────────
async function checkWaitingQueue() {
  try {
    const snap = await db.collection("orders").where("status","==","waiting").get();
    if(snap.empty) return;
    for(const doc of snap.docs){
      const order = doc.data();
      const techs = await getAvailableTechs(order.serviceId, order.region||"", order.rejectedTechs||[]);
      if(!techs.length) continue;
      const tech  = techs[0];
      const CL    = LANGS[order.lang||"ar"];
      // Notify customer
      await sendMessage(normalize(order.customer), CL.techAvailable(order.orderId));
      // Update order
      await doc.ref.update({ status:"pending", technicianId:tech.id });
      // Notify tech with buttons
      const partsText = buildPartsText(order.parts||[]);
      await sendButtons(normalize(tech.phone),
        LANGS.ar.newOrder(order.orderId,order.serviceName,order.type||"",partsText,order.totalPrice||0),
        [{id:"accept_"+order.orderId,title:LANGS.ar.acceptBtn},{id:"reject_"+order.orderId,title:LANGS.ar.rejectBtn}]
      );
      console.log("Waiting order assigned:", order.orderId, "->", tech.name);
    }
  } catch(e){ console.error("checkWaitingQueue:", e?.message); }
}
setInterval(checkWaitingQueue, 2*60*1000); // every 2 minutes

// ── Admin endpoint to manually trigger queue check ────────────────────────────
app.post("/admin/check-queue", async(req,res)=>{
  await checkWaitingQueue();
  res.json({success:true});
});

app.listen(process.env.PORT||3000,()=>console.log("✅ TAQA Bot running"));
