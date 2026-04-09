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
    welcome:        "أهلاً وسهلاً! 👋\nاختر الخدمة المطلوبة:",
    chooseService:  "الخدمات المتاحة",
    servicesBtn:    "الخدمات",
    chooseType:     (name) => `🔧 *${name}*\nاختر نوع الخدمة:`,
    typesBtn:       "الأنواع",
    chooseParts:    "🔩 اختر القطع المطلوبة\n(أرسل رقم القطعة، يمكنك اختيار أكثر من قطعة):",
    partsMenu:      (parts) => parts.map((p,i)=>`${i+1}. ${p.name} — ${(parseFloat(p.price)||0).toFixed(3)} OMR / ${p.unit||"قطعة"}${p.stock!==undefined?` (متوفر: ${p.stock})`:""}`).join("\n") + "\n\n0 — متابعة بدون قطع",
    partAdded:      (name, qty, total) => `✅ تمت إضافة: *${name}* × ${qty}\nإجمالي القطع: ${total.toFixed(3)} OMR\n\nأرسل رقم قطعة أخرى أو *0* للمتابعة.`,
    qtyPrompt:      (name, price, stock, maxQty) => { const fmt=n=>(parseFloat(n)||0).toFixed(3); const rows=[]; const max=maxQty||5; for(let i=1;i<=max;i++) rows.push(`${i} — ${i} قطعة × ${fmt(price)} = ${fmt(i*parseFloat(price))} OMR`); return `🔩 *${name}*\nاختر الكمية:\n\n${rows.join('\n')}${stock!==undefined?`\n\nالمتوفر: ${stock} قطعة`:''}`; },
    invalidInput:   "يرجى إرسال رقم صحيح.",
    invalidPart:    (max) => `يرجى إرسال رقم بين 0 و ${max}.`,
    outOfStock:     (name, stock) => `⚠️ عذراً، *${name}* متوفر ${stock} فقط. أرسل رقماً أقل أو 0 للمتابعة.`,
    couponPrompt:   "🎟 هل لديك كوبون خصم؟\nأرسل الكود أو *0* للمتابعة بدون خصم.",
    couponValid:    (code, disc, total) => `✅ كوبون *${code}* مقبول!\n💸 الخصم: ${disc.toFixed(3)} OMR\n💰 الإجمالي بعد الخصم: ${total.toFixed(3)} OMR`,
    couponInvalid:  "❌ الكوبون غير صالح أو منتهي.\nأرسل *0* للمتابعة.",
    couponUsed:     "❌ هذا الكوبون استُخدم مسبقاً.\nأرسل *0* للمتابعة.",
    confirmTitle:   (sName, tName, partsTxt, svcPrice, partsTotal, disc, total, totalQty) => {
      const fmt = n => (parseFloat(n)||0).toFixed(3);
      const svcLine = totalQty > 0
        ? `🔧 الخدمة: ${sName} — ${fmt(svcPrice)} OMR × ${totalQty} = ${fmt(svcPrice*totalQty)} OMR`
        : `🔧 الخدمة: ${sName} — ${fmt(svcPrice)} OMR`;
      return `📋 *ملخص الطلب*\n${svcLine}\n📌 النوع: ${tName}${partsTxt!=='-'?`\n\n🔩 القطع:\n${partsTxt}\n💡 إجمالي القطع: ${fmt(partsTotal)} OMR`:''}${disc?`\n\n🎟 الخصم: -${fmt(disc)} OMR`:''}\n\n💰 *الإجمالي: ${fmt(total)} OMR*`;
    },
    confirmYes:     "✅ تأكيد الطلب",
    confirmNo:      "❌ إلغاء",
    confirmed:      "✅ تم التأكيد!\n📍 أرسل موقعك الحالي لإتمام الطلب.",
    cancelled:      "❌ تم إلغاء الطلب.\nأرسل *مرحبا* للبدء من جديد.",
    locationOnly:   "📍 يرجى إرسال موقعك باستخدام ميزة الموقع في واتساب.",
    sessionExpired: "انتهت الجلسة. أرسل *مرحبا* للبدء.",
    noTech:         "📍 منطقتك ليست ضمن نطاق خدمتنا حالياً.\nسنقوم بتوسيع خدماتنا قريباً لمنطقتك.\nشكراً لتواصلك معنا! 🙏",
    noTechRegion:   (r) => `📍 منطقتك ليست ضمن نطاق خدمتنا حالياً.\nسنقوم بتوسيع خدماتنا قريباً لمنطقتك.\nشكراً لتواصلك معنا! 🙏`,
    noTechAny:      "⚠️ لا يوجد فني متاح الآن.\n\n📝 تم حفظ طلبك في قائمة الانتظار وسيتم إشعارك فور توفر فني.",
    techAvailableNotify: (id, techName) => `✅ *تم العثور على فني لطلبك!*\n🆔 ${id}\n👨‍🔧 الفني: ${techName}\nسيتواصل معك قريباً.`,
    cancelPrompt:   (id) => `هل تريد إلغاء الطلب *${id}*؟\nأرسل سبب الإلغاء أو *لا* للعودة.`,
    cancelDone:     (id, reason) => `تم إلغاء طلبك\n🆔 ${id}\nالسبب: ${reason}\nشكراً لتواصلك معنا.`,
    cancelNo:       "تم الإبقاء على طلبك. أرسل *مرحبا* للعودة.",
    regionDetected: (r) => `📍 تم تحديد موقعك في: *${r}*`,
    orderSent:      (id) => `✅ *تم إرسال طلبك!*\n🆔 رقم الطلب: ${id}\nسيتم إشعارك عند قبول الطلب.\n\nلمتابعة طلبك:\n*حالة ${id}*`,
    activeOrder:    (id, sName, status) => `لديك طلب نشط:\n🆔 ${id}\n🔧 ${sName}\nالحالة: ${statusLabel(status,"ar")}`,
    defaultMsg:     "أرسل *مرحبا* للبدء.\nأو *حالة [رقم الطلب]* للمتابعة.",
    techInfo:       (t) => `👤 الاسم: ${t.name}\n📞 الهاتف: ${t.phone}\n⭐ التقييم: ${t.rating?`${t.rating} (${t.ratingCount||0})`:"لا يوجد"}\n💰 الرصيد: ${(t.balance||0).toFixed(3)} OMR\n🟢 الحالة: ${t.active?"متاح":"مشغول"}\n📍 المنطقة: ${t.regionName||t.region||"غير محدد"}`,
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
    finalInvoice:   (id) => `📄 *فاتورة الطلب ${id}*\nيرجى مراجعة الفاتورة وإتمام الدفع للفني.`,
    waitingQueue:   (id) => `⏳ *تم تسجيل طلبك في قائمة الانتظار!*\n🆔 رقم الطلب: ${id}\n\nسيتم إشعارك فوراً عند توفر فني.\n\nلمتابعة طلبك:\n*حالة ${id}*`,
    techAvailable:  (id) => `✅ *تم توفر فني لطلبك!*\n🆔 ${id}\nجارٍ إرسال الطلب للفني...`,
    cancelPrompt:   (id) => `هل تريد إلغاء الطلب ${id}؟\nأرسل سبب الإلغاء أو أرسل *لا* للرجوع.`,
    cancelDone:     (id) => `✅ تم إلغاء الطلب ${id}.\nشكراً لك.`,
    cancelNo:       "تم الإبقاء على طلبك.",
    orderMenu:      (o) => `📋 *تفاصيل الطلب*\n🆔 ${o.orderId}\n🔧 ${o.serviceName}\n📌 ${o.type||""}\n💰 ${(o.totalPrice||0).toFixed(3)} OMR\n📊 الحالة: ${statusLabel(o.status,"ar")}\n📍 المنطقة: ${o.region||"-"}\n\nأرسل *إلغاء_${o.orderId}* لإلغاء الطلب.`,
    trackResult:    (o) => `📋 *تفاصيل الطلب*\n🆔 ${o.orderId}\n🔧 ${o.serviceName}\n📌 ${o.type||""}\n💰 ${(o.totalPrice||o.price||0).toFixed(3)} OMR\n📊 الحالة: ${statusLabel(o.status,"ar")}\n📍 المنطقة: ${o.region||"-"}\n📅 ${o.createdAt?new Date(o.createdAt.seconds*1000).toLocaleDateString("ar-OM"):"-"}`,
    trackNotFound:  "❌ لم يتم العثور على طلب بهذا الرقم.",
    trackPrompt:    "🔍 أرسل رقم الطلب:\nمثال: *حالة ORD-XXXXXXXX*",
    backBtn:        "↩️ رجوع",
    langChanged:    "✅ تم تغيير اللغة إلى العربية.",
    lowBalance:     (bal) => `⚠️ رصيدك الحالي: ${(bal||0).toFixed(3)} OMR\nالحد الأدنى للعمل هو *2.000 OMR*\n\nيرجى إعادة تعبئة الرصيد لتتمكن من استلام الطلبات.\n\n📞 تواصل مع الإدارة لإعادة التعبئة.`,
    rechargeNeeded: "🔴 حسابك موقوف بسبب انخفاض الرصيد. أعد تعبئة رصيدك للعودة للعمل.",
  },
  en: {
    welcome:        "Welcome! 👋\nChoose a service:",
    chooseService:  "Available Services",
    servicesBtn:    "Services",
    chooseType:     (name) => `🔧 *${name}*\nChoose service type:`,
    typesBtn:       "Types",
    chooseParts:    "🔩 Choose required parts\n(Send part number, you can choose multiple):",
    partsMenu:      (parts) => parts.map((p,i)=>`${i+1}. ${p.name} — ${(parseFloat(p.price)||0).toFixed(3)} OMR / ${p.unit||"piece"}${p.stock!==undefined?` (available: ${p.stock})`:""}`).join("\n") + "\n\n0 — Continue without parts",
    partAdded:      (name, qty, total) => `✅ Added: *${name}* × ${qty}\nParts total: ${total.toFixed(3)} OMR\n\nSend another number or *0* to continue.`,
    qtyPrompt:      (name, price, stock, maxQty) => { const fmt=n=>(parseFloat(n)||0).toFixed(3); const rows=[]; for(let i=1;i<=maxQty;i++) rows.push(`${i} — ${i} piece × ${fmt(price)} = ${fmt(i*parseFloat(price))} OMR`); return `🔩 *${name}*\nChoose quantity:\n\n${rows.join('\n')}${stock!==undefined?`\n\nAvailable: ${stock}`:''}`; },
    invalidInput:   "Please send a valid number.",
    invalidPart:    (max) => `Please send a number between 0 and ${max}.`,
    outOfStock:     (name, stock) => `⚠️ Sorry, only ${stock} *${name}* available. Send a smaller number or 0 to continue.`,
    couponPrompt:   "🎟 Do you have a coupon?\nSend the code or *0* to continue without discount.",
    couponValid:    (code, disc, total) => `✅ Coupon *${code}* applied!\n💸 Discount: ${disc.toFixed(3)} OMR\n💰 Total: ${total.toFixed(3)} OMR`,
    couponInvalid:  "❌ Invalid or expired coupon.\nSend *0* to continue.",
    couponUsed:     "❌ Coupon already used.\nSend *0* to continue.",
    confirmTitle:   (sName, tName, partsTxt, svcPrice, partsTotal, disc, total, totalQty) => {
      const fmt = n => (parseFloat(n)||0).toFixed(3);
      const svcLine = totalQty > 0
        ? `🔧 Service: ${sName} — ${fmt(svcPrice)} OMR × ${totalQty} = ${fmt(svcPrice*totalQty)} OMR`
        : `🔧 Service: ${sName} — ${fmt(svcPrice)} OMR`;
      return `📋 *Order Summary*\n${svcLine}\n📌 Type: ${tName}${partsTxt!=='-'?`\n\n🔩 Parts:\n${partsTxt}\n💡 Parts total: ${fmt(partsTotal)} OMR`:''}${disc?`\n\n🎟 Discount: -${fmt(disc)} OMR`:''}\n\n💰 *Grand Total: ${fmt(total)} OMR*`;
    },
    confirmYes:     "✅ Confirm Order",
    confirmNo:      "❌ Cancel",
    confirmed:      "✅ Confirmed!\n📍 Please send your location to complete the order.",
    cancelled:      "❌ Order cancelled.\nSend *mrhba* to start again.",
    locationOnly:   "📍 Please send your location using WhatsApp location feature.",
    sessionExpired: "Session expired. Send *mrhba* to start.",
    noTech:         "📍 Your area is not within our service coverage yet.\nWe will be expanding to your area soon.\nThank you for contacting us! 🙏",
    noTechRegion:   (r) => `📍 Your area is not within our service coverage yet.\nWe will be expanding to your area soon.\nThank you for contacting us! 🙏`,
    noTechAny:      "⚠️ No technician available now.\n\n📝 Your order has been saved in the waiting queue. You will be notified when a technician is available.",
    techAvailableNotify: (id, techName) => `✅ *A technician has been found for your order!*\n🆔 ${id}\n👨‍🔧 Tech: ${techName}\nThey will contact you shortly.`,
    cancelPrompt:   (id) => `Do you want to cancel order *${id}*?\nSend the reason or *no* to go back.`,
    cancelDone:     (id, reason) => `Order cancelled\n🆔 ${id}\nReason: ${reason}\nThank you for contacting us.`,
    cancelNo:       "Your order is still active. Send *mrhba* to return.",
    regionDetected: (r) => `📍 Your location detected in: *${r}*`,
    orderSent:      (id) => `✅ *Order sent!*\n🆔 Order ID: ${id}\nYou'll be notified when accepted.\n\nTrack your order:\n*status ${id}*`,
    activeOrder:    (id, sName, status) => `Active order:\n🆔 ${id}\n🔧 ${sName}\nStatus: ${statusLabel(status,"en")}`,
    defaultMsg:     "Send *mrhba* to start.\nOr *status [order ID]* to track.",
    techInfo:       (t) => `👤 Name: ${t.name}\n📞 Phone: ${t.phone}\n⭐ Rating: ${t.rating?`${t.rating} (${t.ratingCount||0})`:"N/A"}\n💰 Balance: ${(t.balance||0).toFixed(3)} OMR\n🟢 Status: ${t.active?"Available":"Busy"}\n📍 Region: ${t.regionName||t.region||"N/A"}`,
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
    finalInvoice:   (id) => `📄 *Invoice for Order ${id}*\nPlease review and complete payment to the technician.`,
    waitingQueue:   (id) => `⏳ *Your order is in the waiting queue!*\n🆔 Order ID: ${id}\n\nYou'll be notified as soon as a technician is available.\n\nTrack your order:\n*status ${id}*`,
    techAvailable:  (id) => `✅ *A technician is now available for your order!*\n🆔 ${id}\nSending order to technician...`,
    cancelPrompt:   (id) => `Do you want to cancel order ${id}?\nSend the reason or send *no* to go back.`,
    cancelDone:     (id) => `✅ Order ${id} has been cancelled.\nThank you.`,
    cancelNo:       "Your order is still active.",
    orderMenu:      (o) => `📋 *Order Details*\n🆔 ${o.orderId}\n🔧 ${o.serviceName}\n📌 ${o.type||""}\n💰 ${(o.totalPrice||0).toFixed(3)} OMR\n📊 Status: ${statusLabel(o.status,"en")}\n📍 Region: ${o.region||"-"}\n\nSend *cancel_${o.orderId}* to cancel this order.`,
    trackResult:    (o) => `📋 *Order Details*\n🆔 ${o.orderId}\n🔧 ${o.serviceName}\n📌 ${o.type||""}\n💰 ${(o.totalPrice||o.price||0).toFixed(3)} OMR\n📊 Status: ${statusLabel(o.status,"en")}\n📍 Region: ${o.region||"-"}\n📅 ${o.createdAt?new Date(o.createdAt.seconds*1000).toLocaleDateString("en-OM"):"-"}`,
    trackNotFound:  "❌ No order found with this ID.",
    trackPrompt:    "🔍 Send your order ID:\nExample: *status ORD-XXXXXXXX*",
    backBtn:        "↩️ Back",
    langChanged:    "✅ Language changed to English.",
    lowBalance:     (bal) => `⚠️ Your balance: ${(bal||0).toFixed(3)} OMR\nMinimum required: *2.000 OMR*\n\nPlease recharge your balance to receive orders.\n\n📞 Contact admin to recharge.`,
    rechargeNeeded: "🔴 Account suspended due to low balance. Recharge to resume work.",
  },
  ur: {
    welcome:        "خوش آمدید! 👋\nخدمت منتخب کریں:",
    chooseService:  "دستیاب خدمات",
    servicesBtn:    "خدمات",
    chooseType:     (name) => `🔧 *${name}*\nخدمت کی قسم منتخب کریں:`,
    typesBtn:       "اقسام",
    chooseParts:    "🔩 مطلوبہ پرزے منتخب کریں\n(نمبر بھیجیں، ایک سے زیادہ منتخب کر سکتے ہیں):",
    partsMenu:      (parts) => parts.map((p,i)=>`${i+1}. ${p.name} — ${(parseFloat(p.price)||0).toFixed(3)} OMR / ${p.unit||"عدد"}${p.stock!==undefined?` (دستیاب: ${p.stock})`:""}`).join("\n") + "\n\n0 — پرزوں کے بغیر جاری رکھیں",
    partAdded:      (name, qty, total) => `✅ شامل کیا: *${name}* × ${qty}\nپرزوں کا مجموعہ: ${total.toFixed(3)} OMR\n\nدوسرا نمبر یا *0* بھیجیں۔`,
    qtyPrompt:      (name, price, stock, maxQty) => { const fmt=n=>(parseFloat(n)||0).toFixed(3); const rows=[]; for(let i=1;i<=maxQty;i++) rows.push(`${i} — ${i} عدد × ${fmt(price)} = ${fmt(i*parseFloat(price))} OMR`); return `🔩 *${name}*\nتعداد منتخب کریں:\n\n${rows.join('\n')}${stock!==undefined?`\n\nدستیاب: ${stock}`:''}`; },
    invalidInput:   "براہ کرم درست نمبر بھیجیں۔",
    invalidPart:    (max) => `0 اور ${max} کے درمیان نمبر بھیجیں۔`,
    outOfStock:     (name, stock) => `⚠️ معذرت، صرف ${stock} *${name}* دستیاب ہے۔`,
    couponPrompt:   "🎟 کیا آپ کے پاس ڈسکاؤنٹ کوڈ ہے؟\nکوڈ بھیجیں یا *0* لکھیں۔",
    couponValid:    (code, disc, total) => `✅ کوپن *${code}* قبول!\n💸 ڈسکاؤنٹ: ${disc.toFixed(3)} OMR\n💰 کل: ${total.toFixed(3)} OMR`,
    couponInvalid:  "❌ غلط یا میعاد ختم کوپن۔\n*0* بھیجیں۔",
    couponUsed:     "❌ یہ کوپن پہلے استعمال ہو چکا ہے۔\n*0* بھیجیں۔",
    confirmTitle:   (sName, tName, partsTxt, svcPrice, partsTotal, disc, total, totalQty) => {
      const fmt = n => (parseFloat(n)||0).toFixed(3);
      const svcLine = totalQty > 0
        ? `🔧 خدمت: ${sName} — ${fmt(svcPrice)} OMR × ${totalQty} = ${fmt(svcPrice*totalQty)} OMR`
        : `🔧 خدمت: ${sName} — ${fmt(svcPrice)} OMR`;
      return `📋 *آرڈر خلاصہ*\n${svcLine}\n📌 قسم: ${tName}${partsTxt!=='-'?`\n\n🔩 پرزے:\n${partsTxt}\n💡 پرزوں کا مجموعہ: ${fmt(partsTotal)} OMR`:''}${disc?`\n\n🎟 ڈسکاؤنٹ: -${fmt(disc)} OMR`:''}`+`\n\n💰 *کل: ${fmt(total)} OMR*`;
    },
    confirmYes:     "✅ آرڈر کی تصدیق",
    confirmNo:      "❌ منسوخ",
    confirmed:      "✅ تصدیق ہو گئی!\n📍 آرڈر مکمل کرنے کے لیے اپنا مقام بھیجیں۔",
    cancelled:      "❌ آرڈر منسوخ ہو گیا۔\n*mrhba* لکھ کر دوبارہ شروع کریں۔",
    locationOnly:   "📍 واٹس ایپ لوکیشن فیچر سے اپنا مقام بھیجیں۔",
    sessionExpired: "سیشن ختم ہو گیا۔ *mrhba* لکھیں۔",
    noTech:         "📍 آپ کا علاقہ ابھی ہماری سروس میں شامل نہیں۔\nجلد توسیع ہوگی۔ شکریہ! 🙏",
    noTechRegion:   (r) => `📍 *${r}* ابھی سروس نہیں۔\nجلد شامل ہوگا۔ شکریہ! 🙏`,
    noTechAny:      "⚠️ ابھی کوئی ٹیکنیشن دستیاب نہیں۔\n📝 آپ کا آرڈر انتظار میں ہے۔",
    techAvailableNotify: (id, techName) => `✅ *ٹیکنیشن مل گیا!*\n🆔 ${id}\n👨‍🔧 ٹیکنیشن: ${techName}\nجلد رابطہ کرے گا۔`,
    cancelPrompt:   (id) => `کیا آرڈر *${id}* منسوخ کریں؟\nوجہ بھیجیں یا *no* لکھیں۔`,
    cancelDone:     (id, reason) => `آرڈر منسوخ\n🆔 ${id}\nوجہ: ${reason}\nشکریہ۔`,
    cancelNo:       "آپ کا آرڈر فعال ہے۔ *mrhba* لکھیں۔",
    regionDetected: (r) => `📍 آپ کا مقام: *${r}*`,
    orderSent:      (id) => `✅ *آرڈر بھیج دیا گیا!*\n🆔 آرڈر نمبر: ${id}\nقبولیت پر اطلاع ملے گی۔\n\nٹریک کریں:\n*status ${id}*`,
    activeOrder:    (id, sName, status) => `فعال آرڈر:\n🆔 ${id}\n🔧 ${sName}\nحالت: ${statusLabel(status,"ur")}`,
    defaultMsg:     "*mrhba* لکھ کر شروع کریں۔\nیا *status [آرڈر نمبر]* لکھیں۔",
    techInfo:       (t) => `👤 نام: ${t.name}\n📞 فون: ${t.phone}\n⭐ ریٹنگ: ${t.rating?`${t.rating} (${t.ratingCount||0})`:"نہیں"}\n💰 بیلنس: ${(t.balance||0).toFixed(3)} OMR\n🟢 حالت: ${t.active?"دستیاب":"مصروف"}\n📍 علاقہ: ${t.regionName||t.region||"غیر مقرر"}`,
    newOrder:       (id, sName, tName, parts, total) => `🔔 *نیا آرڈر!*\n🆔 ${id}\n🔧 ${sName}\n📌 ${tName}${parts!=="-"?`\n\n🔩 پرزے:\n${parts}`:""}`+`\n\n💰 کل: ${total.toFixed(3)} OMR`,
    acceptBtn:      "✅ آرڈر قبول",
    rejectBtn:      "❌ آرڈر رد",
    customerPhone:  (p) => `📞 گاہک کا فون: ${p}`,
    orderDoneBtn:   "✅ آرڈر مکمل",
    orderDoneLabel: (id) => `آرڈر ${id} — مکمل ہونے پر دبائیں`,
    accepted:       (name, phone) => `✅ *آرڈر قبول ہو گیا!*\n👨‍🔧 ٹیکنیشن: ${name}\n📞 ${phone}\nراستے میں ہے! 🚗`,
    rejected:       (id) => `❌ ٹیکنیشن نے آرڈر رد کیا۔\n🆔 ${id}\nدوسرا ڈھونڈ رہے ہیں...`,
    noBackupTech:   (id) => `❌ ابھی کوئی ٹیکنیشن نہیں۔\n🆔 ${id}\n*mrhba* دوبارہ کوشش کریں۔`,
    techRejected:   "آرڈر رد کر دیا۔",
    orderNotFound:  "آرڈر نہیں ملا۔",
    alreadyProcessed:"آرڈر پہلے ہی پروسیس ہو چکا۔",
    alreadyDone:    "آرڈر پہلے ہی مکمل ہو چکا۔",
    completed:      (id) => `✅ *آرڈر مکمل!*\n🆔 ${id}\nشکریہ! 🙏`,
    techDone:       (id, fee, bal) => `✅ آرڈر ${id} مکمل۔\n💸 کمیشن: ${fee.toFixed(3)} OMR\n💰 بیلنس: ${bal.toFixed(3)} OMR`,
    ratePrompt:     (id) => `⭐ *ٹیکنیشن کو ریٹ کریں*\n1 سے 5 نمبر بھیجیں:\n\n1 — ⭐ کمزور\n2 — ⭐⭐ ٹھیک\n3 — ⭐⭐⭐ اچھا\n4 — ⭐⭐⭐⭐ بہت اچھا\n5 — ⭐⭐⭐⭐⭐ بہترین`,
    ratingDone:     (s) => `ریٹنگ کا شکریہ! ${"⭐".repeat(s)}`,
    invoiceCaption: (id) => `📄 آرڈر ${id} کا بل`,
    finalInvoice:   (id) => `📄 *آرڈر ${id} کا بل*\nبراہ کرم ٹیکنیشن کو ادائیگی کریں۔`,
    waitingQueue:   (id) => `⏳ *آرڈر انتظار میں!*\n🆔 ${id}\nٹیکنیشن دستیاب ہوتے ہی اطلاع ملے گی۔\n\n*status ${id}*`,
    techAvailable:  (id) => `✅ *ٹیکنیشن دستیاب!*\n🆔 ${id}\nبھیج رہے ہیں...`,
    cancelPrompt:   (id) => `کیا آرڈر ${id} منسوخ کریں؟\nوجہ یا *no* بھیجیں۔`,
    cancelDone:     (id) => `✅ آرڈر ${id} منسوخ۔\nشکریہ۔`,
    cancelNo:       "آرڈر فعال ہے۔",
    orderMenu:      (o) => `📋 *آرڈر تفصیل*\n🆔 ${o.orderId}\n🔧 ${o.serviceName}\n📌 ${o.type||""}\n💰 ${(o.totalPrice||0).toFixed(3)} OMR\n📊 حالت: ${statusLabel(o.status,"ur")}\n\n*cancel_${o.orderId}* منسوخ کریں۔`,
    trackResult:    (o) => `📋 *آرڈر تفصیل*\n🆔 ${o.orderId}\n🔧 ${o.serviceName}\n📌 ${o.type||""}\n💰 ${(o.totalPrice||o.price||0).toFixed(3)} OMR\n📊 حالت: ${statusLabel(o.status,"ur")}\n📅 ${o.createdAt?new Date(o.createdAt.seconds*1000).toLocaleDateString("ur"):"-"}`,
    trackNotFound:  "❌ اس نمبر کا آرڈر نہیں ملا۔",
    trackPrompt:    "🔍 آرڈر نمبر بھیجیں:\nمثال: *status ORD-XXXXXXXX*",
    // Back button labels
    backBtn:        "↩️ واپس",
    langChanged:    "✅ زبان اردو میں تبدیل ہو گئی۔",
    lowBalance:     (bal) => `⚠️ آپ کا بیلنس: ${(bal||0).toFixed(3)} OMR\nکام کے لیے کم از کم *2.000 OMR* ضروری ہے\n\nآرڈر لینے کے لیے بیلنس ری چارج کریں۔\n\n📞 انتظامیہ سے رابطہ کریں۔`,
    rechargeNeeded: "🔴 کم بیلنس کی وجہ سے اکاؤنٹ معطل۔ کام جاری رکھنے کے لیے ری چارج کریں۔",
  }
};

