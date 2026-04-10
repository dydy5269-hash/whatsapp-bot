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
    confirmTitle:   (sName, tName, partsTxt, svcPrice, partsTotal, disc, total) => {
      const fmt = n => (parseFloat(n)||0).toFixed(3);
      const partsLine = partsTxt!=='-' ? `\n🔩 ${partsTxt}\n💡 ${fmt(partsTotal)} OMR` : '';
      const discLine  = disc ? `\n🎟 خصم: -${fmt(disc)} OMR` : '';
      return `📋 *ملخص الطلب*\n🔧 ${sName}\n📌 ${tName}\n💵 ${fmt(svcPrice)} OMR${partsLine}${discLine}\n\n💰 *الإجمالي: ${fmt(total)} OMR*`;
    },
    confirmYes:     "✅ تأكيد الطلب",
    confirmNo:      "❌ إلغاء",
    confirmed:      "✅ تم التأكيد!\n📍 أرسل موقعك الحالي لإتمام الطلب.",
    cancelled:      "❌ تم إلغاء الطلب.\nأرسل *مرحبا* للبدء من جديد.",
    locationOnly:   "📍 يرجى إرسال موقعك باستخدام ميزة الموقع في واتساب.",
    sessionExpired: "انتهت الجلسة. أرسل *مرحبا* للبدء.",
    suspended:     (reason) => `⛔ *تم إيقاف حسابك من قِبل الإدارة.*\n\n📋 السبب:\n${reason}\n\nللاستفسار تواصل مع الإدارة.`,
    reactivated:    "✅ *تم تفعيل حسابك!*\nيمكنك الآن استلام الطلبات. أهلاً بك مجدداً! 🎉",
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
    confirmTitle:   (sName, tName, partsTxt, svcPrice, partsTotal, disc, total) => {
      const fmt = n => (parseFloat(n)||0).toFixed(3);
      const partsLine = partsTxt!=='-' ? `\n🔩 ${partsTxt}\n💡 ${fmt(partsTotal)} OMR` : '';
      const discLine  = disc ? `\n🎟 Discount: -${fmt(disc)} OMR` : '';
      return `📋 *Order Summary*\n🔧 ${sName}\n📌 ${tName}\n💵 ${fmt(svcPrice)} OMR${partsLine}${discLine}\n\n💰 *Total: ${fmt(total)} OMR*`;
    },
    confirmYes:     "✅ Confirm Order",
    confirmNo:      "❌ Cancel",
    confirmed:      "✅ Confirmed!\n📍 Please send your location to complete the order.",
    cancelled:      "❌ Order cancelled.\nSend *mrhba* to start again.",
    locationOnly:   "📍 Please send your location using WhatsApp location feature.",
    sessionExpired: "Session expired. Send *mrhba* to start.",
    suspended:     (reason) => `⛔ *Your account has been suspended by admin.*\n\n📋 Reason:\n${reason}\n\nContact admin for more info.`,
    reactivated:    "✅ *Your account is reactivated!*\nYou can now receive orders. Welcome back! 🎉",
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
  },
  bn: {
    newOrder:       (id,sName,tName,parts,total)=>`🔔 *নতুন অর্ডার!*\n🆔 ${id}\n🔧 ${sName}\n📌 ${tName}${parts!=="-"?`\n\n🔩 যন্ত্রাংশ:\n${parts}`:""}\n\n💰 মোট: ${total.toFixed(3)} OMR`,
    acceptBtn:      "✅ অর্ডার গ্রহণ",
    rejectBtn:      "❌ অর্ডার প্রত্যাখ্যান",
    customerPhone:  (p)=>`📞 গ্রাহকের ফোন: ${p}`,
    orderDoneBtn:   "✅ অর্ডার সম্পন্ন",
    orderDoneLabel: (id)=>`অর্ডার ${id} — সম্পন্ন হলে চাপুন`,
    techRejected:   "অর্ডার প্রত্যাখ্যাত।",
    orderNotFound:  "অর্ডার পাওয়া যায়নি।",
    alreadyProcessed:"অর্ডার আগেই প্রসেস হয়েছে।",
    alreadyDone:    "অর্ডার আগেই সম্পন্ন।",
    techDone:       (id,fee,bal)=>`✅ ${id} সম্পন্ন।\n💸 কমিশন: ${fee.toFixed(3)} OMR\n💰 ব্যালেন্স: ${bal.toFixed(3)} OMR`,
    techInfo:       (t)=>`👤 নাম: ${t.name}\n📞 ফোন: ${t.phone}\n⭐ রেটিং: ${t.rating||"নেই"}\n💰 ব্যালেন্স: ${(t.balance||0).toFixed(3)} OMR\n🟢 অবস্থা: ${t.active?"উপলব্ধ":"ব্যস্ত"}\n📍 এলাকা: ${t.regionName||t.region||"অজানা"}`,
    langChanged:    "✅ ভাষা বাংলায় পরিবর্তিত হয়েছে।",
    suspended:     (reason) => `⛔ *ایڈمن نے آپ کا اکاؤنٹ معطل کر دیا ہے۔*\n\n📋 وجہ:\n${reason}\n\nمزید معلومات کے لیے ایڈمن سے رابطہ کریں۔`,
    reactivated:    "✅ *آپ کا اکاؤنٹ دوبارہ فعال ہو گیا!*\nآپ اب آرڈر وصول کر سکتے ہیں۔ خوش آمدید! 🎉",
    suspended:     (reason) => `⛔ *অ্যাডমিন আপনার অ্যাকাউন্ট স্থগিত করেছেন।*\n\n📋 কারণ:\n${reason}\n\nবিস্তারিত জানতে অ্যাডমিনের সাথে যোগাযোগ করুন।`,
    reactivated:    "✅ *আপনার অ্যাকাউন্ট পুনরায় সক্রিয় হয়েছে!*\nআপনি এখন অর্ডার নিতে পারবেন। স্বাগতম! 🎉",
    lowBalance:     (bal)=>`⚠️ ব্যালেন্স: ${(bal||0).toFixed(3)} OMR\nকাজের জন্য কমপক্ষে *2.000 OMR* প্রয়োজন।\nঅর্ডার নিতে রিচার্জ করুন।\n📞 অ্যাডমিনের সাথে যোগাযোগ করুন।`,
  },
  hi: {
    newOrder:       (id,sName,tName,parts,total)=>`🔔 *नया ऑर्डर!*\n🆔 ${id}\n🔧 ${sName}\n📌 ${tName}${parts!=="-"?`\n\n🔩 पुर्जे:\n${parts}`:""}\n\n💰 कुल: ${total.toFixed(3)} OMR`,
    acceptBtn:      "✅ ऑर्डर स्वीकार",
    rejectBtn:      "❌ ऑर्डर अस्वीकार",
    customerPhone:  (p)=>`📞 ग्राहक का फ़ोन: ${p}`,
    orderDoneBtn:   "✅ ऑर्डर पूरा",
    orderDoneLabel: (id)=>`ऑर्डर ${id} — पूरा होने पर दबाएं`,
    techRejected:   "ऑर्डर अस्वीकार कर दिया।",
    orderNotFound:  "ऑर्डर नहीं मिला।",
    alreadyProcessed:"ऑर्डर पहले ही प्रोसेस हो चुका है।",
    alreadyDone:    "ऑर्डर पहले ही पूरा हो चुका है।",
    techDone:       (id,fee,bal)=>`✅ ${id} पूरा।\n💸 कमीशन: ${fee.toFixed(3)} OMR\n💰 बैलेंस: ${bal.toFixed(3)} OMR`,
    techInfo:       (t)=>`👤 नाम: ${t.name}\n📞 फ़ोन: ${t.phone}\n⭐ रेटिंग: ${t.rating||"नहीं"}\n💰 बैलेंस: ${(t.balance||0).toFixed(3)} OMR\n🟢 स्थिति: ${t.active?"उपलब्ध":"व्यस्त"}\n📍 क्षेत्र: ${t.regionName||t.region||"अज्ञात"}`,
    langChanged:    "✅ भाषा हिंदी में बदल गई।",
    suspended:     (reason) => `⛔ *एडमिन ने आपका अकाउंट निलंबित कर दिया है।*\n\n📋 कारण:\n${reason}\n\nअधिक जानकारी के लिए एडमिन से संपर्क करें।`,
    reactivated:    "✅ *आपका अकाउंट पुनः सक्रिय हो गया!*\nआप अब ऑर्डर ले सकते हैं। स्वागत है! 🎉",
    lowBalance:     (bal)=>`⚠️ बैलेंस: ${(bal||0).toFixed(3)} OMR\nकाम के लिए कम से कम *2.000 OMR* चाहिए।\nऑर्डर लेने के लिए रिचार्ज करें।\n📞 एडमिन से संपर्क करें।`,
  }

};

