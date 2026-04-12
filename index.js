const express = require(“express”);
const axios = require(“axios”);
const admin = require(“firebase-admin”);
const { v4: uuidv4 } = require(“uuid”);

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

const normalize = (p) => String(p).replace(/+/g, “”);

// ─── Language ─────────────────────────────────────────────────────────────────
const LANGS = {
ar: {
welcome:         “مرحبا! اختر الخدمة المطلوبة”,
servicesBtn:     “الخدمات”,
chooseService:   “الخدمات المتاحة”,
chooseTypes:     (s) => `اختر انواع الخدمة: ${s}\n(يمكنك اختيار اكثر من نوع)`,
typesBtn:        “الانواع”,
doneTypesRow:    “انتهيت من الانواع”,
addTypeRow:      “اضافة نوع اخر”,
addedType:       (name, price) => `تمت الاضافة: ${name} - ${price} ريال`,
chooseParts:     “اختر القطع المطلوبة:\n(يمكنك اختيار اكثر من قطعة)”,
partsBtn:        “القطع”,
donePartsRow:    “انتهيت من القطع”,
chooseQty:       (name, price) => `كم قطعة من "${name}"?\n(${price} ريال للقطعة)`,
qtyBtn:          “الكمية”,
addedPart:       (name, qty, total) => `تمت الاضافة: ${name} x${qty} = ${total} ريال`,
addMoreSvc:      “هل تريد اضافة خدمة اخرى؟”,
addMoreSvcBtn:   “اختيار”,
doneSvcRow:      “اكتمل طلبي”,
addSvcRow:       “اضافة خدمة اخرى”,
summary:         (lines, total) => `تلخيص طلبك:\n\n${lines}\nالاجمالي: ${total} ريال`,
confirmBtn:      “تاكيد”,
confirmRow:      “تاكيد الطلب”,
cancelRow:       “الغاء”,
sendLocation:    “ارسل موقعك لاتمام الطلب.”,
locationOnly:    “يرجى ارسال موقعك عبر واتساب.”,
orderSent:       (id) => `تم ارسال طلبك!\nرقم الطلب: ${id}\nسيتم اشعارك عند قبول الفني.`,
noTech:          “لا يوجد فني متاح الان. حاول لاحقا.”,
cancelled:       “تم الالغاء. ارسل مرحبا للبدء.”,
sessionExp:      “انتهت الجلسة. ارسل مرحبا للبدء.”,
activeOrder:     (id, st) => `لديك طلب نشط:\nرقم الطلب: ${id}\nالحالة: ${statusLabel(st,"ar")}`,
defaultMsg:      “ارسل مرحبا للبدء.”,
noTypes:         “لا توجد انواع لهذه الخدمة.”,
noParts:         “لا توجد قطع لهذه الخدمة.”,
techNewOrder:    (id, lines, total) => `طلب جديد!\nرقم الطلب: ${id}\n\n${lines}\nالاجمالي: ${total} ريال`,
acceptBtn:       “اختر”,
acceptRow:       “قبول الطلب”,
rejectRow:       “رفض الطلب”,
accepted:        (name, phone) => `تم قبول طلبك!\nالفني: ${name}\nرقمه: ${phone}\nفي الطريق اليك.`,
rejected:        (id) => `رفض الفني طلبك.\nرقم الطلب: ${id}\nارسل مرحبا للمحاولة مجددا.`,
techRejected:    “تم رفض الطلب.”,
completedMsg:    (id, lines, total) => `اكتمل طلبك!\nرقم الطلب: ${id}\n\n${lines}\nالاجمالي: ${total} ريال\nشكرا لثقتك بنا!`,
techDone:        (id, fee, bal) => `الطلب ${id} مكتمل.\nالعمولة: ${fee} ريال\nرصيدك: ${bal} ريال`,
ratePrompt:      “كيف تقيم خدمة الفني؟”,
rateBtn:         “التقييم”,
ratingDone:      (s) => `شكرا على تقييمك! منحت الفني ${s} نجوم`,
orderNotFound:   “الطلب غير موجود.”,
alreadyDone:     “الطلب مكتمل مسبقا.”,
alreadyProc:     “الطلب تمت معالجته.”,
custPhone:       (p) => `هاتف العميل: ${p}`,
doneBtn:         “انهاء”,
doneRow:         “انهاء الطلب”,
doneLabel:       (id) => `${id} اضغط عند الانهاء`,
alreadySelected: “هذا النوع محدد مسبقا.”,
},
en: {
welcome:         “Welcome! Choose a service”,
servicesBtn:     “Services”,
chooseService:   “Available Services”,
chooseTypes:     (s) => `Choose types for: ${s}\n(You can select multiple)`,
typesBtn:        “Types”,
doneTypesRow:    “Done with types”,
addTypeRow:      “Add another type”,
addedType:       (name, price) => `Added: ${name} - ${price} SAR`,
chooseParts:     “Choose parts:\n(You can select multiple)”,
partsBtn:        “Parts”,
donePartsRow:    “Done with parts”,
chooseQty:       (name, price) => `How many "${name}"?\n(${price} SAR each)`,
qtyBtn:          “Qty”,
addedPart:       (name, qty, total) => `Added: ${name} x${qty} = ${total} SAR`,
addMoreSvc:      “Add another service?”,
addMoreSvcBtn:   “Choose”,
doneSvcRow:      “Complete my order”,
addSvcRow:       “Add another service”,
summary:         (lines, total) => `Order Summary:\n\n${lines}\nTotal: ${total} SAR`,
confirmBtn:      “Confirm”,
confirmRow:      “Confirm Order”,
cancelRow:       “Cancel”,
sendLocation:    “Send your location to complete the order.”,
locationOnly:    “Please send your location using WhatsApp.”,
orderSent:       (id) => `Order sent!\nOrder ID: ${id}\nYou will be notified when accepted.`,
noTech:          “No technician available. Try later.”,
cancelled:       “Cancelled. Send mrhba to start.”,
sessionExp:      “Session expired. Send mrhba to start.”,
activeOrder:     (id, st) => `Active order:\nID: ${id}\nStatus: ${statusLabel(st,"en")}`,
defaultMsg:      “Send mrhba to start.”,
noTypes:         “No types for this service.”,
noParts:         “No parts for this service.”,
techNewOrder:    (id, lines, total) => `New Order!\nID: ${id}\n\n${lines}\nTotal: ${total} SAR`,
acceptBtn:       “Choose”,
acceptRow:       “Accept Order”,
rejectRow:       “Reject Order”,
accepted:        (name, phone) => `Order accepted!\nTech: ${name}\nPhone: ${phone}\nOn the way!`,
rejected:        (id) => `Technician rejected.\nID: ${id}\nSend mrhba to retry.`,
techRejected:    “Order rejected.”,
completedMsg:    (id, lines, total) => `Order completed!\nID: ${id}\n\n${lines}\nTotal: ${total} SAR\nThank you!`,
techDone:        (id, fee, bal) => `Order ${id} done.\nFee: ${fee} SAR\nBalance: ${bal} SAR`,
ratePrompt:      “Rate the technician:”,
rateBtn:         “Rate”,
ratingDone:      (s) => `Thanks! You gave ${s} stars`,
orderNotFound:   “Order not found.”,
alreadyDone:     “Order already completed.”,
alreadyProc:     “Order already processed.”,
custPhone:       (p) => `Customer phone: ${p}`,
doneBtn:         “Finish”,
doneRow:         “Mark as Done”,
doneLabel:       (id) => `${id} Mark when finished`,
alreadySelected: “This type is already selected.”,
}
};