function statusLabel(s, l) {
  return ({
    ar:{pending:"قيد الانتظار",accepted:"مقبول",done:"مكتمل",rejected:"مرفوض"},
    en:{pending:"Pending",accepted:"Accepted",done:"Done",rejected:"Rejected"},
    ur:{pending:"انتظار میں",accepted:"قبول",done:"مکمل",rejected:"رد"}
  }[l]||{})[s]||s;
}
function getLang(s) { const l = s?.data?.lang; return ["ar","en","ur"].includes(l) ? l : "ar"; }
function L(s)       { return LANGS[getLang(s)]; }
async function getTechLang(techId) {
  try {
    const snap = await db.collection("technicians").doc(techId).get();
    const l = snap.data()?.lang;
    return ["ar","en","ur"].includes(l) ? l : "ar";
  } catch(e) { return "ar"; }
}

// ─── Session ──────────────────────────────────────────────────────────────────
async function getSession(p) { const d = await db.collection("sessions").doc(p).get(); return d.exists?d.data():{state:null,data:{}}; }
async function setSession(p, state, data) {
  // Strip undefined values — Firestore rejects them
  const clean = JSON.parse(JSON.stringify({state, data: data||{}}, (k,v) => v===undefined ? null : v));
  await db.collection("sessions").doc(p).set(clean);
}
async function clearSession(p) { await db.collection("sessions").doc(p).delete(); }
function generateOrderId() { return "ORD-" + uuidv4().split("-")[0].toUpperCase(); }