function statusLabel(s, l) {
  return ({ar:{pending:"قيد الانتظار",accepted:"مقبول",done:"مكتمل",rejected:"مرفوض"},en:{pending:"Pending",accepted:"Accepted",done:"Done",rejected:"Rejected"},ur:{pending:"انتظار میں",accepted:"قبول",done:"مکمل",rejected:"رد"},bn:{pending:"অপেক্ষায়",accepted:"গৃহীত",done:"সম্পন্ন",rejected:"প্রত্যাখ্যাত"},hi:{pending:"प्रतीक्षा में",accepted:"स्वीकृत",done:"पूरा",rejected:"अस्वीकृत"}}[l]||{})[s]||s;
}
function getLang(s) { const l=s?.data?.lang; return ["ar","en","ur","bn","hi"].includes(l)?l:"ar"; }
function L(s)       { return LANGS[getLang(s)]; }

// ─── Session ──────────────────────────────────────────────────────────────────
async function getSession(p) { const d = await db.collection("sessions").doc(p).get(); return d.exists?d.data():{state:null,data:{}}; }
async function setSession(p, state, data) {
  // Strip undefined values — Firestore rejects them
  const clean = JSON.parse(JSON.stringify({state, data: data||{}}, (k,v) => v===undefined ? null : v));
  await db.collection("sessions").doc(p).set(clean);
}
async function clearSession(p) { await db.collection("sessions").doc(p).delete(); }
const MIN_TECH_BALANCE = 2.0; // OMR minimum balance

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

