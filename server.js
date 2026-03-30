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
    welcome:        "أهلاً وسهلاً! اختر الخدمة المطلوبة 👇\nأو أرسل *حالة* لمتابعة طلب",
    chooseService:  "الخدمات المتاحة",
    servicesBtn:    "الخدمات",
    chooseType:     "اختر النوع",
    typesBtn:       "الأنواع",
    chooseParts:    "اختر القطع المطلوبة (يمكنك اختيار أكثر من قطعة)",
    partsBtn:       "القطع",
    noParts:        "لا توجد قطع لهذه الخدمة، سيتم المتابعة بدون قطع.",
    partAdded:      (n,q) => `✅ تمت إضافة: ${n} × ${q}`,
    currentParts:   (l) => `🛒 القطع المختارة:\n${l}\n\nأرسل *تأكيد* للمتابعة أو اختر قطعة أخرى.`,
    noneSelected:   "لم تختر أي قطع. أرسل *تأكيد* للمتابعة بدون قطع.",
    couponPrompt:   "🎟 هل لديك كوبون خصم؟ أرسله الآن أو أرسل *تخطي* للمتابعة.",
    couponValid:    (c,d,t) => `✅ كوبون "${c}" مقبول!\n💸 الخصم: ${d} OMR\n💰 الإجمالي: ${t} OMR`,
    couponInvalid:  "❌ الكوبون غير صالح أو منتهي. أرسل *تخطي* للمتابعة.",
    couponUsed:     "❌ هذا الكوبون تم استخدامه مسبقاً.",
    confirmTitle:   (s,t,p,total,d) =>
      `📋 ملخص الطلب\n🔧 ${s}\n📌 ${t}\n\n${p}${d?`\n🎟 خصم: -${d} OMR`:""}\n\n💰 الإجمالي: ${total} OMR`,
    confirmBtn:     "الإجراء",
    confirmRow:     "تأكيد الطلب",
    cancelRow:      "إلغاء",
    cancelled:      "تم إلغاء الطلب. أرسل *مرحبا* للبدء.",
    sendLocation:   "📍 أرسل موقعك الحالي لإتمام الطلب.",
    locationOnly:   "يرجى إرسال موقعك باستخدام ميزة الموقع في واتساب.",
    sessionExpired: "انتهت الجلسة. أرسل *مرحبا* للبدء.",
    noTech:         (region) => `⚠️ لا يوجد فني متاح في ${region||"منطقتك"} الآن. حاول لاحقاً.`,
    noRegion:       "⚠️ منطقتك غير مخدومة حالياً. سيتم التواصل معك قريباً.",
    regionDetected: (r) => `📍 تم تحديد موقعك في: *${r}*`,
    orderSent:      (id) => `✅ تم إرسال طلبك!\n🆔 ${id}\nسيتم إشعارك عند القبول.\n\nلمتابعة طلبك أرسل: *حالة ${id}*`,
    activeOrder:    (id,s,st) => `لديك طلب نشط:\n🆔 ${id}\n🔧 ${s}\nالحالة: ${statusLabel(st,"ar")}`,
    serviceNotFound:"الخدمة غير موجودة. أرسل *مرحبا* للبدء.",
    typeError:      "خطأ. أرسل *مرحبا* للبدء.",
    defaultMsg:     "أرسل *مرحبا* للبدء.\nأو أرسل *حالة [رقم الطلب]* للتتبع.",
    techInfo:       (n,p,r,b,a,reg) =>
      `👤 ${n}\n📞 ${p}\n📍 ${reg||"-"}\n⭐ ${r||"لا يوجد"}\n💰 ${b||0} OMR\n🟢 ${a?"متاح":"مشغول"}`,
    newOrder:       (id,s,t,p,total,region) =>
      `🔔 طلب جديد!\n🆔 ${id}\n📍 ${region||"-"}\n🔧 ${s}\n📋 ${t}\n\n${p}\n\n💰 ${total} OMR`,
    acceptOrder:    "هل تقبل هذا الطلب؟",
    acceptBtn:      "اختر",
    acceptRow:      "قبول الطلب",
    rejectRow:      "رفض الطلب",
    customerPhone:  (p) => `📞 هاتف العميل: ${p}`,
    orderDoneBtn:   "إنهاء",
    orderDoneRow:   "إنهاء الطلب",
    orderDoneLabel: (id) => `${id} - اضغط عند الإنهاء`,
    accepted:       (n,p) => `✅ تم قبول طلبك!\n👨‍🔧 الفني: ${n}\n📞 ${p}\nفي الطريق إليك.`,
    rejected:       (id) => `❌ رفض الفني طلبك.\n🆔 ${id}\nجارٍ البحث عن فني آخر...`,
    noBackupTech:   (id) => `❌ لا يوجد فني متاح.\n🆔 ${id}\nأرسل *مرحبا* للمحاولة مجدداً.`,
    techRejected:   "تم رفض الطلب.",
    orderNotFound:  "الطلب غير موجود.",
    alreadyProcessed:"الطلب تمت معالجته.",
    alreadyDone:    "الطلب مكتمل مسبقاً.",
    completed:      (id) => `✅ اكتمل طلبك!\n🆔 ${id}\nشكراً لثقتك بنا! 🙏`,
    techDone:       (id,fee,bal) => `✅ الطلب ${id} مكتمل.\n💸 العمولة: ${fee} OMR\n💰 رصيدك: ${bal} OMR`,
    ratePrompt:     "⭐ كيف تقيّم خدمة الفني؟",
    rateBtn:        "التقييم",
    ratingDone:     (s) => `شكراً! منحت الفني ${s} ⭐`,
    invoiceCaption: (id) => `📄 فاتورة الطلب ${id}`,
    finalInvoice:   (id) => `📄 الفاتورة النهائية ${id}`,
    qtyPrompt:      (n) => `كم عدد قطع "${n}"؟ أرسل رقماً`,
    invalidQty:     "يرجى إرسال رقم صحيح.",
    chooseMore:     "اختر قطعة أخرى أو أرسل *تأكيد*.",
    trackPrompt:    "🔍 أرسل رقم الطلب. مثال: *حالة ORD-XXXXXXXX*",
    trackResult:    (o) =>
      `📋 تفاصيل الطلب\n🆔 ${o.orderId}\n📍 ${o.region||"-"}\n🔧 ${o.serviceName}\n📌 ${o.type||""}\n💰 ${o.totalPrice||o.price||0} OMR\n📊 ${statusLabel(o.status,"ar")}\n📅 ${o.createdAt?new Date(o.createdAt.seconds*1000).toLocaleDateString("ar-OM"):"-"}`,
    trackNotFound:  "❌ لم يتم العثور على طلب بهذا الرقم.",
  },
  en: {
    welcome:        "Welcome! Choose a service 👇\nOr send *status* to track an order",
    chooseService:  "Available Services",
    servicesBtn:    "Services",
    chooseType:     "Choose Type",
    typesBtn:       "Types",
    chooseParts:    "Choose required parts (you can select multiple)",
    partsBtn:       "Parts",
    noParts:        "No parts available. Continuing without parts.",
    partAdded:      (n,q) => `✅ Added: ${n} × ${q}`,
    currentParts:   (l) => `🛒 Selected parts:\n${l}\n\nSend *confirm* to proceed or choose another part.`,
    noneSelected:   "No parts selected. Send *confirm* to proceed without parts.",
    couponPrompt:   "🎟 Do you have a discount coupon? Send it or send *skip* to continue.",
    couponValid:    (c,d,t) => `✅ Coupon "${c}" applied!\n💸 Discount: ${d} OMR\n💰 Total: ${t} OMR`,
    couponInvalid:  "❌ Invalid or expired coupon. Send *skip* to continue.",
    couponUsed:     "❌ This coupon has already been used.",
    confirmTitle:   (s,t,p,total,d) =>
      `📋 Order Summary\n🔧 ${s}\n📌 ${t}\n\n${p}${d?`\n🎟 Discount: -${d} OMR`:""}\n\n💰 Total: ${total} OMR`,
    confirmBtn:     "Action",
    confirmRow:     "Confirm Order",
    cancelRow:      "Cancel",
    cancelled:      "Order cancelled. Send *mrhba* to start again.",
    sendLocation:   "📍 Please send your location to complete the order.",
    locationOnly:   "Please send your location using the WhatsApp location feature.",
    sessionExpired: "Session expired. Send *mrhba* to start.",
    noTech:         (region) => `⚠️ No technician available in ${region||"your area"} now. Try again later.`,
    noRegion:       "⚠️ Your area is not covered yet. We'll contact you soon.",
    regionDetected: (r) => `📍 Your location detected: *${r}*`,
    orderSent:      (id) => `✅ Order sent!\n🆔 ${id}\nYou'll be notified when accepted.\n\nTrack: *status ${id}*`,
    activeOrder:    (id,s,st) => `Active order:\n🆔 ${id}\n🔧 ${s}\nStatus: ${statusLabel(st,"en")}`,
    serviceNotFound:"Service not found. Send *mrhba* to start.",
    typeError:      "Error. Send *mrhba* to restart.",
    defaultMsg:     "Send *mrhba* to start.\nOr send *status [order ID]* to track.",
    techInfo:       (n,p,r,b,a,reg) =>
      `👤 ${n}\n📞 ${p}\n📍 ${reg||"-"}\n⭐ ${r||"N/A"}\n💰 ${b||0} OMR\n🟢 ${a?"Available":"Busy"}`,
    newOrder:       (id,s,t,p,total,region) =>
      `🔔 New Order!\n🆔 ${id}\n📍 ${region||"-"}\n🔧 ${s}\n📋 ${t}\n\n${p}\n\n💰 ${total} OMR`,
    acceptOrder:    "Do you accept this order?",
    acceptBtn:      "Choose",
    acceptRow:      "Accept Order",
    rejectRow:      "Reject Order",
    customerPhone:  (p) => `📞 Customer: ${p}`,
    orderDoneBtn:   "Finish",
    orderDoneRow:   "Mark as Done",
    orderDoneLabel: (id) => `${id} - Mark when finished`,
    accepted:       (n,p) => `✅ Order accepted!\n👨‍🔧 ${n}\n📞 ${p}\nOn the way!`,
    rejected:       (id) => `❌ Technician rejected.\n🆔 ${id}\nSearching for another...`,
    noBackupTech:   (id) => `❌ No technician available.\n🆔 ${id}\nSend *mrhba* to try again.`,
    techRejected:   "Order rejected.",
    orderNotFound:  "Order not found.",
    alreadyProcessed:"Already processed.",
    alreadyDone:    "Already completed.",
    completed:      (id) => `✅ Order completed!\n🆔 ${id}\nThank you! 🙏`,
    techDone:       (id,fee,bal) => `✅ Order ${id} done.\n💸 Fee: ${fee} OMR\n💰 Balance: ${bal} OMR`,
    ratePrompt:     "⭐ How would you rate the technician?",
    rateBtn:        "Rate",
    ratingDone:     (s) => `Thanks! You gave ${s} ⭐`,
    invoiceCaption: (id) => `📄 Invoice for Order ${id}`,
    finalInvoice:   (id) => `📄 Final Invoice ${id}`,
    qtyPrompt:      (n) => `How many "${n}"? Send a number`,
    invalidQty:     "Please send a valid number.",
    chooseMore:     "Choose another part or send *confirm*.",
    trackPrompt:    "🔍 Send your order ID. Example: *status ORD-XXXXXXXX*",
    trackResult:    (o) =>
      `📋 Order Details\n🆔 ${o.orderId}\n📍 ${o.region||"-"}\n🔧 ${o.serviceName}\n📌 ${o.type||""}\n💰 ${o.totalPrice||o.price||0} OMR\n📊 ${statusLabel(o.status,"en")}\n📅 ${o.createdAt?new Date(o.createdAt.seconds*1000).toLocaleDateString("en-OM"):"-"}`,
    trackNotFound:  "❌ No order found with this ID.",
  }
};