// ─── Balance Check ────────────────────────────────────────────────────────────
const MIN_TECH_BALANCE = 2.0; // OMR — minimum balance to be active

async function checkTechBalance(techId, techPhone, techLang) {
  const snap = await db.collection("technicians").doc(techId).get();
  if (!snap.exists) return true; // allow if not found
  const bal = parseFloat(snap.data()?.balance || 0);
  if (bal < MIN_TECH_BALANCE) {
    // Mark as inactive
    await db.collection("technicians").doc(techId).update({ active: false });
    const tl = techLang || snap.data()?.lang || "ar";
    await sendMessage(techPhone, LANGS[tl].lowBalance(bal));
    return false; // blocked
  }
  return true; // allowed
}

// ─── Back Navigation ──────────────────────────────────────────────────────────
async function handleBack(from, session) {
  const Lx  = L(session);
  const lang = getLang(session);
  const st   = session.state;

  if (st === "type") {
    // Back from type → go to service selection
    const services = await getServices();
    await sendList(from, Lx.welcome, Lx.servicesBtn, [{
      title: Lx.chooseService,
      rows: services.map((s,i)=>({id:"svc_"+i, title:s.name.substring(0,24)}))
    }]);
    await setSession(from, "service", {lang, services});
    return true;
  }
  if (st === "parts" || st === "parts_ask") {
    // Back from parts → go to type selection
    const service = session.data.service || { id: session.data.serviceId, name: session.data.serviceName, types: [] };
    if (service.types && service.types.length) {
      await sendList(from, Lx.chooseType(service.name), Lx.typesBtn, [{
        title: Lx.typesBtn,
        rows: [...service.types.map((t,i)=>({id:"typ_"+i, title:t.name.substring(0,24), description:`${t.price} OMR`})), backRow(getLang(session))]
      }]);
      await setSession(from,"type",{lang, service:{id:service.id,name:service.name,types:service.types}, discount:0, couponId:null, couponCode:null});
    } else {
      // Reload service types from DB
      const services = await getServices();
      const svc = services.find(s=>s.id===session.data.serviceId);
      if (svc) {
        await sendList(from, Lx.chooseType(svc.name), Lx.typesBtn, [{
          title: Lx.typesBtn,
          rows: svc.types.map((t,i)=>({id:"typ_"+i, title:t.name.substring(0,24), description:`${t.price} OMR`}))
        }]);
        await setSession(from,"type",{lang, service:{id:svc.id,name:svc.name,types:svc.types}, discount:0, couponId:null, couponCode:null});
      }
    }
    return true;
  }
  if (st === "coupon") {
    // Back from coupon → go to parts (or type if no parts)
    // ALWAYS clear pendingPartIdx to avoid stale state
    session.data.pendingPartIdx = null;
    session.data.pendingMaxQty = null;
    const serviceId = session.data.serviceId || session.data.service?.id || "";
    const parts = await getPartsByService(serviceId);
    if (parts.length) {
      const partsRows = parts.slice(0,10).map((p,i)=>({
        id:"part_"+i, title:p.name.substring(0,24),
        description:`${(parseFloat(p.price)||0).toFixed(3)} OMR${p.stock!==undefined?" · "+p.stock:""}`
      }));
      partsRows.push({id:"part_skip", title: lang==="ar"?"0 — بدون قطع":lang==="ur"?"0 — پرزوں کے بغیر":"0 — No parts"});
      await sendList(from, lang==="ar"?"🔩 القطع:":lang==="ur"?"🔩 پرزے:":"🔩 Parts:",
        lang==="ar"?"القطع":lang==="ur"?"پرزے":"Parts",
        [{title:lang==="ar"?"القطع المتاحة":lang==="ur"?"دستیاب پرزے":"Available Parts", rows:partsRows}]
      );
      await setSession(from,"parts",{...session.data, parts:[], pendingPartIdx:undefined});
    } else {
      // No parts — go back to type
      return await handleBack(from, {...session, state:"parts"});
    }
    return true;
  }
  if (st === "confirm") {
    // Back from confirm → go to coupon (or parts if no coupon)
    const hasCoupons = await checkActiveCoupons();
    // Clear any stale pending part state
    const cleanConfirmBack = {...session.data, discount:0, couponId:null, couponCode:null, pendingPartIdx:null, pendingMaxQty:null};
    if (hasCoupons) {
      await setSession(from,"coupon", cleanConfirmBack);
      await sendMessage(from, Lx.couponPrompt);
    } else {
      return await handleBack(from, {...session, state:"coupon", data: cleanConfirmBack});
    }
    return true;
  }
  if (st === "location") {
    // Back from location → resend confirm
    await goToConfirm(from, session, Lx, session.data.discount||0, session.data.couponCode||null);
    return true;
  }
  return false; // unhandled
}

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
  if(!serviceId || typeof serviceId !== "string") return [];
  regionName = regionName && typeof regionName === "object" ? null : (regionName||null);
  console.log(`[AVAIL] querying: serviceId="${serviceId}" regionName="${regionName}"`);
  const snap = await db.collection("technicians")
    .where("active","==",true).where("services","array-contains",serviceId).get();
  console.log(`[AVAIL] raw results from Firestore: ${snap.size} technicians with active=true & services contains "${serviceId}"`);
  snap.docs.forEach(d => {
    const t = d.data();
    console.log(`[AVAIL] found: ${t.name} active=${t.active} balance=${t.balance} services=${JSON.stringify(t.services)}`);
  });
  let techs = snap.docs.map(d=>({id:d.id,...d.data()}))
    .filter(t => !excludeIds.includes(t.id))
    .filter(t => {
      const bal = parseFloat(t.balance)||0;
      const ok = bal >= MIN_TECH_BALANCE;
      if(!ok) console.log(`[TECH] ${t.name} excluded: balance=${bal} < ${MIN_TECH_BALANCE}`);
      return ok;
    }); // exclude low balance

  const norm = s => (String(s||"")||"" ).toLowerCase().replace(/\s+/g,"").replace(/ة/g,"ه").replace(/ى/g,"ي").replace(/أ|إ|آ/g,"ا");

  if(regionName){
    const rn = norm(regionName);
    // Match tech.region against regionName OR doc.id (taqha = ولاية طاقة)
    const sameRegion = techs.filter(t => {
      // Support both field names: regionName (new) and region (old)
      const techRegion = t.regionName || t.region || "";
      const techRegionId = t.regionId || "";
      const tn = norm(techRegion);
      const tid = norm(techRegionId);
      const match = (tn && (tn.includes(rn) || rn.includes(tn))) ||
                    (tid && (tid===rn || rn.includes(tid)));
      console.log(`[TECH] ${t.name}: regionName="${techRegion}" regionId="${techRegionId}" norm="${tn}" vs "${rn}" → ${match?"✅":"❌"}`);
      return match;
    });
    console.log(`[TECH] sameRegion count: ${sameRegion.length}, total techs: ${techs.length}, regionName: "${regionName}"`);
    if(sameRegion.length){
      sameRegion.sort((a,b)=>(b.rating||0)-(a.rating||0));
      return sameRegion;
    }
    // No strict match — try any available tech (region flexible)
    console.log("[TECH] No region match — returning all available techs");
    techs.sort((a,b)=>(b.rating||0)-(a.rating||0));
    return techs;
  }

  // No region info → return all available sorted by rating
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