const normAr = s => (String(s||"")||"").toLowerCase()
  .replace(/\s+/g,"").replace(/ة/g,"ه").replace(/ى/g,"ي").replace(/أ|إ|آ/g,"ا");

function techMatchesRegion(t, regionName, regionId) {
  const tr = String(t.regionName||t.region||"");
  const tid = String(t.regionId||"");
  const rn = normAr(regionName||""); const rid = normAr(regionId||"");
  const tn = normAr(tr); const tidn = normAr(tid);
  return (rn&&tn&&(tn.includes(rn)||rn.includes(tn)))||(rid&&tidn&&tidn===rid)||(rid&&tn&&tn.includes(rid));
}

async function getAvailableTechs(serviceId, regionName, excludeIds=[], regionId="") {
  const snap = await db.collection("technicians")
    .where("active","==",true).where("services","array-contains",serviceId).get();
  let techs = snap.docs.map(d=>({id:d.id,...d.data()})).filter(t=>!excludeIds.includes(t.id));

  const norm = s => (s||"").toLowerCase().replace(/\s+/g,"").replace(/ة/g,"ه").replace(/ى/g,"ي").replace(/أ|إ|آ/g,"ا");

  if(regionName){
    const rn = norm(regionName);
    // Try strict same-region match first
    const sameRegion = techs.filter(t => {
      const tn = norm(t.region||"");
      return tn && (tn.includes(rn) || rn.includes(tn));
    });
    if(sameRegion.length){
      // Found techs in same region — use ONLY them
      sameRegion.sort((a,b)=>(b.rating||0)-(a.rating||0));
      return sameRegion;
    }
    // No tech in this region → return empty (will go to waiting queue)
    return [];
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
      // Support both field names: regionName or name
      const rName   = String(r.regionName || r.name || doc.id || "");
      const rActive = r.active !== false;
      // Method 1: center point + radius
      if(r.lat && r.lng) {
        const dist   = haversineKm(lat, lng, parseFloat(r.lat), parseFloat(r.lng));
        const radius = parseFloat(r.radiusKm) || 10;
        console.log(`[REGION] "${rName}" dist=${dist.toFixed(2)}km radius=${radius}km → ${dist<=radius?"✅ MATCH":"❌"}`);
        if(dist <= radius) matched.push({name:rName, active:rActive, id:doc.id, dist});
      }
      // Method 2: bounding box
      else if(r.maxLat && r.minLat && r.maxLng && r.minLng) {
        const inBox = lat<=parseFloat(r.maxLat) && lat>=parseFloat(r.minLat) &&
                      lng<=parseFloat(r.maxLng) && lng>=parseFloat(r.minLng);
        console.log(`[REGION] "${rName}" bbox → ${inBox?"✅ MATCH":"❌"}`);
        if(inBox) matched.push({name:rName, active:rActive, id:doc.id, dist:0});
      }
    });

    console.log(`[REGION] matched: ${matched.length} — ${JSON.stringify(matched.map(m=>m.name))}`);
    if(matched.length) {
      matched.sort((a,b)=>a.dist-b.dist);
      return matched[0]; // has .id → confirmed Firebase region
    }
    // No match in Firebase → NOT served (no OSM fallback)
    return { name: null, active: false, id: null };
  } catch(e) {
    console.error("detectRegion:", e?.message);
    return { name: null, active: false, id: null };
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
  const svcTotal   = parseFloat(servicePrice)||0;
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
        rows: services.map((s,i)=>({id:"svc_"+i, title:s.name.substring(0,24), description:s.name.length>24?s.name:""}))
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
        rows: [...service.types.map((t,i)=>({id:"typ_"+i, title:t.name.substring(0,24), description:(t.name.length>24?t.name.substring(24)+"  ":"")+`${t.price} OMR`})), backRow(getLang(session))]
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
          serviceId: service.id||null,
          serviceName: service.name||null,
          selectedType: {name: type.name||"", price: type.price||0},
          servicePrice: type.price||0,
          parts: [],
          couponId: null,
          couponCode: null,
          discount: 0
        });
        const lang2 = getLang(session);
        const partsRows = parts.slice(0,10).map((p,i) => ({
          id: "part_" + i,
          title: p.name.substring(0,24),
          description: `${p.name.length>24?p.name.substring(0,70)+" — ":""}${(parseFloat(p.price)||0).toFixed(3)} OMR${p.stock!==undefined?" · متوفر: "+p.stock:""}`
        }));
        partsRows.push({ id:"part_skip", title: lang2==="ar"?"0 — بدون قطع":"0 — No parts" });
        partsRows.push(backRow(lang2));
        await sendList(from,
          lang2==="ar"?"🔩 هل تريد إضافة قطع غيار؟":"🔩 Add spare parts?",
          lang2==="ar"?"القطع":"Parts",
          [{ title: lang2==="ar"?"القطع المتاحة":"Available Parts", rows: partsRows }]
        );
      }
      return;
    }

    // ── parts_ask & parts — unified handler ─────────────────────────────────────
    if(session.state==="parts_ask"){
      const cleanPartsData = {...session.data, pendingPartIdx:null, pendingMaxQty:null};
      await setSession(from, "parts", cleanPartsData);
      session.data = cleanPartsData;
      session.state = "parts";
    }
    if(session.state==="parts"){
      // Fetch parts fresh from DB
      const serviceIdForParts = session.data.serviceId||session.data.service?.id||"";
      const avail = await getPartsByService(serviceIdForParts);
      const selected = JSON.parse(JSON.stringify(session.data.parts||[]));
      const pending  = session.data.pendingPartIdx != null ? session.data.pendingPartIdx : undefined;

      // ── nav_back MUST be checked before any ID conversion ──
      if(text==="nav_back"){
        if(pending!==undefined){
          // In qty selection → back to parts list
          await setSession(from,"parts",{...session.data,pendingPartIdx:null,pendingMaxQty:null});
          const lang3b = getLang(session);
          const fp = await getPartsByService(serviceIdForParts);
          const rb = fp.slice(0,10).map((p,i)=>({id:"part_"+i,title:p.name.substring(0,24),description:`${p.name.length>24?p.name.substring(0,70)+" — ":""}${(parseFloat(p.price)||0).toFixed(3)} OMR${p.stock!==undefined?" · "+p.stock:""}`}));
          rb.push({id:"part_skip",title:lang3b==="ar"?"0 — بدون قطع":"0 — No parts"});
          rb.push(backRow(lang3b));
          await sendList(from,lang3b==="ar"?"🔩 اختر قطعة:":"🔩 Choose part:",lang3b==="ar"?"القطع":"Parts",[{title:lang3b==="ar"?"القطع المتاحة":"Available Parts",rows:rb}]);
        } else {
          await handleBack(from, session);
        }
        return;
      }

      // ── Convert list reply IDs (AFTER nav_back check) ──
      if(text==="part_skip")                                   text = "0";
      else if(text.startsWith("part_"))                        text = String(parseInt(text.replace("part_",""))+1);
      if(text.startsWith("qty_"))                              text = text.replace("qty_","");

      if(pending!==undefined){
        // "0" while waiting for qty = cancel part selection, go back to menu
        if(text==="0"||text==="part_skip"){
          await setSession(from,"parts",{...session.data,pendingPartIdx:undefined});
          const freshParts2 = await getPartsByService(session.data.serviceId||session.data.service?.id||"");
          const lang3 = getLang(session);
          const rows2 = freshParts2.slice(0,10).map((p,i)=>({
            id:"part_"+i,
            title:p.name.substring(0,24),
            description:`${(parseFloat(p.price)||0).toFixed(3)} OMR${p.stock!==undefined?" · متوفر: "+p.stock:""}`
          }));
          rows2.push({id:"part_skip",title:lang3==="ar"?"0 — بدون قطع":"0 — No parts"});
          rows2.push(backRow(lang3));
          await sendList(from,
            lang3==="ar"?"🔩 اختر قطعة أخرى:":"🔩 Choose another part:",
            lang3==="ar"?"القطع":"Parts",
            [{title:lang3==="ar"?"القطع المتاحة":"Available Parts",rows:rows2}]
          );
          return;
        }
        const qty = parseInt(text);
        const maxQty2 = session.data.pendingMaxQty || 5;
        const part = avail[pending];
        // Safety check - if part not found reset
        if(!part){
          await setSession(from,"parts",{...session.data,pendingPartIdx:undefined,pendingMaxQty:undefined});
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
      if(isNaN(num)||num<1||num>avail.length){ await sendMessage(from,Lx.invalidPart(avail.length)); return; }
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
        `🔩 *${part.name}*\n${ getLang(session)==="ar"?"اختر الكمية:":"Choose quantity:"}`,
        getLang(session)==="ar"?"الكمية":"Qty",
        [{title: getLang(session)==="ar"?"الكمية المطلوبة":"Required Qty", rows:qtyRows}]
      );
      return;
    }

    // ── coupon ────────────────────────────────────────────────────────────────
    if(session.state==="coupon"){
      if(text==="nav_back"){ await handleBack(from,session); return; }
      if(text==="coupon_skip"||text==="0"){ await goToConfirm(from,session,Lx,0,null); return; }
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

      // ── Step 1: كشف المنطقة من Firebase فقط ────────────────────────────────
      const regionObj    = await detectRegion(msg.location.latitude, msg.location.longitude);
      const regionFound  = !!regionObj?.id;            // true = found in Firebase
      const regionName   = regionFound && regionObj.name ? String(regionObj.name) : null;
      const regionActive = regionObj?.active !== false;

      // ── Step 2: منطقة غير موجودة في Firebase → غير مخدومة ───────────────
      if(!regionFound){
        await sendMessage(from, userLang==="ar"
          ? "📍 منطقتك ليست ضمن نطاق خدمتنا حالياً.\nسنقوم بتوسيع خدماتنا قريباً. شكراً! 🙏"
          : userLang==="ur"?"📍 آپ کا علاقہ ابھی ہماری سروس میں شامل نہیں۔ جلد توسیع ہوگی۔ 🙏"
          : "📍 Your area is not within our service coverage yet. We'll expand soon. Thank you! 🙏");
        await clearSession(from); return;
      }

      // ── Step 3: المنطقة موجودة لكن معطلة ───────────────────────────────────
      if(!regionActive){
        await sendMessage(from, userLang==="ar"
          ? `⚠️ عذراً، منطقة *${regionName}* غير مخدومة حالياً.`
          : `⚠️ Sorry, *${regionName}* is not currently served.`);
        await clearSession(from); return;
      }

      // ── Step 4: أخبر العميل بمنطقته ──────────────────────────────────────
      if(regionName) await sendMessage(from, Lx.regionDetected(regionName));

      // ── Step 5: احسب الإجمالي ────────────────────────────────────────────
      const parts      = session.data.parts||[];
      const rawTotal   = calcTotal(session.data.servicePrice||selectedType.price, parts);
      const discount   = session.data.discount||0;
      const totalPrice = Math.max(0, Math.round((rawTotal-discount)*1000)/1000);
      const partsText  = buildPartsText(parts);
      const orderId    = generateOrderId();

      const baseOrder = {
        orderId, customer:from,
        serviceName:service.name, serviceId:String(service.id||""),
        type:selectedType.name, servicePrice:session.data.servicePrice||selectedType.price,
        parts, totalPrice, discount,
        couponCode:session.data.couponCode||null,
        lang:userLang,
        region:regionName, regionId:regionObj.id,
        location:{latitude:msg.location.latitude, longitude:msg.location.longitude},
        createdAt:admin.firestore.FieldValue.serverTimestamp()
      };

      // ── Step 6: ابحث عن فني متاح ─────────────────────────────────────────
      const techs = await getAvailableTechs(service.id, regionName||"", [], regionObj.id||"");

      if(!techs.length){
        // ── لا فني → قائمة الانتظار ─────────────────────────────────────
        await db.collection("waiting_orders").doc(orderId).set({
          ...baseOrder, status:"waiting", technicianId:null, rejectedTechs:[]
        });
        if(session.data.couponId) await applyCoupon(session.data.couponId,from);
        await sendMessage(from, Lx.noTechAny);
        await sendMessage(from, Lx.waitingQueue ? Lx.waitingQueue(orderId) : `⏳ رقم طلبك: ${orderId}`);
        await clearSession(from); return;
      }

      // ── Step 7: يوجد فني → أنشئ الطلب ───────────────────────────────────
      const chosenTech = techs[0];
      await db.collection("orders").doc(orderId).set({
        ...baseOrder, technicianId:chosenTech.id, rejectedTechs:[], status:"pending"
      });

      if(session.data.couponId) await applyCoupon(session.data.couponId,from);

      // Notify tech with BUTTONS (accept/reject) + customer location
      const techPhone=normalize(chosenTech.phone);
      await sendButtons(techPhone,
        (LANGS[firstTechLang]||LANGS.en).newOrder(orderId,service.name,selectedType.name,partsText,totalPrice),
        [{id:"accept_"+orderId,title:(LANGS[firstTechLang]||LANGS.en).acceptBtn},{id:"reject_"+orderId,title:(LANGS[firstTechLang]||LANGS.en).rejectBtn}]
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

    await sendMessage(from,Lx.defaultMsg);
  } catch(err){ console.error("WEBHOOK ERROR:", err); }
});