function statusLabel(s,l){return({ar:{pending:"قيد الانتظار",accepted:"مقبول",done:"مكتمل",rejected:"مرفوض"},en:{pending:"Pending",accepted:"Accepted",done:"Done",rejected:"Rejected"}}[l]||{})[s]||s;}
function getLang(session){return session?.data?.lang||"ar";}
function L(session){return LANGS[getLang(session)];}

// ─── Session ──────────────────────────────────────────────────────────────────
async function getSession(p){const d=await db.collection("sessions").doc(p).get();return d.exists?d.data():{state:null,data:{}};}
async function setSession(p,state,data){await db.collection("sessions").doc(p).set({state,data:data||{}});}
async function clearSession(p){await db.collection("sessions").doc(p).delete();}
function generateOrderId(){return "ORD-"+uuidv4().split("-")[0].toUpperCase();}

// ─── WhatsApp Senders ─────────────────────────────────────────────────────────
async function sendMessage(to,text){
  try{await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,{messaging_product:"whatsapp",to,text:{body:text}},{headers:{Authorization:`Bearer ${WHATSAPP_TOKEN}`,"Content-Type":"application/json"}});}
  catch(e){console.error("sendMsg:",e?.message);}
}
async function sendList(to,body,button,sections){
  try{await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,{messaging_product:"whatsapp",to,type:"interactive",interactive:{type:"list",body:{text:body},action:{button,sections}}},{headers:{Authorization:`Bearer ${WHATSAPP_TOKEN}`,"Content-Type":"application/json"}});}
  catch(e){console.error("sendList:",e?.message);}
}
async function sendButtons(to, body, buttons) {
  // WhatsApp supports max 3 buttons
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp", to, type: "interactive",
        interactive: {
          type: "button",
          body: { text: body },
          action: {
            buttons: buttons.slice(0, 3).map((b, i) => ({
              type: "reply",
              reply: { id: b.id, title: b.title.substring(0, 20) }
            }))
          }
        }
      },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch(e) { console.error("sendButtons:", e?.message); }
}