function statusLabel(s, lang) {
const m = {
ar: { pending:“قيد الانتظار”, accepted:“مقبول”, done:“مكتمل”, rejected:“مرفوض” },
en: { pending:“Pending”, accepted:“Accepted”, done:“Done”, rejected:“Rejected” }
};
return (m[lang] && m[lang][s]) || s;
}

function getLang(session) {
return (session && session.data && session.data.lang) || “ar”;
}

// ─── Session ──────────────────────────────────────────────────────────────────
async function getSession(phone) {
const doc = await db.collection(“sessions”).doc(phone).get();
return doc.exists ? doc.data() : { state: null, data: {} };
}
async function setSession(phone, state, data) {
await db.collection(“sessions”).doc(phone).set({ state, data: data || {} });
}
async function clearSession(phone) {
await db.collection(“sessions”).doc(phone).delete();
}
function generateOrderId() {
return “ORD-” + uuidv4().split(”-”)[0].toUpperCase();
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────────
async function sendMessage(to, text) {
try {
await axios.post(
`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
{ messaging_product: “whatsapp”, to, text: { body: text } },
{ headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, “Content-Type”: “application/json” } }
);
} catch(e) { console.error(“sendMessage:”, e && e.message); }
}

async function sendList(to, body, button, sections) {
try {
await axios.post(
`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
{
messaging_product: “whatsapp”, to, type: “interactive”,
interactive: { type: “list”, body: { text: body }, action: { button, sections } }
},
{ headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, “Content-Type”: “application/json” } }
);
} catch(e) { console.error(“sendList:”, e && e.message); }
}