// ─── goNextAfterParts ─────────────────────────────────────────────────────────

// ─── Back Navigation ──────────────────────────────────────────────────────────
function backRow(lang) {
  const labels = {ar:"↩️ رجوع", en:"↩️ Back", ur:"↩️ واپس", bn:"↩️ ফিরে যান", hi:"↩️ वापस"};
  return {id:"nav_back", title: labels[lang]||"↩️ رجوع"};
}

async function handleBack(from, session) {
  const lang = getLang(session);
  const Lx   = LANGS[lang]||LANGS.ar;
  const st   = session.state;

  // type → go back to service list
  if(st==="type"){
    const services = await getServices();
    await sendList(from, Lx.welcome, Lx.servicesBtn, [{
      title: Lx.chooseService,
      rows: services.map((s,i)=>({id:"svc_"+i, title:s.name.length>24?s.name.substring(0,22)+"..":s.name}))
    }]);
    await setSession(from,"service",{lang, services});
    return true;
  }

  // parts/parts_ask → go back to type list
  if(st==="parts"||st==="parts_ask"){
    const svcId = session.data.serviceId||session.data.service?.id;
    const svcName = session.data.serviceName||session.data.service?.name;
    // Try to get types from session first, else reload
    let types = session.data.service?.types||session.data.types||[];
    if(!types.length && svcId){
      const services = await getServices();
      types = services.find(s=>s.id===svcId)?.types||[];
    }
    if(types.length){
      await sendList(from, Lx.chooseType ? Lx.chooseType(svcName) : `🔧 ${svcName}`, Lx.typesBtn||"الأنواع", [{
        title: Lx.typesBtn||"الأنواع",
        rows: [...types.map((t,i)=>({id:"typ_"+i, title:t.name.substring(0,24), description:(t.name.length>24?t.name.substring(24)+"  ":"")+`${t.price} OMR`})), backRow(lang)]
      }]);
      await setSession(from,"type",{lang, service:{id:svcId,name:svcName,types}, discount:0, couponId:null, couponCode:null});
    }
    return true;
  }

  // coupon → go back to parts list (or type if no parts)
  if(st==="coupon"){
    const svcId = session.data.serviceId||session.data.service?.id||"";
    const parts = await getPartsByService(svcId);
    if(parts.length){
      const lang2 = lang;
      const partsRows = parts.slice(0,10).map((p,i)=>({
        id:"part_"+i, title:p.name.substring(0,24),
        description:`${(parseFloat(p.price)||0).toFixed(3)} OMR${p.stock!==undefined?" · "+p.stock:""}`
      }));
      partsRows.push({id:"part_skip", title:lang2==="ar"?"0 — بدون قطع":"0 — No parts"});
      partsRows.push(backRow(lang2));
      await sendList(from,
        lang2==="ar"?"🔩 اختر القطع:":"🔩 Choose parts:",
        lang2==="ar"?"القطع":"Parts",
        [{title:lang2==="ar"?"القطع المتاحة":"Available Parts", rows:partsRows}]
      );
      await setSession(from,"parts",{...session.data, parts:[], pendingPartIdx:null, pendingMaxQty:null});
    } else {
      // No parts → back to type
      await handleBack(from, {...session, state:"parts"});
    }
    return true;
  }

  // confirm → go back to coupon (or parts if no coupon)
  if(st==="confirm"){
    const hasCoupons = await checkActiveCoupons();
    const cleanData  = {...session.data, discount:0, couponId:null, couponCode:null, pendingPartIdx:null, pendingMaxQty:null};
    if(hasCoupons){
      await setSession(from,"coupon",cleanData);
      const lang2 = lang;
      await sendButtons(from,
        lang2==="ar"?"🎟 هل لديك كوبون خصم؟ أرسل الكود أو اضغط تخطي.":
        lang2==="ur"?"🎟 کیا آپ کے پاس ڈسکاؤنٹ کوڈ ہے؟ کوڈ بھیجیں یا چھوڑیں۔":
        "🎟 Do you have a discount coupon? Send code or skip.",
        [
          {id:"coupon_skip", title:lang2==="ar"?"تخطي":lang2==="ur"?"چھوڑیں":"Skip"},
          {id:"nav_back",    title:backRow(lang2).title}
        ]
      );
    } else {
      await handleBack(from, {...session, state:"coupon"});
    }
    return true;
  }

  // location → go back to confirm
  if(st==="location"){
    await goToConfirm(from, session, LANGS[lang]||LANGS.ar, session.data.discount||0, session.data.couponCode||null);
    return true;
  }

  return false;
}

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
    const cl = cleanData.lang||"ar";
    await sendButtons(from,
      LANGS[cl]?.couponPrompt||"🎟 هل لديك كوبون خصم؟ أرسل الكود أو اضغط تخطي.",
      [
        {id:"coupon_skip", title:cl==="ar"?"تخطي":cl==="ur"?"چھوڑیں":cl==="bn"?"এড়িয়ে যান":cl==="hi"?"छोड़ें":"Skip"},
        {id:"nav_back",    title:backRow(cl).title}
      ]
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
  // servicePrice: try all possible sources
  const svcPrice  = parseFloat(d.servicePrice) || parseFloat(d.selectedType?.price) || 0;
  const parts     = d.parts || [];
  const partsTotal= Math.round(parts.reduce((s,p)=>s+(parseFloat(p.price)||0)*(p.qty||1),0)*1000)/1000;
  const disc      = parseFloat(discount)||0;
  const total     = Math.max(0, Math.round((svcPrice + partsTotal - disc)*1000)/1000);
  const partsTxt  = buildPartsText(parts);

  console.log("goToConfirm:", {svcName, typeName, svcPrice, partsTotal, disc, total});

  await setSession(from,"confirm",{...d, discount:disc, couponCode, totalPrice:total, servicePrice:svcPrice});
  await sendButtons(from,
    Lx.confirmTitle(svcName, typeName, partsTxt, svcPrice, partsTotal, disc>0?disc:null, total),
    [{id:"confirm_yes",title:Lx.confirmYes},{id:"confirm_no",title:Lx.confirmNo},{id:"nav_back",title:backRow(d.lang||"ar").title}]
  );
}