async function sendLocation(to,lat,lng){
  try{await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,{messaging_product:"whatsapp",to,type:"location",location:{latitude:lat,longitude:lng}},{headers:{Authorization:`Bearer ${WHATSAPP_TOKEN}`,"Content-Type":"application/json"}});}
  catch(e){console.error("sendLoc:",e?.message);}
}
async function sendDocument(to,buf,filename,caption){
  try{
    const FormData=require("form-data"),form=new FormData();
    form.append("file",buf,{filename,contentType:"application/pdf"});
    form.append("messaging_product","whatsapp");
    const up=await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/media`,form,{headers:{Authorization:`Bearer ${WHATSAPP_TOKEN}`,...form.getHeaders()}});
    await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,{messaging_product:"whatsapp",to,type:"document",document:{id:up.data.id,filename,caption}},{headers:{Authorization:`Bearer ${WHATSAPP_TOKEN}`,"Content-Type":"application/json"}});
  }catch(e){console.error("sendDoc:",e?.message);}
}

// ─── Region Detection (from GPS) ──────────────────────────────────────────────
async function detectRegion(lat, lng) {
  try {
    // Fetch all regions from Firestore
    const snap = await db.collection("regions").get();
    if (snap.empty) return null;
    const regions = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Find region by bounding box (simple polygon check)
    for (const region of regions) {
      if (!region.active) continue;
      // Support bounding box: { minLat, maxLat, minLng, maxLng }
      if (region.minLat && region.maxLat && region.minLng && region.maxLng) {
        if (lat >= region.minLat && lat <= region.maxLat &&
            lng >= region.minLng && lng <= region.maxLng) {
          return region;
        }
      }
      // Support center + radius (km)
      if (region.centerLat && region.centerLng && region.radiusKm) {
        const dist = haversine(lat, lng, region.centerLat, region.centerLng);
        if (dist <= region.radiusKm) return region;
      }
    }
    return null;
  } catch(e) { console.error("detectRegion:", e?.message); return null; }
}

function haversine(lat1, lng1, lat2, lng2) {
  const R  = 6371;
  const dL = (lat2-lat1)*Math.PI/180;
  const dN = (lng2-lng1)*Math.PI/180;
  const a  = Math.sin(dL/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dN/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ─── PDF ──────────────────────────────────────────────────────────────────────
function generateInvoicePDF(order, lang) {
  return new Promise((resolve) => {
    const doc=new PDFDocument({margin:40,size:"A4"});
    const chunks=[];
    doc.on("data",d=>chunks.push(d));
    doc.on("end",()=>resolve(Buffer.concat(chunks)));
    const isAr=lang==="ar";
    doc.rect(0,0,595,80).fill("#0a0e1a");
    doc.fillColor("#f59e0b").fontSize(28).font("Helvetica-Bold").text("TAQA",40,20);
    doc.fillColor("#ffffff").fontSize(11).font("Helvetica").text(isAr?"فاتورة خدمة":"Service Invoice",40,52);
    doc.fillColor("#64748b").text(new Date().toLocaleDateString(isAr?"ar-OM":"en-OM"),400,52,{align:"right"});
    doc.fillColor("#1a2235").rect(0,82,595,70).fill();
    doc.fillColor("#f1f5f9").fontSize(10).font("Helvetica-Bold");
    doc.text(isAr?"رقم الطلب":"Order ID",40,100);
    doc.text(isAr?"المنطقة":"Region",200,100);
    doc.text(isAr?"الخدمة":"Service",370,100);
    doc.fillColor("#f59e0b").fontSize(11).font("Helvetica").text(order.orderId,40,118);
    doc.fillColor("#f1f5f9").text(order.region||"-",200,118).text(order.serviceName,370,118);
    let y=170;
    doc.fillColor("#64748b").fontSize(9).font("Helvetica-Bold");
    doc.text(isAr?"القطعة/الخدمة":"Item",40,y);
    doc.text(isAr?"الكمية":"Qty",330,y,{width:60,align:"center"});
    doc.text(isAr?"السعر":"Price",400,y,{width:80,align:"right"});
    doc.text(isAr?"الإجمالي":"Total",490,y,{width:65,align:"right"});
    y+=18;doc.rect(40,y,515,1).fill("#1e2d45");y+=8;
    doc.fillColor("#f1f5f9").fontSize(10).font("Helvetica");
    doc.text(`${order.serviceName} — ${order.type||""}`,40,y,{width:280});
    doc.text("1",330,y,{width:60,align:"center"});
    doc.text(`${order.servicePrice||0}`,400,y,{width:80,align:"right"});
    doc.text(`${order.servicePrice||0}`,490,y,{width:65,align:"right"});
    y+=22;
    (order.parts||[]).forEach(p=>{
      const lt=(p.price*p.qty).toFixed(3);
      doc.text(p.name,40,y,{width:280});
      doc.text(String(p.qty),330,y,{width:60,align:"center"});
      doc.text(`${p.price}`,400,y,{width:80,align:"right"});
      doc.text(lt,490,y,{width:65,align:"right"});
      y+=20;if(y>700){doc.addPage();y=40;}
    });
    y+=10;doc.rect(40,y,515,1).fill("#1e2d45");y+=12;
    const sub=(order.parts||[]).reduce((s,p)=>s+p.price*p.qty,0)+(order.servicePrice||0);
    const disc=order.discount||0;
    const afterD=sub-disc;
    const vat=Math.round(afterD*0.05*1000)/1000;
    const total=Math.round((afterD+vat)*1000)/1000;
    doc.fillColor("#64748b").fontSize(10);
    doc.text(isAr?"المجموع":"Subtotal",350,y);
    doc.fillColor("#f1f5f9").text(`${sub.toFixed(3)} OMR`,490,y,{width:65,align:"right"});y+=18;
    if(disc>0){doc.fillColor("#10b981").text(isAr?"خصم":"Discount",350,y);doc.text(`-${disc.toFixed(3)} OMR`,490,y,{width:65,align:"right"});y+=18;}
    doc.fillColor("#64748b").text(isAr?"ضريبة (5%)":"VAT (5%)",350,y);
    doc.fillColor("#f1f5f9").text(`${vat.toFixed(3)} OMR`,490,y,{width:65,align:"right"});y+=18;
    doc.fillColor("#f59e0b").rect(340,y,215,30).fill();
    doc.fillColor("#000").fontSize(12).font("Helvetica-Bold");
    doc.text(isAr?"الإجمالي":"Total",355,y+8);
    doc.text(`${total.toFixed(3)} OMR`,490,y+8,{width:65,align:"right"});
    doc.fillColor("#111827").rect(0,780,595,60).fill();
    doc.fillColor("#64748b").fontSize(8).text("TAQA Services — Oman",40,800,{align:"center",width:515});
    doc.end();
  });
}

// ─── Coupon ───────────────────────────────────────────────────────────────────
async function validateCoupon(code,userId){
  const snap=await db.collection("coupons").where("code","==",code.toUpperCase()).limit(1).get();
  if(snap.empty)return{valid:false,reason:"invalid"};
  const doc=snap.docs[0],d=doc.data();
  if(!d.active)return{valid:false,reason:"invalid"};
  if(d.expiresAt&&d.expiresAt.toDate()<new Date())return{valid:false,reason:"invalid"};
  if(d.usedBy&&d.usedBy.includes(userId))return{valid:false,reason:"used"};
  if(d.maxUses&&(d.useCount||0)>=d.maxUses)return{valid:false,reason:"invalid"};
  return{valid:true,id:doc.id,discount:d.discount||0,type:d.type||"fixed",code:d.code};
}
async function applyCoupon(id,userId){
  const ref=db.collection("coupons").doc(id);
  await db.runTransaction(async tx=>{const s=await tx.get(ref);tx.update(ref,{useCount:(s.data().useCount||0)+1,usedBy:admin.firestore.FieldValue.arrayUnion(userId)});});
}

// ─── Parts ────────────────────────────────────────────────────────────────────
async function getPartsByService(serviceId){const snap=await db.collection("parts").where("serviceId","==",serviceId).get();return snap.docs.map(d=>({id:d.id,...d.data()}));}
function buildPartsText(parts){if(!parts||!parts.length)return"-";return parts.map(p=>`• ${p.name} × ${p.qty} = ${(p.price*p.qty).toFixed(3)} OMR`).join("\n");}
function calcTotal(o){return Math.round(((o.parts||[]).reduce((s,p)=>s+p.price*p.qty,0)+(o.servicePrice||0))*1000)/1000;}

// ─── DB Helpers ───────────────────────────────────────────────────────────────
async function getServices(){const snap=await db.collection("services").get();return snap.docs.map(d=>({id:d.id,...d.data()}));}
async function getTechByPhone(phone){const snap=await db.collection("technicians").where("phone","==",normalize(phone)).get();if(snap.empty)return null;return{id:snap.docs[0].id,...snap.docs[0].data()};}
async function getAvailableTechs(serviceId,regionId){
  let q=db.collection("technicians").where("active","==",true).where("services","array-contains",serviceId);
  if(regionId)q=q.where("regionId","==",regionId);
  const snap=await q.get();
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}
async function getActiveOrder(phone){const snap=await db.collection("orders").where("customer","==",phone).where("status","in",["pending","accepted"]).limit(1).get();if(snap.empty)return null;return{id:snap.docs[0].id,...snap.docs[0].data()};}
async function updateTechRating(techId,stars){
  const ref=db.collection("technicians").doc(techId);
  await db.runTransaction(async tx=>{const s=await tx.get(ref);if(!s.exists)return;const d=s.data();const c=(d.ratingCount||0)+1;tx.update(ref,{rating:Math.round((((d.rating||0)*(c-1))+stars)/c*10)/10,ratingCount:c});});
}
async function sendRatingPrompt(to,orderId,lang){
  const rows=[1,2,3,4,5].map(s=>({id:`rate_${orderId}_${s}`,title:"⭐".repeat(s),description:lang==="ar"?["ضعيف","مقبول","جيد","جيد جداً","ممتاز"][s-1]:["Poor","Fair","Good","Very Good","Excellent"][s-1]}));
  await sendList(to,LANGS[lang].ratePrompt,LANGS[lang].rateBtn,[{title:lang==="ar"?"اختر تقييمك":"Choose Rating",rows}]);
}
async function sendPartsMenu(to,parts,Lx){
  const rows=parts.slice(0,10).map(p=>({id:"part_"+p.id,title:p.name.substring(0,24),description:`${p.price} OMR / ${p.unit||"قطعة"}`}));
  await sendList(to,Lx.chooseParts,Lx.partsBtn,[{title:Lx.partsBtn,rows}]);
}

// ─── Order Tracking ───────────────────────────────────────────────────────────
async function handleTracking(from,orderId,lang){
  const Lx=LANGS[lang],clean=orderId.toUpperCase().replace(/\s/g,"");
  let snap=await db.collection("orders").doc(clean).get();
  if(!snap.exists){const q=await db.collection("orders").where("orderId","==",clean).limit(1).get();if(q.empty){await sendMessage(from,Lx.trackNotFound);return;}snap=q.docs[0];}
  await sendMessage(from,Lx.trackResult({...(snap.data?snap.data():{...snap}),orderId:clean}));
}

// ─── goToConfirm ─────────────────────────────────────────────────────────────
async function goToConfirm(from,session,Lx,discount){
  const svc=session.data.service,type=session.data.selectedType,parts=session.data.parts||[];
  const raw=calcTotal({servicePrice:session.data.servicePrice,parts});
  const total=Math.max(0,Math.round((raw-discount)*1000)/1000);
  const ptxt=parts.length?parts.map(p=>`• ${p.name} × ${p.qty} = ${(p.price*p.qty).toFixed(3)} OMR`).join("\n"):"-";
  await setSession(from,"confirm",{...session.data,discount});
  await sendList(from,Lx.confirmTitle(svc.name,type.name,ptxt,total,discount>0?discount:null),Lx.confirmBtn,[{title:Lx.confirmBtn,rows:[{id:"yes",title:Lx.confirmRow},{id:"no",title:Lx.cancelRow}]}]);
}

// ─── Webhook ──────────────────────────────────────────────────────────────────
app.get("/webhook",(req,res)=>{if(req.query["hub.verify_token"]===VERIFY_TOKEN)return res.send(req.query["hub.challenge"]);res.sendStatus(403);});

app.post("/webhook",async(req,res)=>{
  res.sendStatus(200);
  try{
    const val=req.body.entry?.[0]?.changes?.[0]?.value;
    if(!val?.messages?.[0])return;
    const msg=val.messages[0],from=normalize(msg.from);
    let text="";
    if(msg.type==="text")text=msg.text.body.trim();
    else if(msg.type==="interactive")text=msg.interactive.list_reply?.id||msg.interactive.button_reply?.id||"";
    console.log("FROM:",from,"TEXT:",text);

    // ── Tech ──────────────────────────────────────────────────────────────
    const tech=await getTechByPhone(from);
    if(tech){
      if(text.startsWith("accept_")){await handleAccept(text,from,tech);return;}
      if(text.startsWith("reject_")){await handleReject(text,from);return;}
      if(text.startsWith("done_")){await handleDone(text,from,tech);return;}
      await sendMessage(from,LANGS.ar.techInfo(tech.name,tech.phone,tech.rating?`${tech.rating}(${tech.ratingCount||0})`:null,tech.balance,tech.active,tech.regionName||tech.regionId));
      return;
    }

    // ── Rating ────────────────────────────────────────────────────────────
    if(text.startsWith("rate_")){
      const pts=text.split("_"),stars=parseInt(pts[pts.length-1]),orderId=pts.slice(1,-1).join("_");
      if(!isNaN(stars)&&stars>=1&&stars<=5&&orderId){
        const os=await db.collection("orders").doc(orderId).get();
        if(os.exists){await updateTechRating(os.data().technicianId,stars);await db.collection("orders").doc(orderId).update({rating:stars});}
        const ses=await getSession(from);await sendMessage(from,LANGS[getLang(ses)].ratingDone(stars));
      }return;
    }

    // ── Tracking ──────────────────────────────────────────────────────────
    const trAr=text.match(/^حالة\s+(.+)/i),trEn=text.match(/^status\s+(.+)/i);
    if(trAr){await handleTracking(from,trAr[1],"ar");return;}
    if(trEn){await handleTracking(from,trEn[1],"en");return;}
    if(text==="حالة"||text.toLowerCase()==="status"){const s=await getSession(from);await sendMessage(from,LANGS[getLang(s)].trackPrompt);return;}

    // ── Session ───────────────────────────────────────────────────────────
    let session=await getSession(from);
    const isStartAr=["مرحبا","هلا","مرحبً"].includes(text);
    const isStartEn=["mrhba","hello","hi"].includes(text.toLowerCase());
    const isStart=isStartAr||isStartEn;
    const lang=isStartAr?"ar":isStartEn?"en":null;

    // ── START ─────────────────────────────────────────────────────────────
    if(!session.state||isStart){
      const al=lang||getLang(session)||"ar",Lx=LANGS[al];
      const ao=await getActiveOrder(from);
      if(ao){await sendMessage(from,Lx.activeOrder(ao.orderId,ao.serviceName,ao.status));return;}
      await clearSession(from);
      const services=await getServices();
      await sendList(from,Lx.welcome,Lx.servicesBtn,[{title:Lx.chooseService,rows:services.map(s=>({id:"service_"+s.id,title:s.name.substring(0,24)}))}]);
      await setSession(from,"main",{lang:al});
      return;
    }

    const Lx=L(session);

    // ── main ──────────────────────────────────────────────────────────────
    if(session.state==="main"&&text.startsWith("service_")){
      const services=await getServices();
      const service=services.find(s=>s.id===text.replace("service_",""));
      if(!service){await sendMessage(from,Lx.serviceNotFound);return;}
      await setSession(from,"type",{...session.data,service});
      await sendList(from,`${service.name}\n${Lx.chooseType}`,Lx.typesBtn,[{title:Lx.chooseType,rows:service.types.map((t,i)=>({id:"type_"+i,title:t.name.substring(0,24),description:`${t.price} OMR`}))}]);
      return;
    }

    // ── type ──────────────────────────────────────────────────────────────
    if(session.state==="type"&&text.startsWith("type_")){
      const idx=parseInt(text.replace("type_",""));
      const service=session.data?.service;
      if(!service||isNaN(idx)||!service.types?.[idx]){await sendMessage(from,Lx.typeError);await clearSession(from);return;}
      const type=service.types[idx];
      const parts=await getPartsByService(service.id);
      if(!parts.length){await setSession(from,"coupon",{...session.data,selectedType:type,parts:[],servicePrice:type.price});await sendMessage(from,Lx.couponPrompt);}
      else{await setSession(from,"parts",{...session.data,selectedType:type,parts:[],servicePrice:type.price,availableParts:parts});await sendMessage(from,Lx.chooseParts);await sendPartsMenu(from,parts,Lx);}
      return;
    }

    // ── parts ─────────────────────────────────────────────────────────────
    if(session.state==="parts"){
      const ap=session.data.availableParts||[],sp=session.data.parts||[],ppId=session.data.pendingPartId;
      if(ppId){
        const qty=parseInt(text);
        if(isNaN(qty)||qty<1){await sendMessage(from,Lx.invalidQty);return;}
        const part=ap.find(p=>p.id===ppId);
        if(part){const ex=sp.find(p=>p.id===ppId);if(ex)ex.qty+=qty;else sp.push({id:part.id,name:part.name,price:part.price,unit:part.unit||"قطعة",qty});await sendMessage(from,Lx.partAdded(part.name,qty));}
        await setSession(from,"parts",{...session.data,parts:sp,pendingPartId:null});
        await sendMessage(from,sp.length?Lx.currentParts(sp.map(p=>`• ${p.name} × ${p.qty} — ${(p.price*p.qty).toFixed(3)} OMR`).join("\n")):Lx.noneSelected);
        await sendPartsMenu(from,ap,Lx);return;
      }
      if(text==="تأكيد"||text.toLowerCase()==="confirm"){await setSession(from,"coupon",{...session.data,parts:sp});await sendMessage(from,Lx.couponPrompt);return;}
      if(text.startsWith("part_")){const part=ap.find(p=>p.id===text.replace("part_",""));if(part){await setSession(from,"parts",{...session.data,pendingPartId:part.id});await sendMessage(from,Lx.qtyPrompt(part.name));}return;}
      await sendMessage(from,Lx.chooseMore);return;
    }

    // ── coupon ────────────────────────────────────────────────────────────
    if(session.state==="coupon"){
      if(["تخطي","skip","لا","no","بدون"].includes(text.toLowerCase())){await goToConfirm(from,session,Lx,0);return;}
      const res=await validateCoupon(text,from);
      if(!res.valid){await sendMessage(from,res.reason==="used"?Lx.couponUsed:Lx.couponInvalid);return;}
      const raw=calcTotal({servicePrice:session.data.servicePrice,parts:session.data.parts});
      const disc=res.type==="percent"?Math.round(raw*res.discount/100*1000)/1000:res.discount;
      const ft=Math.max(0,Math.round((raw-disc)*1000)/1000);
      await sendMessage(from,Lx.couponValid(res.code,disc,ft));
      await setSession(from,"coupon",{...session.data,couponId:res.id,couponCode:res.code,discount:disc});
      await goToConfirm(from,{...session,data:{...session.data,couponId:res.id,couponCode:res.code,discount:disc}},Lx,disc);
      return;
    }

    // ── confirm ───────────────────────────────────────────────────────────
    if(session.state==="confirm"){
      if(text==="no"){await clearSession(from);await sendMessage(from,Lx.cancelled);return;}
      if(text==="yes"){await setSession(from,"location",session.data);await sendMessage(from,Lx.sendLocation);return;}
    }

    // ── location ──────────────────────────────────────────────────────────
    if(session.state==="location"){
      if(msg.type!=="location"){await sendMessage(from,Lx.locationOnly);return;}
      const service=session.data?.service,selectedType=session.data?.selectedType,userLang=getLang(session);
      if(!service||!selectedType){await sendMessage(from,Lx.sessionExpired);await clearSession(from);return;}

      // Detect region from GPS
      const lat=msg.location.latitude,lng=msg.location.longitude;
      const region=await detectRegion(lat,lng);

      if(!region){await sendMessage(from,Lx.noRegion);await clearSession(from);return;}
      await sendMessage(from,Lx.regionDetected(region.name));

      // Get techs in this region
      let techs=await getAvailableTechs(service.id,region.id);
      if(!techs.length){
        // Fallback: try without region filter
        techs=await getAvailableTechs(service.id,null);
      }
      if(!techs.length){await sendMessage(from,Lx.noTech(region.name));await clearSession(from);return;}
      techs.sort((a,b)=>(b.rating||0)-(a.rating||0));
      const chosenTech=techs[0];

      const orderId=generateOrderId();
      const parts=session.data.parts||[];
      const rawTotal=calcTotal({servicePrice:session.data.servicePrice||selectedType.price,parts});
      const discount=session.data.discount||0;
      const totalPrice=Math.max(0,Math.round((rawTotal-discount)*1000)/1000);
      const partsText=buildPartsText(parts);

      await db.collection("orders").doc(orderId).set({
        orderId,customer:from,
        serviceName:service.name,serviceId:service.id,
        type:selectedType.name,servicePrice:session.data.servicePrice||selectedType.price,
        parts,totalPrice,discount,couponCode:session.data.couponCode||null,
        technicianId:chosenTech.id,rejectedTechs:[],
        regionId:region.id,region:region.name,
        status:"pending",lang:userLang,
        location:{latitude:lat,longitude:lng},
        createdAt:admin.firestore.FieldValue.serverTimestamp()
      });

      if(session.data.couponId)await applyCoupon(session.data.couponId,from);

      const techPhone=normalize(chosenTech.phone);
      await sendMessage(techPhone,LANGS.ar.newOrder(orderId,service.name,selectedType.name,partsText,totalPrice,region.name));
      await sendList(techPhone,LANGS.ar.acceptOrder,LANGS.ar.acceptBtn,[{title:"Order",rows:[{id:"accept_"+orderId,title:LANGS.ar.acceptRow},{id:"reject_"+orderId,title:LANGS.ar.rejectRow}]}]);

      await sendMessage(from,Lx.orderSent(orderId));
      const pdf=await generateInvoicePDF({orderId,customer:from,serviceName:service.name,type:selectedType.name,servicePrice:session.data.servicePrice||selectedType.price,parts,discount,region:region.name},userLang);
      await sendDocument(from,pdf,`invoice_${orderId}.pdf`,Lx.invoiceCaption(orderId));
      await clearSession(from);return;
    }

    await sendMessage(from,Lx.defaultMsg);
  }catch(err){console.error("WEBHOOK ERROR:",err);}
});

// ─── Tech Handlers ────────────────────────────────────────────────────────────
async function handleAccept(text,techPhone,tech){
  const orderId=text.replace("accept_",""),ref=db.collection("orders").doc(orderId);
  const snap=await ref.get();
  if(!snap.exists){await sendMessage(techPhone,LANGS.ar.orderNotFound);return;}
  const order=snap.data();
  if(order.status!=="pending"){await sendMessage(techPhone,LANGS.ar.alreadyProcessed);return;}
  await ref.update({status:"accepted"});
  await db.collection("technicians").doc(order.technicianId).update({active:false});
  const cPhone=normalize(order.customer),CL=LANGS[order.lang||"ar"];
  await sendMessage(techPhone,LANGS.ar.customerPhone(cPhone));
  if(order.location?.latitude)await sendLocation(techPhone,order.location.latitude,order.location.longitude);
  await sendList(techPhone,LANGS.ar.orderDoneLabel(orderId),LANGS.ar.orderDoneBtn,[{title:"Order",rows:[{id:"done_"+orderId,title:LANGS.ar.orderDoneRow}]}]);
  await sendMessage(cPhone,CL.accepted(tech.name,tech.phone));
}

async function handleReject(text,techPhone){
  const orderId=text.replace("reject_",""),ref=db.collection("orders").doc(orderId);
  const snap=await ref.get();
  if(!snap.exists){await sendMessage(techPhone,LANGS.ar.orderNotFound);return;}
  const order=snap.data();
  if(order.status!=="pending"){await sendMessage(techPhone,LANGS.ar.alreadyProcessed);return;}
  await sendMessage(techPhone,LANGS.ar.techRejected);
  const rejectedList=[...(order.rejectedTechs||[]),order.technicianId];
  await ref.update({status:"pending",rejectedTechs:rejectedList});
  const cPhone=normalize(order.customer),CL=LANGS[order.lang||"ar"];
  await sendMessage(cPhone,CL.rejected(orderId));
  // Find backup in same region first, then any region
  let techs=await getAvailableTechs(order.serviceId,order.regionId);
  techs=techs.filter(t=>!rejectedList.includes(t.id));
  if(!techs.length){
    let allTechs=await getAvailableTechs(order.serviceId,null);
    techs=allTechs.filter(t=>!rejectedList.includes(t.id));
  }
  if(!techs.length){await ref.update({status:"rejected"});await sendMessage(cPhone,CL.noBackupTech(orderId));return;}
  techs.sort((a,b)=>(b.rating||0)-(a.rating||0));
  const backup=techs[0];
  await ref.update({technicianId:backup.id});
  const bPhone=normalize(backup.phone),pt=buildPartsText(order.parts);
  await sendMessage(bPhone,LANGS.ar.newOrder(orderId,order.serviceName,order.type||"",pt,order.totalPrice,order.region));
  await sendList(bPhone,LANGS.ar.acceptOrder,LANGS.ar.acceptBtn,[{title:"Order",rows:[{id:"accept_"+orderId,title:LANGS.ar.acceptRow},{id:"reject_"+orderId,title:LANGS.ar.rejectRow}]}]);
}

async function handleDone(text,techPhone,tech){
  const orderId=text.replace("done_",""),ref=db.collection("orders").doc(orderId);
  const snap=await ref.get();
  if(!snap.exists){await sendMessage(techPhone,LANGS.ar.orderNotFound);return;}
  const order=snap.data();
  if(order.status==="done"){await sendMessage(techPhone,LANGS.ar.alreadyDone);return;}
  await ref.update({status:"done",completedAt:admin.firestore.FieldValue.serverTimestamp()});
  const tRef=db.collection("technicians").doc(order.technicianId);
  const tData=(await tRef.get()).data();
  const fee=Math.round(order.totalPrice*0.2*1000)/1000;
  const newBal=Math.max(0,Math.round(((tData?.balance||0)-fee)*1000)/1000);
  await tRef.update({balance:newBal,active:true});
  await sendMessage(techPhone,LANGS.ar.techDone(orderId,fee,newBal));
  const cPhone=normalize(order.customer),CL=LANGS[order.lang||"ar"];
  await sendMessage(cPhone,CL.completed(orderId));
  const pdf=await generateInvoicePDF(order,order.lang||"ar");
  await sendDocument(cPhone,pdf,`final_${orderId}.pdf`,CL.finalInvoice(orderId));
  await sendRatingPrompt(cPhone,orderId,order.lang||"ar");
}

app.listen(process.env.PORT||3000,()=>console.log("✅ TAQA Bot running"));