async function sendLocation(to, lat, lng) {
try {
await axios.post(
`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
{ messaging_product: “whatsapp”, to, type: “location”, location: { latitude: lat, longitude: lng } },
{ headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, “Content-Type”: “application/json” } }
);
} catch(e) { console.error(“sendLocation:”, e && e.message); }
}

// ─── DB ───────────────────────────────────────────────────────────────────────
async function getServices() {
const snap = await db.collection(“services”).get();
return snap.docs.map(d => ({ id: d.id, …d.data() }));
}
async function getPartsByService(serviceId) {
const snap = await db.collection(“parts”).where(“serviceId”, “==”, serviceId).get();
return snap.docs.map(d => ({ id: d.id, …d.data() }));
}
async function getTechByPhone(phone) {
const snap = await db.collection(“technicians”).where(“phone”, “==”, normalize(phone)).get();
if (snap.empty) return null;
return { id: snap.docs[0].id, …snap.docs[0].data() };
}
async function getAvailableTech(serviceId) {
const snap = await db.collection(“technicians”)
.where(“active”, “==”, true)
.where(“services”, “array-contains”, serviceId).get();
if (snap.empty) return null;
return { id: snap.docs[0].id, …snap.docs[0].data() };
}
async function getActiveOrder(phone) {
const snap = await db.collection(“orders”)
.where(“customer”, “==”, phone)
.where(“status”, “in”, [“pending”,“accepted”]).limit(1).get();
if (snap.empty) return null;
return { id: snap.docs[0].id, …snap.docs[0].data() };
}

// ─── Summary Builder ──────────────────────────────────────────────────────────
// services = [{ name, id, selectedTypes:[{name,price}], parts:[{name,qty,price}] }]
function buildSummary(services, lang) {
let lines = [];
let total = 0;
const isar = lang === “ar”;
services.forEach((svc, i) => {
const typesTotal = (svc.selectedTypes || []).reduce((s, t) => s + t.price, 0);
const partsTotal = (svc.parts || []).reduce((s, p) => s + p.price * p.qty, 0);
const svcTotal   = typesTotal + partsTotal;
total += svcTotal;
lines.push(`${i + 1}. ${svc.name}`);
if (svc.selectedTypes && svc.selectedTypes.length) {
lines.push(isar ? “  الخدمات:” : “  Services:”);
svc.selectedTypes.forEach(t => lines.push(`    - ${t.name}: ${t.price} ${isar ? "ريال" : "SAR"}`));
}
if (svc.parts && svc.parts.length) {
lines.push(isar ? “  القطع:” : “  Parts:”);
svc.parts.forEach(p => lines.push(`    - ${p.name} x${p.qty} = ${p.price * p.qty} ${isar ? "ريال" : "SAR"}`));
}
lines.push(isar ? `  المجموع: ${svcTotal} ريال` : `  Subtotal: ${svcTotal} SAR`);
lines.push(””);
});
return { text: lines.join(”\n”), total };
}

// ─── Rating ───────────────────────────────────────────────────────────────────
async function updateTechRating(techId, stars) {
const ref = db.collection(“technicians”).doc(techId);
await db.runTransaction(async tx => {
const snap = await tx.get(ref);
if (!snap.exists) return;
const d     = snap.data();
const count = (d.ratingCount || 0) + 1;
const avg   = (((d.rating || 0) * (count - 1)) + stars) / count;
tx.update(ref, { rating: Math.round(avg * 10) / 10, ratingCount: count });
});
}

async function sendRatingPrompt(to, orderId, lang) {
const l    = LANGS[lang];
const rows = [1,2,3,4,5].map(s => ({
id:          `rate_${orderId}_${s}`,
title:       “* “.repeat(s).trim(),
description: [“ضعيف”,“مقبول”,“جيد”,“جيد جدا”,“ممتاز”][s - 1]
}));
await sendList(to, l.ratePrompt, l.rateBtn, [{ title: lang === “ar” ? “اختر تقييمك” : “Choose Rating”, rows }]);
}

// ─── Send Types List ──────────────────────────────────────────────────────────
async function sendTypesList(from, service, selectedTypeNames, l) {
const remaining = (service.types || []).filter(t => !selectedTypeNames.includes(t.name));
if (!remaining.length) return false; // no more types
const rows = [
{ id: “types_done”, title: l.doneTypesRow },
…remaining.map((t, i) => ({
id:          `type_${i}_${Buffer.from(t.name).toString("base64").substring(0,10)}`,
title:       t.name.substring(0, 24),
description: `${t.price} SAR`
}))
].slice(0, 10);
await sendList(from, l.chooseTypes(service.name), l.typesBtn, [{ title: service.name, rows }]);
return true;
}

// ─── Send Parts List ──────────────────────────────────────────────────────────
async function sendPartsList(from, availableParts, selectedPartIds, l) {
const remaining = availableParts.filter(p => !selectedPartIds.includes(p.id));
const rows = [
{ id: “parts_done”, title: l.donePartsRow },
…remaining.map(p => ({
id:          `part_${p.id}`,
title:       p.name.substring(0, 24),
description: `${p.price} ${p.unit ? "/ " + p.unit : "SAR"}`
}))
].slice(0, 10);
await sendList(from, l.chooseParts, l.partsBtn, [{ title: l.partsBtn, rows }]);
}

// ─── Ask More Service ─────────────────────────────────────────────────────────
async function askMoreService(from, lang, completedSvcs) {
const l = LANGS[lang];
const { text: summaryText, total } = buildSummary(completedSvcs, lang);
await sendMessage(from, l.summary(summaryText, total));
await sendList(from, l.addMoreSvc, l.addMoreSvcBtn, [{
title: lang === “ar” ? “خيارات” : “Options”,
rows: [
{ id: “order_done”, title: l.doneSvcRow },
{ id: “more_svc”,   title: l.addSvcRow  }
]
}]);
}

// ─── Webhook ──────────────────────────────────────────────────────────────────
app.get(”/webhook”, (req, res) => {
if (req.query[“hub.verify_token”] === VERIFY_TOKEN) return res.send(req.query[“hub.challenge”]);
res.sendStatus(403);
});

app.post(”/webhook”, async (req, res) => {
res.sendStatus(200);
try {
const entry = req.body.entry;
if (!entry || !entry[0]) return;
const val = entry[0].changes && entry[0].changes[0] && entry[0].changes[0].value;
if (!val || !val.messages || !val.messages[0]) return;

```
const msg  = val.messages[0];
const from = normalize(msg.from);
let text = "";
if (msg.type === "text") text = msg.text.body.trim();
else if (msg.type === "interactive") {
  text = (msg.interactive.list_reply   && msg.interactive.list_reply.id)   ||
         (msg.interactive.button_reply && msg.interactive.button_reply.id) || "";
}
console.log("FROM:", from, "TEXT:", text);

// ── Tech commands ────────────────────────────────────────────────────────
const tech = await getTechByPhone(from);
if (tech) {
  if (text.startsWith("accept_")) { await handleAccept(text, from, tech); return; }
  if (text.startsWith("reject_")) { await handleReject(text, from); return; }
  if (text.startsWith("done_"))   { await handleDone(text, from, tech); return; }
  await sendMessage(from,
    `الاسم: ${tech.name}\nالهاتف: ${tech.phone}\nالتقييم: ${tech.rating ? `${tech.rating} (${tech.ratingCount || 0})` : "لا يوجد"}\nالرصيد: ${tech.balance || 0} ريال\nالحالة: ${tech.active ? "متاح" : "مشغول"}`
  );
  return;
}

// ── Rating ───────────────────────────────────────────────────────────────
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
    await sendMessage(from, LANGS[getLang(session)].ratingDone(stars));
  }
  return;
}

// ── Start ────────────────────────────────────────────────────────────────
const isAr    = ["مرحبا","هلا","اهلا"].includes(text);
const isEn    = ["mrhba","hello","hi"].includes(text);
const isStart = isAr || isEn;
const newLang = isAr ? "ar" : isEn ? "en" : null;

let session = await getSession(from);
const lang  = getLang(session);
const l     = LANGS[lang];

// ── No state or restart ──────────────────────────────────────────────────
if (!session.state || isStart) {
  const activeLang = newLang || lang;
  const AL = LANGS[activeLang];
  if (!isStart) {
    const activeOrder = await getActiveOrder(from);
    if (activeOrder) { await sendMessage(from, AL.activeOrder(activeOrder.orderId, activeOrder.status)); return; }
  }
  await clearSession(from);
  const services = await getServices();
  await sendList(from, AL.welcome, AL.servicesBtn, [{
    title: AL.chooseService,
    rows: services.map(s => ({ id: "svc_" + s.id, title: s.name.substring(0, 24) }))
  }]);
  await setSession(from, "pick_service", { lang: activeLang, completedSvcs: [] });
  return;
}

// ── State: pick_service ──────────────────────────────────────────────────
if (session.state === "pick_service" && text.startsWith("svc_")) {
  const serviceId = text.replace("svc_", "");
  const services  = await getServices();
  const service   = services.find(s => s.id === serviceId);
  if (!service) { await sendMessage(from, l.defaultMsg); return; }
  if (!service.types || !service.types.length) { await sendMessage(from, l.noTypes); return; }

  await setSession(from, "pick_types", {
    ...session.data,
    currentSvc: { id: service.id, name: service.name, types: service.types, selectedTypes: [], parts: [] }
  });
  await sendTypesList(from, service, [], l);
  return;
}

// ── State: pick_types — selecting multiple types ──────────────────────────
if (session.state === "pick_types") {
  // Done with types
  if (text === "types_done") {
    if (!(session.data.currentSvc.selectedTypes || []).length) {
      await sendMessage(from, lang === "ar" ? "يرجى اختيار نوع واحد على الاقل." : "Please select at least one type.");
      await sendTypesList(from, { name: session.data.currentSvc.name, types: session.data.currentSvc.types }, [], l);
      return;
    }
    // Go to parts
    const parts = await getPartsByService(session.data.currentSvc.id);
    await setSession(from, "pick_parts", { ...session.data, availableParts: parts });
    if (!parts.length) {
      // No parts — finalize this service
      const completed = session.data.currentSvc;
      const allSvcs   = [...(session.data.completedSvcs || []), completed];
      await setSession(from, "more_service", { ...session.data, completedSvcs: allSvcs, currentSvc: null });
      await askMoreService(from, lang, allSvcs);
      return;
    }
    await sendPartsList(from, parts, [], l);
    return;
  }

  // Picked a type
  if (text.startsWith("type_")) {
    const curSvc       = session.data.currentSvc;
    const allTypes     = curSvc.types || [];
    const selectedNms  = (curSvc.selectedTypes || []).map(t => t.name);

    // Find the type from id (format: type_INDEX_BASE64)
    const idx  = parseInt(text.split("_")[1]);
    const remaining = allTypes.filter(t => !selectedNms.includes(t.name));
    const picked    = remaining[idx];

    if (!picked) { await sendMessage(from, l.defaultMsg); return; }
    if (selectedNms.includes(picked.name)) { await sendMessage(from, l.alreadySelected); return; }

    const newSelectedTypes = [...(curSvc.selectedTypes || []), { name: picked.name, price: picked.price }];
    const updatedSvc = { ...curSvc, selectedTypes: newSelectedTypes };

    await setSession(from, "pick_types", { ...session.data, currentSvc: updatedSvc });
    await sendMessage(from, l.addedType(picked.name, picked.price));

    // Check if more types remain
    const stillRemaining = allTypes.filter(t => !newSelectedTypes.map(x => x.name).includes(t.name));
    if (!stillRemaining.length) {
      // All types selected — go to parts
      const parts = await getPartsByService(updatedSvc.id);
      await setSession(from, "pick_parts", { ...session.data, currentSvc: updatedSvc, availableParts: parts });
      if (!parts.length) {
        const allSvcs = [...(session.data.completedSvcs || []), updatedSvc];
        await setSession(from, "more_service", { ...session.data, completedSvcs: allSvcs, currentSvc: null });
        await askMoreService(from, lang, allSvcs);
        return;
      }
      await sendPartsList(from, parts, [], l);
      return;
    }

    // More types available
    await sendList(from,
      lang === "ar" ? "هل تريد اضافة نوع اخر؟" : "Add another type?",
      l.typesBtn,
      [{
        title: lang === "ar" ? "خيارات" : "Options",
        rows: [
          { id: "types_done", title: l.doneTypesRow },
          ...stillRemaining.map((t, i) => ({
            id:          `type_${i}_${Buffer.from(t.name).toString("base64").substring(0,10)}`,
            title:       t.name.substring(0, 24),
            description: `${t.price} SAR`
          }))
        ].slice(0, 10)
      }]
    );
    return;
  }
}

// ── State: pick_parts — selecting multiple parts ──────────────────────────
if (session.state === "pick_parts") {
  if (text === "parts_done") {
    const completed = session.data.currentSvc;
    const allSvcs   = [...(session.data.completedSvcs || []), completed];
    await setSession(from, "more_service", { ...session.data, completedSvcs: allSvcs, currentSvc: null });
    await askMoreService(from, lang, allSvcs);
    return;
  }

  if (text.startsWith("part_")) {
    const partId = text.replace("part_", "");
    const part   = (session.data.availableParts || []).find(p => p.id === partId);
    if (!part) { await sendMessage(from, l.defaultMsg); return; }

    await setSession(from, "pick_qty", {
      ...session.data,
      pendingPart: { id: part.id, name: part.name, price: part.price }
    });
    await sendList(from, l.chooseQty(part.name, part.price), l.qtyBtn, [{
      title: l.qtyBtn,
      rows: [1,2,3,4,5,10].map(q => ({ id: `qty_${q}`, title: `${q}` }))
    }]);
    return;
  }
}

// ── State: pick_qty ──────────────────────────────────────────────────────
if (session.state === "pick_qty" && text.startsWith("qty_")) {
  const qty         = parseInt(text.replace("qty_", ""));
  const pending     = session.data.pendingPart;
  const curSvc      = session.data.currentSvc;
  const availParts  = session.data.availableParts || [];
  const newParts    = [...(curSvc.parts || []), { id: pending.id, name: pending.name, price: pending.price, qty }];
  const selectedIds = newParts.map(p => p.id);
  const updatedSvc  = { ...curSvc, parts: newParts };

  await setSession(from, "pick_parts", {
    ...session.data,
    currentSvc:  updatedSvc,
    pendingPart: null
  });

  await sendMessage(from, l.addedPart(pending.name, qty, pending.price * qty));

  const remaining = availParts.filter(p => !selectedIds.includes(p.id));
  if (!remaining.length) {
    const allSvcs = [...(session.data.completedSvcs || []), updatedSvc];
    await setSession(from, "more_service", { ...session.data, completedSvcs: allSvcs, currentSvc: null });
    await askMoreService(from, lang, allSvcs);
    return;
  }
  await sendPartsList(from, availParts, selectedIds, l);
  return;
}

// ── State: more_service ──────────────────────────────────────────────────
if (session.state === "more_service") {
  if (text === "more_svc") {
    const services = await getServices();
    await setSession(from, "pick_service", { ...session.data, currentSvc: null });
    await sendList(from, l.welcome, l.servicesBtn, [{
      title: l.chooseService,
      rows: services.map(s => ({ id: "svc_" + s.id, title: s.name.substring(0, 24) }))
    }]);
    return;
  }
  if (text === "order_done") {
    const { text: summaryText, total } = buildSummary(session.data.completedSvcs || [], lang);
    await setSession(from, "confirm", { ...session.data });
    await sendList(from, l.summary(summaryText, total), l.confirmBtn, [{
      title: lang === "ar" ? "الطلب" : "Order",
      rows: [
        { id: "confirm_yes", title: l.confirmRow },
        { id: "confirm_no",  title: l.cancelRow  }
      ]
    }]);
    return;
  }
}

// ── State: confirm ───────────────────────────────────────────────────────
if (session.state === "confirm") {
  if (text === "confirm_no")  { await clearSession(from); await sendMessage(from, l.cancelled); return; }
  if (text === "confirm_yes") { await setSession(from, "location", session.data); await sendMessage(from, l.sendLocation); return; }
}

// ── State: location ──────────────────────────────────────────────────────
if (session.state === "location") {
  if (msg.type !== "location") { await sendMessage(from, l.locationOnly); return; }

  const svcs = session.data.completedSvcs || [];
  const { text: summaryText, total } = buildSummary(svcs, lang);
  const primarySvcId = svcs[0] && svcs[0].id;
  const availTech    = await getAvailableTech(primarySvcId);

  if (!availTech) { await sendMessage(from, l.noTech); await clearSession(from); return; }

  const orderId = generateOrderId();
  await db.collection("orders").doc(orderId).set({
    orderId,
    customer:     from,
    lang,
    services:     svcs,
    totalPrice:   total,
    technicianId: availTech.id,
    status:       "pending",
    location:     { latitude: msg.location.latitude, longitude: msg.location.longitude },
    createdAt:    admin.firestore.FieldValue.serverTimestamp()
  });

  const techPhone = normalize(availTech.phone);
  await sendMessage(techPhone, l.techNewOrder(orderId, summaryText, total));
  await sendList(techPhone, orderId, l.acceptBtn, [{
    title: "Order",
    rows: [
      { id: `accept_${orderId}`, title: l.acceptRow },
      { id: `reject_${orderId}`, title: l.rejectRow }
    ]
  }]);

  await sendMessage(from, l.orderSent(orderId));
  await clearSession(from);
  return;
}

await sendMessage(from, l.defaultMsg);
```

} catch(err) { console.error(“WEBHOOK ERROR:”, err); }
});

// ─── Tech Handlers ────────────────────────────────────────────────────────────
async function handleAccept(text, techPhone, tech) {
const orderId = text.replace(“accept_”, “”);
const ref     = db.collection(“orders”).doc(orderId);
const snap    = await ref.get();
if (!snap.exists) { await sendMessage(techPhone, LANGS.ar.orderNotFound); return; }
const order = snap.data();
if (order.status !== “pending”) { await sendMessage(techPhone, LANGS.ar.alreadyProc); return; }
await ref.update({ status: “accepted” });
await db.collection(“technicians”).doc(order.technicianId).update({ active: false });

const lang = order.lang || “ar”;
const l    = LANGS[lang];
const custPhone = normalize(order.customer);

await sendMessage(techPhone, l.custPhone(custPhone));
if (order.location) await sendLocation(techPhone, order.location.latitude, order.location.longitude);
await sendList(techPhone, l.doneLabel(orderId), l.doneBtn, [{
title: “Order”,
rows: [{ id: `done_${orderId}`, title: l.doneRow }]
}]);
await sendMessage(custPhone, l.accepted(tech.name, tech.phone));
}

async function handleReject(text, techPhone) {
const orderId = text.replace(“reject_”, “”);
const ref     = db.collection(“orders”).doc(orderId);
const snap    = await ref.get();
if (!snap.exists) { await sendMessage(techPhone, LANGS.ar.orderNotFound); return; }
const order = snap.data();
if (order.status !== “pending”) { await sendMessage(techPhone, LANGS.ar.alreadyProc); return; }
await ref.update({ status: “rejected” });
await sendMessage(techPhone, LANGS.ar.techRejected);
const lang = order.lang || “ar”;
await sendMessage(normalize(order.customer), LANGS[lang].rejected(orderId));
}

async function handleDone(text, techPhone, tech) {
const orderId = text.replace(“done_”, “”);
const ref     = db.collection(“orders”).doc(orderId);
const snap    = await ref.get();
if (!snap.exists) { await sendMessage(techPhone, LANGS.ar.orderNotFound); return; }
const order = snap.data();
if (order.status === “done”) { await sendMessage(techPhone, LANGS.ar.alreadyDone); return; }

await ref.update({ status: “done”, completedAt: admin.firestore.FieldValue.serverTimestamp() });

const techRef  = db.collection(“technicians”).doc(order.technicianId);
const techData = (await techRef.get()).data();
const fee      = Math.round((order.totalPrice || 0) * 0.2 * 100) / 100;
const newBal   = Math.max(0, ((techData && techData.balance) || 0) - fee);
await techRef.update({ balance: newBal, active: true });

const lang      = order.lang || “ar”;
const l         = LANGS[lang];
const custPhone = normalize(order.customer);
const { text: summaryText, total } = buildSummary(order.services || [], lang);

// Send full summary to customer
await sendMessage(custPhone, l.completedMsg(orderId, summaryText, total));
await sendRatingPrompt(custPhone, orderId, lang);
await sendMessage(techPhone, LANGS.ar.techDone(orderId, fee, newBal));
}

app.listen(process.env.PORT || 3000, () => console.log(“Server running”));