// ─── Tech Handlers ────────────────────────────────────────────────────────────

// ─── Tech Language Menu ───────────────────────────────────────────────────────
async function sendLangMenu(techPhone, currentLang) {
  const tl = currentLang || "ar";
  const title =
    tl==="ar" ? "🌐 اختر لغتك" :
    tl==="ur" ? "🌐 اپنی زبان منتخب کریں" :
    tl==="bn" ? "🌐 আপনার ভাষা বেছে নিন" :
    tl==="hi" ? "🌐 अपनी भाषा चुनें" :
    "🌐 Choose your language";

  const rows = [
    { id:"lang_ar", title:"🇴🇲 عربي",    description:"Arabic"   },
    { id:"lang_en", title:"🇬🇧 English",  description:"English"  },
    { id:"lang_ur", title:"🇵🇰 اردو",     description:"Urdu"     },
    { id:"lang_bn", title:"🇧🇩 বাংলা",    description:"Bengali"  },
    { id:"lang_hi", title:"🇮🇳 हिंदी",    description:"Hindi"    },
  ];
  // Mark current lang
  rows.forEach(r => { if(r.id === "lang_"+tl) r.title = "✅ " + r.title; });

  await sendList(techPhone, title, tl==="ar"?"اختر":"Select",
    [{ title: tl==="ar"?"اللغات المتاحة":"Available Languages", rows }]
  );
}