// ─── Region Detection from Firebase ──────────────────────────────────────────
// Each region in Firebase has: name, active, lat, lng, radiusKm
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function detectRegion(lat, lng) {
  try {
    const snap = await db.collection("regions").get();
    let matched = [];
    snap.docs.forEach(doc => {
      const r = doc.data();
      // Resolve name — try all possible field names, fallback to doc.id
      const rName = String(r.regionName || r.name || r.Name || r.region || doc.id || "");
      const rActive = r.active !== false;
      // Method 1: center point + radius
      if(r.lat && r.lng) {
        const dist   = haversineKm(lat, lng, parseFloat(r.lat), parseFloat(r.lng));
        const radius = parseFloat(r.radiusKm) || 10;
        console.log(`[REGION] "${rName}" (doc=${doc.id}): dist=${dist.toFixed(2)}km radius=${radius}km → ${dist<=radius?"✅ MATCH":"❌"}`);
        if(dist <= radius) matched.push({name:rName, active:rActive, id:doc.id, dist});
      }
      // Method 2: bounding box
      else if(r.maxLat && r.minLat && r.maxLng && r.minLng) {
        const inBox = lat<=parseFloat(r.maxLat) && lat>=parseFloat(r.minLat) &&
                      lng<=parseFloat(r.maxLng) && lng>=parseFloat(r.minLng);
        console.log(`[REGION] "${rName}" (doc=${doc.id}): bounding box → ${inBox?"✅ MATCH":"❌"}`);
        if(inBox) matched.push({name:rName, active:rActive, id:doc.id, dist:0});
      }
    });

    console.log(`[REGION] matched: ${JSON.stringify(matched)}`);
    if(matched.length) {
      matched.sort((a,b)=>a.dist-b.dist);
      const best = matched[0];
      // Ensure name is always a non-empty string
      if(!best.name || best.name === "undefined") best.name = best.id;
      return best;
    }

    // Fallback: OpenStreetMap reverse geocoding
    try {
      const res = await axios.get(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ar`,
        {headers:{"User-Agent":"TAQA-Bot/1.0"},timeout:5000}
      );
      const a = res.data.address||{};
      const osmName = a.county||a.state_district||a.suburb||a.city||a.state||null;
      if(osmName) return {name:osmName, active:true}; // assume active if from OSM
    } catch(e2){ console.error("OSM fallback:", e2?.message); }

    return { name: null, active: true }; // unknown region but allow
  } catch(e) {
    console.error("detectRegion:", e?.message);
    return { name: null, active: true };
  }
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
  const totalQty   = (parts||[]).reduce((s,p)=>s+(p.qty||1), 0);
  const svcTotal   = totalQty > 0
    ? (parseFloat(servicePrice)||0) * totalQty
    : (parseFloat(servicePrice)||0);
  const partsTotal = (parts||[]).reduce((s,p)=>s+(parseFloat(p.price)||0)*(p.qty||1), 0);
  return Math.round((svcTotal + partsTotal)*1000)/1000;
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
    if(tech) {
      // Tech language change: ar / en / ur
      if(["ar","en","ur"].includes(text.toLowerCase())){
        const newTechLang = text.toLowerCase();
        await db.collection("technicians").doc(tech.id).update({lang: newTechLang});
        await sendMessage(from, LANGS[newTechLang].langChanged);
        return;
      }
      await handleTechMessage(from, text, msg, tech); return;
    }

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
    console.log("[SESSION] state=", session.state, "text=", JSON.stringify(text));
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

    // ── Block start if pending rating ──────────────────────────────────────────
    if(isStart && session.state==="rating"){
      const lang = session.data.lang||"ar";
      const Lx   = LANGS[lang];
      // Re-send rating prompt and block
      await sendMessage(from, lang==="ar"
        ? `⭐ يرجى إتمام تقييم الفني أولاً قبل طلب خدمة جديدة.

أرسل رقماً من 1 إلى 5:
1 — ضعيف
2 — مقبول
3 — جيد
4 — جيد جداً
5 — ممتاز`
        : lang==="ur"
        ? `⭐ نئی خدمت سے پہلے ٹیکنیشن کو ریٹ کریں۔

1 سے 5 نمبر بھیجیں:`
        : `⭐ Please rate the technician before placing a new order.

Send a number 1–5:
1 — Poor
2 — Fair
3 — Good
4 — Very Good
5 — Excellent`);
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
      // Store minimal service data - RESET discount
      await setSession(from,"type",{
        lang: session.data.lang||"ar",
        service: {id:service.id, name:service.name, types:service.types},
        discount: 0,
        couponId: null,
        couponCode: null
      });
      return;
    }

    // ── type ──────────────────────────────────────────────────────────────────
    if(session.state==="type"){
      if(text==="nav_back"){ await handleBack(from,session); return; }
      const service = session.data.service;
      let idx = -1;
      if(text.startsWith("typ_")) idx=parseInt(text.replace("typ_",""));
      else { const n=parseInt(text); if(!isNaN(n)&&n>=1&&n<=service.types.length) idx=n-1; }
      console.log("[TYPE] text=", JSON.stringify(text), "idx=", idx, "types=", service?.types?.length);
      if(idx<0||idx>=service.types.length){ await sendMessage(from,`يرجى اختيار نوع من القائمة.`); return; }
      const type  = service.types[idx];
      const parts = await getPartsByService(service.id);
      if(!parts.length){
        // No parts for this service — skip
        await goNextAfterParts(from,{
          lang: getLang(session)||"ar",
          serviceId: service.id||null,
          serviceName: service.name||null,
          selectedType: {name:type.name||"", price:type.price||0},
          servicePrice: type.price||0,
          parts: [],
          couponId: null,
          couponCode: null,
          discount: 0
        },Lx);
      } else {
        // Ask if customer wants parts
        // Store MINIMAL data in session - no undefined for Firestore
        await setSession(from,"parts_ask",{
          lang: getLang(session)||"ar",
          serviceId: String(service.id||""),
          serviceName: String(service.name||""),
          selectedType: {name: String(type.name||""), price: Number(type.price||0)},
          servicePrice: Number(type.price||0),
          parts: [],
          pendingPartIdx: null,
          pendingMaxQty: null,
          couponId: null,
          couponCode: null,
          discount: 0
        });
        const lang2 = getLang(session);
        const partsRows = parts.slice(0,10).map((p,i) => ({
          id: "part_" + i,
          title: p.name.substring(0,24),
          description: `${(parseFloat(p.price)||0).toFixed(3)} OMR${p.stock!==undefined?" · متوفر: "+p.stock:""}`
        }));
        partsRows.push({ id:"part_skip", title: lang2==="ar"?"0 — بدون قطع":lang2==="ur"?"0 — بغیر پرزے":"0 — No parts" });
        partsRows.push(backRow(lang2));
        await sendList(from,
          lang2==="ar"?"🔩 هل تريد إضافة قطع غيار؟":lang2==="ur"?"🔩 پرزے شامل کریں؟":"🔩 Add spare parts?",
          lang2==="ar"?"القطع":lang2==="ur"?"پرزے":"Parts",
          [{ title: lang2==="ar"?"القطع المتاحة":lang2==="ur"?"دستیاب پرزے":"Available Parts", rows: partsRows }]
        );
      }
      return;
    }

    // ── parts_ask & parts — unified handler ─────────────────────────────────────
    if(session.state==="parts_ask"){
      // Clear any stale pending state before entering parts
      const cleanPartsData = {...session.data, pendingPartIdx:null, pendingMaxQty:null};
      await setSession(from, "parts", cleanPartsData);
      session.data = cleanPartsData;
      session.state = "parts";
    }
    if(session.state==="parts"){
      // Fetch parts fresh from DB
      const serviceIdForParts = String(session.data.serviceId||session.data.service?.id||"");
      console.log("[PARTS] serviceIdForParts=", JSON.stringify(serviceIdForParts));
      const avail = await getPartsByService(serviceIdForParts);
      const selected = JSON.parse(JSON.stringify(session.data.parts||[]));
      const pending  = session.data.pendingPartIdx;  // null or undefined = no pending
      console.log("[PARTS] text=", JSON.stringify(text), "pending=", JSON.stringify(pending), "avail=", avail.length, "serviceId=", serviceIdForParts);

      // ── nav_back must be checked BEFORE any ID conversion ──
      if(text==="nav_back"){
        if(pending != null){
          // In qty selection → back to parts list
          await setSession(from,"parts",{...session.data,pendingPartIdx:null,pendingMaxQty:null});
          const lang3b = getLang(session);
          const fp = await getPartsByService(session.data.serviceId||"");
          const rb = fp.slice(0,10).map((p,i)=>({id:"part_"+i,title:p.name.substring(0,24),description:`${(parseFloat(p.price)||0).toFixed(3)} OMR${p.stock!==undefined?" · "+p.stock:""}`}));
          rb.push({id:"part_skip",title:lang3b==="ar"?"0 — بدون قطع":lang3b==="ur"?"0 — بغیر پرزے":"0 — No parts"});
          rb.push(backRow(lang3b));
          await sendList(from,lang3b==="ar"?"🔩 اختر قطعة:":lang3b==="ur"?"🔩 پرزہ منتخب کریں:":"🔩 Choose part:",lang3b==="ar"?"القطع":lang3b==="ur"?"پرزے":"Parts",[{title:lang3b==="ar"?"القطع المتاحة":lang3b==="ur"?"دستیاب پرزے":"Available Parts",rows:rb}]);
        } else {
          // In parts list → back to type
          await handleBack(from, session);
        }
        return;
      }

      // ── Convert list reply IDs (AFTER nav_back check) ──
      if(text==="part_skip")                                   text = "0";
      else if(text.startsWith("part_"))                        text = String(parseInt(text.replace("part_",""))+1);
      if(text.startsWith("qty_"))                              text = text.replace("qty_","");

      if(pending != null){
        // "0" while waiting for qty = cancel part selection, go back to menu
        if(text==="0"||text==="part_skip"){
          await setSession(from,"parts",{...session.data,pendingPartIdx:null});
          const freshParts2 = await getPartsByService(session.data.serviceId||session.data.service?.id||"");
          const lang3 = getLang(session);
          const rows2 = freshParts2.slice(0,10).map((p,i)=>({
            id:"part_"+i,
            title:p.name.substring(0,24),
            description:`${(parseFloat(p.price)||0).toFixed(3)} OMR${p.stock!==undefined?" · متوفر: "+p.stock:""}`
          }));
          rows2.push({id:"part_skip",title:lang3==="ar"?"0 — بدون قطع":lang3==="ur"?"0 — بغیر پرزے":"0 — No parts"});
          rows2.push(backRow(lang3));
          await sendList(from,
            lang3==="ar"?"🔩 اختر قطعة أخرى:":lang3==="ur"?"🔩 دوسرا پرزہ:":"🔩 Choose another part:",
            lang3==="ar"?"القطع":lang3==="ur"?"پرزے":"Parts",
            [{title:lang3==="ar"?"القطع المتاحة":lang3==="ur"?"دستیاب پرزے":"Available Parts",rows:rows2}]
          );
          return;
        }
        const qty = parseInt(text);
        const maxQty2 = session.data.pendingMaxQty || 5;
        const part = avail[pending];
        // Safety check - if part not found reset
        if(!part){
          await setSession(from,"parts",{...session.data,pendingPartIdx:null,pendingMaxQty:null});
          await sendMessage(from, getLang(session)==="ar"?"حدث خطأ. أرسل رقم القطعة مجدداً.":"Error. Please send part number again.");
          return;
        }
        if(isNaN(qty) || qty < 1 || qty > maxQty2){
          await sendMessage(from, getLang(session)==="ar"
            ? `يرجى إرسال رقم بين 1 و ${maxQty2}.`
            : `Please send a number between 1 and ${maxQty2}.`);
          return;
        }
        const ex=selected.find(p=>p.id===part.id);
        if(ex) ex.qty+=qty; else selected.push({id:part.id,name:part.name,price:part.price,unit:part.unit||"قطعة",qty,stock:part.stock});
        const ptotal = selected.reduce((s,p)=>s+(parseFloat(p.price)||0)*p.qty, 0);
        // Save ONLY essential data in session (no undefined values for Firestore)
        const newData = {
          lang: session.data.lang||"ar",
          serviceId: session.data.serviceId||session.data.service?.id||null,
          serviceName: session.data.serviceName||session.data.service?.name||null,
          selectedType: session.data.selectedType||null,
          servicePrice: session.data.servicePrice||0,
          parts: selected.map(p=>({id:p.id,name:p.name,price:p.price||0,unit:p.unit||"قطعة",qty:p.qty||1})),
          couponId: null,
          couponCode: null,
          discount: 0  // reset — coupon applied in next step
        };
        await setSession(from,"parts", newData);
        const fmt = (n) => (parseFloat(n)||0).toFixed(3);
        // Go directly to confirm after adding part
        const confirmMsg = getLang(session)==="ar"
          ? `✅ تمت إضافة: *${part.name}* × ${qty} = ${fmt(qty*(parseFloat(part.price)||0))} OMR`
          : `✅ Added: *${part.name}* × ${qty} = ${fmt(qty*(parseFloat(part.price)||0))} OMR`;
        await sendMessage(from, confirmMsg);
        await goNextAfterParts(from, newData, Lx);
        return;
      }

      if(text==="0"){
        const minData = {
          lang: session.data.lang||"ar",
          serviceId: session.data.serviceId||session.data.service?.id||null,
          serviceName: session.data.serviceName||session.data.service?.name||null,
          selectedType: session.data.selectedType||null,
          servicePrice: session.data.servicePrice||0,
          parts: selected.map(p=>({id:p.id,name:p.name,price:p.price||0,unit:p.unit||"قطعة",qty:p.qty||1})),
          couponId: null,
          couponCode: null,
          discount: 0  // reset — coupon applied later if exists
        };
        await goNextAfterParts(from, minData, Lx); return;
      }

      const num=parseInt(text);
      console.log("[PARTS] num=", num, "avail.length=", avail.length, "text=", JSON.stringify(text));
      if(isNaN(num)||num<1||num>avail.length){ 
        console.log("[PARTS] INVALID — sending error. avail ids:", avail.map(p=>p.id));
        await sendMessage(from,Lx.invalidPart(avail.length)); return; 
      }
      const part=avail[num-1];
      const maxQty = part.stock !== undefined ? Math.min(part.stock, 5) : 5;
      // Save to DB BEFORE sending qty list so next message has correct state
      await setSession(from,"parts",{...session.data,pendingPartIdx:num-1,pendingMaxQty:maxQty});
      // Send qty as list
      const qtyRows = [];
      for(let i=1;i<=maxQty;i++){
        const lineTotal = ((parseFloat(part.price)||0)*i).toFixed(3);
        qtyRows.push({id:"qty_"+i, title:`${i} ${ getLang(session)==="ar"?"قطعة":"piece"}`, description:`${lineTotal} OMR`});
      }
      qtyRows.push(backRow(getLang(session)));
      await sendList(from,
        `🔩 *${part.name}*\n${ getLang(session)==="ar"?"اختر الكمية:":getLang(session)==="ur"?"تعداد منتخب کریں:":"Choose quantity:"}`,
        getLang(session)==="ar"?"الكمية":getLang(session)==="ur"?"تعداد":"Qty",
        [{title: getLang(session)==="ar"?"الكمية المطلوبة":getLang(session)==="ur"?"مطلوبہ تعداد":"Required Qty", rows:qtyRows}]
      );
      return;
    }

    // ── coupon ────────────────────────────────────────────────────────────────
    if(session.state==="coupon"){
      if(text==="nav_back"||text==="coupon_back"){ await handleBack(from,session); return; }
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
      if(text==="nav_back"){ await handleBack(from,session); return; }
      if(text==="confirm_no"||text==="2"){ await clearSession(from); await sendMessage(from,Lx.cancelled); return; }
      if(text==="confirm_yes"||text==="1"){ await setSession(from,"location",session.data); await sendMessage(from,Lx.confirmed); return; }
      // Resend buttons if invalid
      await goToConfirm(from,session,Lx,session.data.discount||0,session.data.couponCode||null);
      return;
    }

    // ── location ──────────────────────────────────────────────────────────────
    if(session.state==="location"){
      if(text==="nav_back"){ await handleBack(from,session); return; }
      if(msg.type!=="location"){ await sendMessage(from,Lx.locationOnly); return; }
      const service = session.data.service || {
        id: session.data.serviceId,
        name: session.data.serviceName
      };
      const selectedType=session.data.selectedType;
      const userLang=getLang(session);
      if(!service||!selectedType){ await sendMessage(from,Lx.sessionExpired); await clearSession(from); return; }

      // detectRegion returns {name, active} object
      const regionObj  = await detectRegion(msg.location.latitude, msg.location.longitude);
      const regionName = regionObj?.name ? String(regionObj.name) : null;  // always plain string
      const regionActive = regionObj?.active !== false;

      if(regionName) await sendMessage(from, Lx.regionDetected(regionName));

      // Block if region is inactive (not served)
      if(regionName && !regionActive){
        await sendMessage(from, getLang(session)==="ar"
          ? `⚠️ عذراً، منطقة *${regionName}* غير مخدومة حالياً.`
          : `⚠️ Sorry, region *${regionName}* is not currently served.`);
        await clearSession(from); return;
      }

      const parts      = session.data.parts||[];
      const rawTotal   = calcTotal(session.data.servicePrice||selectedType.price, parts);
      const discount   = session.data.discount||0;
      const totalPrice = Math.max(0, Math.round((rawTotal-discount)*1000)/1000);
      const partsText  = buildPartsText(parts);

      const techs = await getAvailableTechs(service.id, regionName||"", []);
      if(!techs.length){
        // Region not served — just notify, no waiting queue
        await sendMessage(from, regionName ? Lx.noTechRegion(regionName) : Lx.noTech);
        await clearSession(from); return;
      }

      const chosenTech = techs[0];
      const orderId    = generateOrderId();

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

      // Notify tech with BUTTONS (accept/reject) + customer location
      const techPhone=normalize(chosenTech.phone);
      const firstTechLang = (await db.collection("technicians").doc(chosenTech.id).get()).data()?.lang || "ar";
      await sendButtons(techPhone,
        LANGS[firstTechLang].newOrder(orderId,service.name,selectedType.name,partsText,totalPrice),
        [{id:"accept_"+orderId,title:LANGS[firstTechLang].acceptBtn},{id:"reject_"+orderId,title:LANGS[firstTechLang].rejectBtn}]
      );
      // Send customer location to tech so they can check distance
      await sendLocation(techPhone, msg.location.latitude, msg.location.longitude);
      await sendMessage(techPhone, `📍 موقع العميل — ${regionName||"غير محدد"}\nاضغط على الموقع لحساب المسافة.`);

      await sendMessage(from,Lx.orderSent(orderId));
      // Invoice sent only after completion (for payment)
      await clearSession(from);
      return;
    }

    // ── rating state — customer replies 1-5 ────────────────────────────────────
    if(session.state==="rating"){
      const stars = parseInt(text);
      if(isNaN(stars)||stars<1||stars>5){
        const rl = session.data.lang||"ar";
        await sendMessage(from, rl==="ar"
          ? `⭐ يرجى تقييم الفني أولاً لإتمام الطلب.
أرسل رقماً من 1 إلى 5:
1 — ضعيف  2 — مقبول  3 — جيد  4 — جيد جداً  5 — ممتاز`
          : rl==="ur"
          ? `⭐ پہلے ریٹنگ دیں۔ 1 سے 5:`
          : `⭐ Please rate the technician first.
Send a number 1–5:
1 — Poor  2 — Fair  3 — Good  4 — Very Good  5 — Excellent`);
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

    await sendMessage(from,Lx.defaultMsg);
  } catch(err){ console.error("WEBHOOK ERROR:", err); }
});


// ─── Back row/button helpers ──────────────────────────────────────────────────
function backRow(lang) {
  return { id:"nav_back", title: lang==="ur"?"↩️ واپس": lang==="en"?"↩️ Back":"↩️ رجوع" };
}
function backBtn(lang) {
  return { id:"nav_back", title: lang==="ur"?"↩️ واپس": lang==="en"?"↩️ Back":"↩️ رجوع" };
}
// ─── goNextAfterParts ─────────────────────────────────────────────────────────
async function goNextAfterParts(from, data, Lx) {
  // Ensure servicePrice is always present
  const svcPrice = parseFloat(data.servicePrice) || parseFloat(data.selectedType?.price) || 0;
  const cleanData = {
    ...data,
    servicePrice: svcPrice,
    discount: 0,
    couponId: null,
    couponCode: null
  };
  const hasCoupons = await checkActiveCoupons();
  if(hasCoupons){
    await setSession(from,"coupon",cleanData);
    const cpLang2 = cleanData.lang||"ar";
    await sendButtons(from, Lx.couponPrompt,
      [{id:"0",title:cpLang2==="ar"?"تخطي":cpLang2==="ur"?"چھوڑیں":"Skip"},{id:"nav_back",title:backBtn(cpLang2).title}]
    );
  } else {
    await goToConfirm(from,{state:"coupon",data:cleanData},Lx,0,null);
  }
}

// ─── goToConfirm — sends BUTTONS ─────────────────────────────────────────────
async function goToConfirm(from, session, Lx, discount, couponCode) {
  const d         = session.data || {};
  const svcName   = d.serviceName || d.service?.name || "";
  const typeName  = d.selectedType?.name || "";
  const svcPrice  = parseFloat(d.servicePrice) || parseFloat(d.selectedType?.price) || 0;
  const parts     = d.parts || [];
  // Total qty of all parts selected
  const totalQty  = parts.reduce((s,p)=>s+(p.qty||1), 0);
  // Service multiplied by total qty (if parts selected)
  const svcTotal  = totalQty > 0
    ? Math.round(svcPrice * totalQty * 1000) / 1000
    : Math.round(svcPrice * 1000) / 1000;
  const partsTotal= Math.round(parts.reduce((s,p)=>s+(parseFloat(p.price)||0)*(p.qty||1),0)*1000)/1000;
  const disc      = parseFloat(discount)||0;
  const total     = Math.max(0, Math.round((svcTotal + partsTotal - disc)*1000)/1000);
  const partsTxt  = buildPartsText(parts);

  const confirmLang = d.lang||"ar";
  await setSession(from,"confirm",{...d, discount:disc, couponCode, totalPrice:total, servicePrice:svcPrice, serviceTotalPrice:svcTotal});
  await sendButtons(from,
    Lx.confirmTitle(svcName, typeName, partsTxt, svcPrice, partsTotal, disc>0?disc:null, total, totalQty),
    [{id:"confirm_yes",title:Lx.confirmYes},{id:"confirm_no",title:Lx.confirmNo},{id:"nav_back",title:backBtn(confirmLang).title}]
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
  const tl = tech.lang || "ar";
  await sendMessage(techPhone, LANGS[tl].techInfo(tech));
  // Warn if balance is low
  if ((parseFloat(tech.balance)||0) < MIN_TECH_BALANCE) {
    await sendMessage(techPhone, LANGS[tl].lowBalance(tech.balance||0));
  }
  await sendMessage(techPhone, tl==="ar"
    ? "💬 لتغيير اللغة أرسل: ar / en / ur"
    : tl==="ur"
    ? "💬 زبان تبدیل کریں: ar / en / ur"
    : "💬 Change language: ar / en / ur");
}

async function handleAccept(orderId, techPhone, tech) {
  // ── Balance check before accepting ──────────────────────────────────────────
  const allowed = await checkTechBalance(tech.id, techPhone, tech.lang);
  if (!allowed) return; // message already sent inside checkTechBalance

  const ref=db.collection("orders").doc(orderId); const snap=await ref.get();
  if(!snap.exists){ await sendMessage(techPhone,LANGS.ar.orderNotFound); return; }
  const order=snap.data();
  if(order.status!=="pending"){ await sendMessage(techPhone,LANGS.ar.alreadyProcessed); return; }
  await ref.update({status:"accepted"});
  await db.collection("technicians").doc(order.technicianId).update({active:false});
  const customerPhone=normalize(order.customer);
  const CL=LANGS[order.lang||"ar"];
  // Send customer info + location to tech
  const tl2 = tech.lang||"ar";
  await sendMessage(techPhone, LANGS[tl2].customerPhone(customerPhone));
  if(order.location?.latitude){
    // Send location so tech can navigate
    await sendLocation(techPhone, order.location.latitude, order.location.longitude);
    // Also send Google Maps link
    const mapsLink = `https://www.google.com/maps?q=${order.location.latitude},${order.location.longitude}`;
    await sendMessage(techPhone, `🗺️ موقع العميل على خرائط Google:\n${mapsLink}\n📍 المنطقة: ${order.region||"-"}`);
  }
  // Done button for tech
  await sendButtons(techPhone, LANGS[tech.lang||"ar"].orderDoneLabel(orderId), [{id:"done_"+orderId,title:LANGS[tech.lang||"ar"].orderDoneBtn}]);
  await sendMessage(customerPhone, CL.accepted(tech.name,tech.phone));
}

async function handleReject(orderId, techPhone, tech) {
  const ref=db.collection("orders").doc(orderId); const snap=await ref.get();
  if(!snap.exists){ await sendMessage(techPhone,LANGS.ar.orderNotFound); return; }
  const order=snap.data();
  if(order.status!=="pending"){ await sendMessage(techPhone,LANGS.ar.alreadyProcessed); return; }
  await sendMessage(techPhone,LANGS[tech.lang||"ar"].techRejected);
  const rejected=[...(order.rejectedTechs||[]),order.technicianId];
  await ref.update({status:"pending",rejectedTechs:rejected});
  const customerPhone=normalize(order.customer);
  const CL=LANGS[order.lang||"ar"];
  await sendMessage(customerPhone,CL.rejected(orderId));
  const backup=await getAvailableTechs(order.serviceId,String(order.region||""),rejected);
  if(!backup.length){ await ref.update({status:"rejected"}); await sendMessage(customerPhone,CL.noBackupTech(orderId)); return; }
  await ref.update({technicianId:backup[0].id});
  const backupPhone = normalize(backup[0].phone);
  const backupTechData = (await db.collection("technicians").doc(backup[0].id).get()).data();
  const btl = backupTechData?.lang||"ar";
  await sendButtons(backupPhone,
    LANGS[btl].newOrder(orderId,order.serviceName,order.type||"",buildPartsText(order.parts),order.totalPrice||0),
    [{id:"accept_"+orderId,title:LANGS[btl].acceptBtn},{id:"reject_"+orderId,title:LANGS[btl].rejectBtn}]
  );
  // Send location to backup tech too
  if(order.location?.latitude){
    await sendLocation(backupPhone, order.location.latitude, order.location.longitude);
    await sendMessage(backupPhone, `📍 موقع العميل — ${order.region||"غير محدد"}`);
  }
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
  // Only mark active again if balance is still sufficient
  const canBeActive = newBal >= MIN_TECH_BALANCE;
  await techRef.update({balance: newBal, active: canBeActive});
  if (!canBeActive) {
    // Notify tech their balance is too low
    await sendMessage(techPhone, LANGS[tech.lang||"ar"].lowBalance(newBal));
  }
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
  await sendMessage(techPhone,LANGS[tech.lang||"ar"].techDone(orderId,fee,newBal));
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

    // Send WhatsApp buttons to tech with order details
    const assignTechLang = tech.lang || "ar";
    await sendButtons(techPhone,
      LANGS[assignTechLang].newOrder(order.orderId, order.serviceName, order.type||"", partsText, order.totalPrice||0),
      [{id:"accept_"+orderId, title:LANGS[assignTechLang].acceptBtn}, {id:"reject_"+orderId, title:LANGS[assignTechLang].rejectBtn}]
    );
    // Send location preview so tech knows where the job is
    if(order.location?.latitude){
      await sendLocation(techPhone, order.location.latitude, order.location.longitude);
      const mapsLink = `https://www.google.com/maps?q=${order.location.latitude},${order.location.longitude}`;
      await sendMessage(techPhone, `📍 موقع الطلب: ${order.region||"-"}\n🗺️ ${mapsLink}`);
    }

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
    const snap = await db.collection("waiting_orders").where("status","==","waiting").get();
    if(snap.empty) return;

    for(const doc of snap.docs){
      const order = doc.data();
      // Filter by serviceId if provided
      if(serviceId && order.serviceId !== serviceId) continue;
      const techs = await getAvailableTechs(order.serviceId||serviceId, String(order.region||""), []);
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
      const wqTechLang = (await db.collection("technicians").doc(tech.id).get()).data()?.lang || "ar";
      await sendButtons(normalize(tech.phone),
        LANGS[wqTechLang].newOrder(orderId, order.serviceName, order.type||"", partsText, order.totalPrice||0),
        [{id:"accept_"+orderId, title:LANGS[wqTechLang].acceptBtn},{id:"reject_"+orderId, title:LANGS[wqTechLang].rejectBtn}]
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
    // Note: waiting orders are in waiting_orders collection
    const snap = await db.collection("waiting_orders").where("status","==","waiting").get();
    if(snap.empty) return;
    for(const doc of snap.docs){
      const order = doc.data();
      const techs = await getAvailableTechs(order.serviceId, String(order.region||""), order.rejectedTechs||[]);
      if(!techs.length) continue;
      const tech  = techs[0];
      const CL    = LANGS[order.lang||"ar"];
      // Notify customer
      await sendMessage(normalize(order.customer), CL.techAvailable(order.orderId));
      // Update order
      await doc.ref.update({ status:"pending", technicianId:tech.id });
      // Notify tech with buttons
      const partsText = buildPartsText(order.parts||[]);
      const cqTechLang = (await db.collection("technicians").doc(tech.id).get()).data()?.lang || "ar";
      await sendButtons(normalize(tech.phone),
        LANGS[cqTechLang].newOrder(order.orderId,order.serviceName,order.type||"",partsText,order.totalPrice||0),
        [{id:"accept_"+order.orderId,title:LANGS[cqTechLang].acceptBtn},{id:"reject_"+order.orderId,title:LANGS[cqTechLang].rejectBtn}]
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