async function handleTechMessage(techPhone, text, msg, tech) {
  // ── Order action buttons ────────────────────────────────────────────────────
  if(text.startsWith("accept_")){ await handleAccept(text.replace("accept_",""),techPhone,tech); return; }
  if(text.startsWith("reject_")){ await handleReject(text.replace("reject_",""),techPhone,tech); return; }
  if(text.startsWith("done_")){ await handleDone(text.replace("done_",""),techPhone,tech); return; }

  // ── Language selection from list ────────────────────────────────────────────
  if(text.startsWith("lang_")){
    const newLang = text.replace("lang_","");
    if(["ar","en","ur","bn","hi"].includes(newLang)){
      await db.collection("technicians").doc(tech.id).update({lang: newLang});
      const TLN = LANGS[newLang] || LANGS.en;
      const changed = TLN.langChanged || "✅ Language changed.";
      await sendMessage(techPhone, changed);
      // Show tech info in new lang
      const updatedTech = {...tech, lang: newLang};
      if(TLN.techInfo) await sendMessage(techPhone, TLN.techInfo(updatedTech));
    }
    return;
  }

  // ── "لغة" / "language" / "lang" → show language menu ──────────────────────
  const langTriggers = ["لغة","language","lang","lingua","langue","भाषा","ভাষা","زبان"];
  if(langTriggers.includes(text.toLowerCase().trim())){
    await sendLangMenu(techPhone, tech.lang||"ar");
    return;
  }

  // ── Legacy text-based lang change (ar/en/ur/bn/hi) ─────────────────────────
  if(["ar","en","ur","bn","hi"].includes(text.toLowerCase())){
    const newLang = text.toLowerCase();
    await db.collection("technicians").doc(tech.id).update({lang: newLang});
    const TLN = LANGS[newLang]||LANGS.en;
    await sendMessage(techPhone, TLN.langChanged||"✅ Language changed.");
    return;
  }

  // ── Default: show tech info + lang menu ────────────────────────────────────
  const tl = tech.lang || "ar";
  const TL = LANGS[tl] || LANGS.en;
  if(TL.techInfo) await sendMessage(techPhone, TL.techInfo(tech));
  // Show language selection list
  await sendLangMenu(techPhone, tl);
}


async function checkTechBalance(techId, techPhone, techLang) {
  const snap = await db.collection("technicians").doc(techId).get();
  if(!snap.exists) return true;
  const bal = parseFloat(snap.data()?.balance||0);
  if(bal < MIN_TECH_BALANCE){
    await db.collection("technicians").doc(techId).update({active:false});
    const tl = ["ar","en","ur","bn","hi"].includes(techLang)?techLang:"ar";
    const TL = LANGS[tl]||LANGS.en;
    const msg = TL.lowBalance
      ? TL.lowBalance(bal)
      : `⚠️ Balance: ${bal.toFixed(3)} OMR. Min required: 2.000 OMR. Please recharge.`;
    await sendMessage(techPhone, msg);
    return false;
  }
  return true;
}

async function handleAccept(orderId, techPhone, tech) {
  const allowed = await checkTechBalance(tech.id, techPhone, tech.lang||"ar");
  if(!allowed) return;
  const ref=db.collection("orders").doc(orderId); const snap=await ref.get();
  if(!snap.exists){ await sendMessage(techPhone,(LANGS[tech.lang||"ar"]||LANGS.en).orderNotFound); return; }
  const order=snap.data();
  if(order.status!=="pending"){ await sendMessage(techPhone,(LANGS[tech.lang||"ar"]||LANGS.en).alreadyProcessed); return; }
  await ref.update({status:"accepted"});
  await db.collection("technicians").doc(order.technicianId).update({active:false});
  const customerPhone=normalize(order.customer);
  const CL=LANGS[order.lang||"ar"];
  // Send customer info + location to tech
  await sendMessage(techPhone, (LANGS[tech.lang||"ar"]||LANGS.en).customerPhone(customerPhone));
  if(order.location?.latitude){
    // Send location so tech can navigate
    await sendLocation(techPhone, order.location.latitude, order.location.longitude);
    // Also send Google Maps link
    const mapsLink = `https://www.google.com/maps?q=${order.location.latitude},${order.location.longitude}`;
    await sendMessage(techPhone, `🗺️ موقع العميل على خرائط Google:\n${mapsLink}\n📍 المنطقة: ${order.region||"-"}`);
  }
  // Done button for tech
  const tld=tech.lang||"ar"; const TLD=LANGS[tld]||LANGS.en;
  await sendButtons(techPhone, TLD.orderDoneLabel(orderId), [{id:"done_"+orderId,title:TLD.orderDoneBtn}]);
  await sendMessage(customerPhone, CL.accepted(tech.name,tech.phone));
}

async function handleReject(orderId, techPhone, tech) {
  const ref=db.collection("orders").doc(orderId); const snap=await ref.get();
  if(!snap.exists){ await sendMessage(techPhone,LANGS.ar.orderNotFound); return; }
  const order=snap.data();
  if(order.status!=="pending"){ await sendMessage(techPhone,LANGS.ar.alreadyProcessed); return; }
  await sendMessage(techPhone,(LANGS[tech.lang||"ar"]||LANGS.en).techRejected);
  const rejected=[...(order.rejectedTechs||[]),order.technicianId];
  await ref.update({status:"pending",rejectedTechs:rejected});
  const customerPhone=normalize(order.customer);
  const CL=LANGS[order.lang||"ar"];
  await sendMessage(customerPhone,CL.rejected(orderId));
  const backup=await getAvailableTechs(order.serviceId,order.region||"",rejected);
  if(!backup.length){ await ref.update({status:"rejected"}); await sendMessage(customerPhone,CL.noBackupTech(orderId)); return; }
  await ref.update({technicianId:backup[0].id});
  const backupPhone = normalize(backup[0].phone);
  await sendButtons(backupPhone,
    LANGS.ar.newOrder(orderId,order.serviceName,order.type||"",buildPartsText(order.parts),order.totalPrice||0),
    [{id:"accept_"+orderId,title:LANGS.ar.acceptBtn},{id:"reject_"+orderId,title:LANGS.ar.rejectBtn}]
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
  if(order.status==="done"){ await sendMessage(techPhone,(LANGS[tech.lang||"ar"]||LANGS.en).alreadyDone); return; }
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
  await sendMessage(techPhone,(LANGS[tech.lang||"ar"]||LANGS.en).techDone(orderId,fee,newBal));
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
    await sendButtons(techPhone,
      LANGS.ar.newOrder(order.orderId, order.serviceName, order.type||"", partsText, order.totalPrice||0),
      [{id:"accept_"+orderId, title:LANGS.ar.acceptBtn}, {id:"reject_"+orderId, title:LANGS.ar.rejectBtn}]
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
      const techs = await getAvailableTechs(order.serviceId||serviceId, order.region||"", []);
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
    // Note: waiting orders are in waiting_orders collection
    const snap = await db.collection("waiting_orders").where("status","==","waiting").get();
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


async function autoReactivateTechs() {
  try {
    const snap = await db.collection("technicians").where("active","==",false).get();
    for(const doc of snap.docs){
      const t = doc.data();
      if((parseFloat(t.balance)||0) < MIN_TECH_BALANCE) continue;
      const busy = await db.collection("orders").where("technicianId","==",doc.id).where("status","in",["pending","accepted"]).limit(1).get();
      if(!busy.empty) continue;
      await doc.ref.update({active:true});
      console.log("[AUTO] reactivated:", t.name);
    }
  } catch(e){ console.error("autoReactivate:", e?.message); }
}
setInterval(autoReactivateTechs, 5*60*1000);
setTimeout(autoReactivateTechs, 8000);


// ── Admin: Suspend technician ─────────────────────────────────────────────────
app.post("/admin/suspend-tech", async(req,res)=>{
  try {
    const { techId, reason } = req.body;
    if(!techId||!reason) return res.status(400).json({error:"techId and reason required"});
    const snap = await db.collection("technicians").doc(techId).get();
    if(!snap.exists) return res.status(404).json({error:"Tech not found"});
    const tech = snap.data();
    const tl   = tech.lang || "ar";
    const TL   = LANGS[tl] || LANGS.ar;
    const msg  = TL.suspended
      ? TL.suspended(reason)
      : `⛔ تم إيقاف حسابك.\n\nالسبب: ${reason}`;
    await sendMessage(normalize(tech.phone), msg);
    res.json({success:true});
  } catch(e){ console.error("suspend-tech:", e?.message); res.status(500).json({error:e.message}); }
});

// ── Admin: Reactivate technician ──────────────────────────────────────────────
app.post("/admin/reactivate-tech", async(req,res)=>{
  try {
    const { techId } = req.body;
    if(!techId) return res.status(400).json({error:"techId required"});
    const snap = await db.collection("technicians").doc(techId).get();
    if(!snap.exists) return res.status(404).json({error:"Tech not found"});
    const tech = snap.data();
    const tl   = tech.lang || "ar";
    const TL   = LANGS[tl] || LANGS.ar;
    const msg  = TL.reactivated || "✅ تم تفعيل حسابك! أهلاً بك مجدداً.";
    await sendMessage(normalize(tech.phone), msg);
    res.json({success:true});
  } catch(e){ console.error("reactivate-tech:", e?.message); res.status(500).json({error:e.message}); }
});

app.listen(process.env.PORT||3000,()=>console.log("✅ TAQA Bot running"));
