const express = require(“express”);
const axios = require(“axios”);
const admin = require(“firebase-admin”);
const { v4: uuidv4 } = require(“uuid”);

const app = express();
app.use(express.json());

// ===== FIREBASE =====
if (!admin.apps.length) {
admin.initializeApp({
credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY)),
});
}
const db = admin.firestore();

// ===== ENV =====
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// ===== HELPERS =====
const normalize = (p) => String(p).replace(/+/g, “”);

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

// ===== SEND =====
async function sendMessage(to, text) {
try {
await axios.post(
“https://graph.facebook.com/v18.0/” + PHONE_NUMBER_ID + “/messages”,
{ messaging_product: “whatsapp”, to: to, text: { body: text } },
{ headers: { Authorization: “Bearer “ + WHATSAPP_TOKEN, “Content-Type”: “application/json” } }
);
} catch (err) {
console.error(“sendMessage error:”, err && err.response && err.response.data || err.message);
}
}

async function sendList(to, body, button, sections) {
try {
await axios.post(
“https://graph.facebook.com/v18.0/” + PHONE_NUMBER_ID + “/messages”,
{
messaging_product: “whatsapp”,
to: to,
type: “interactive”,
interactive: { type: “list”, body: { text: body }, action: { button: button, sections: sections } }
},
{ headers: { Authorization: “Bearer “ + WHATSAPP_TOKEN, “Content-Type”: “application/json” } }
);
} catch (err) {
console.error(“sendList error:”, err && err.response && err.response.data || err.message);
}
}

async function sendLocation(to, lat, lng) {
try {
await axios.post(
“https://graph.facebook.com/v18.0/” + PHONE_NUMBER_ID + “/messages”,
{ messaging_product: “whatsapp”, to: to, type: “location”, location: { latitude: lat, longitude: lng } },
{ headers: { Authorization: “Bearer “ + WHATSAPP_TOKEN, “Content-Type”: “application/json” } }
);
} catch (err) {
console.error(“sendLocation error:”, err && err.response && err.response.data || err.message);
}
}

// ===== DATABASE =====
async function getServices() {
const snap = await db.collection(“services”).get();
return snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
}

async function getTechByPhone(phone) {
const normalized = normalize(phone);
const snap = await db.collection(“technicians”).where(“phone”, “==”, normalized).get();
if (snap.empty) return null;
return Object.assign({ id: snap.docs[0].id }, snap.docs[0].data());
}

async function getAvailableTech(serviceId) {
const snap = await db.collection(“technicians”)
.where(“active”, “==”, true)
.where(“serviceIds”, “array-contains”, serviceId)
.get();
if (snap.empty) return null;
return Object.assign({ id: snap.docs[0].id }, snap.docs[0].data());
}

async function getActiveOrder(customerPhone) {
const snap = await db.collection(“orders”)
.where(“customer”, “==”, customerPhone)
.where(“status”, “in”, [“pending”, “accepted”])
.limit(1)
.get();
if (snap.empty) return null;
return Object.assign({ id: snap.docs[0].id }, snap.docs[0].data());
}

// ===== VERIFY =====
app.get(”/webhook”, function(req, res) {
if (req.query[“hub.verify_token”] === VERIFY_TOKEN) {
return res.send(req.query[“hub.challenge”]);
}
res.sendStatus(403);
});

// ===== WEBHOOK =====
app.post(”/webhook”, async function(req, res) {
res.sendStatus(200);
try {
const msg = req.body.entry &&
req.body.entry[0] &&
req.body.entry[0].changes &&
req.body.entry[0].changes[0] &&
req.body.entry[0].changes[0].value &&
req.body.entry[0].changes[0].value.messages &&
req.body.entry[0].changes[0].value.messages[0];
if (!msg) return;

```
const from = normalize(msg.from);
let text = "";
if (msg.type === "text") {
  text = msg.text.body.trim();
} else if (msg.type === "interactive") {
  text = (msg.interactive && msg.interactive.list_reply && msg.interactive.list_reply.id) ||
         (msg.interactive && msg.interactive.button_reply && msg.interactive.button_reply.id) || "";
}

console.log("FROM:", from, "TEXT:", text, "TYPE:", msg.type);

// =====  =====
const techCheck = await getTechByPhone(from);
if (techCheck) {
  if (text.startsWith("accept_")) { await handleAccept(text, from, techCheck); return; }
  if (text.startsWith("reject_")) { await handleReject(text, from); return; }
  if (text.startsWith("done_")) { await handleDone(text, from, techCheck); return; }

  await sendMessage(from,
    "\n\n" +
    ": " + techCheck.name + "\n" +
    ": " + techCheck.phone + "\n" +
    ": " + (techCheck.rating || " ") + "\n" +
    ": " + (techCheck.balance || 0) + " \n" +
    ": " + (techCheck.active ? "" : "") + "\n" +
    "Services: " + ((techCheck.serviceIds || []).join(", "))
  );
  return;
}

// =====  =====
const session = await getSession(from);

if (!session.state || text === "mrhba") {
  const activeOrder = await getActiveOrder(from);
  if (activeOrder) {
    await sendMessage(from,
      "   \n\n" +
      " Order: " + activeOrder.orderId + "\n" +
      ": " + activeOrder.serviceName + "\n" +
      ": " + activeOrder.type + "\n" +
      ": " + activeOrder.price + " \n" +
      ": " + (activeOrder.status === "pending" ? " " : " ") + "\n\n" +
      "   Order ."
    );
    return;
  }

  await clearSession(from);
  const services = await getServices();
  await sendList(from, "mrhba! Choose ", "Services", [{
    title: "Services",
    rows: services.map(function(s) { return { id: "service_" + s.id, title: s.name.substring(0, 24) }; })
  }]);
  await setSession(from, "main", {});
  return;
}

if (session.state === "main" && text.startsWith("service_")) {
  const services = await getServices();
  const id = text.replace("service_", "");
  const service = services.find(function(s) { return s.id === id; });
  if (!service) { await sendMessage(from, "    mrhba "); return; }
  await setSession(from, "type", { service: service });
  await sendList(from, service.name + "\nChoose ", "Types", [{
    title: "Types",
    rows: service.types.map(function(t, i) {
      return { id: "type_" + i, title: t.name.substring(0, 24), description: t.price + " " };
    })
  }]);
  return;
}

if (session.state === "type" && text.startsWith("type_")) {
  const index = parseInt(text.replace("type_", ""));
  const service = session.data && session.data.service;
  if (!service || isNaN(index) || !service.types || !service.types[index]) {
    await sendMessage(from, "   mrhba ");
    await clearSession(from);
    return;
  }
  const type = service.types[index];
  await setSession(from, "confirm", { service: service, selectedType: type });
  await sendList(from,
    "Confirm Order\n\n: " + service.name + "\n: " + type.name + "\n: " + type.price + " ",
    "Action",
    [{ title: "Confirm", rows: [{ id: "yes", title: "Confirm Order" }, { id: "no", title: "Cancel" }] }]
  );
  return;
}

if (session.state === "confirm") {
  if (text === "no") {
    await clearSession(from);
    await sendMessage(from, " Cancel Order.  mrhba   .");
    return;
  }
  if (text === "yes") {
    await setSession(from, "location", session.data);
    await sendMessage(from, "    Order.");
    return;
  }
}

if (session.state === "location") {
  if (msg.type !== "location") {
    await sendMessage(from, "       WhatsApp.");
    return;
  }
  const service = session.data && session.data.service;
  const selectedType = session.data && session.data.selectedType;
  if (!service || !selectedType) {
    await sendMessage(from, "   mrhba .");
    await clearSession(from);
    return;
  }
  const tech = await getAvailableTech(service.id);
  if (!tech) {
    await sendMessage(from, "       .");
    await clearSession(from);
    return;
  }
  const orderId = generateOrderId();
  await db.collection("orders").doc(orderId).set({
    orderId: orderId,
    customer: from,
    serviceName: service.name,
    serviceId: service.id,
    type: selectedType.name,
    price: selectedType.price,
    technicianId: tech.id,
    status: "pending",
    location: { latitude: msg.location.latitude, longitude: msg.location.longitude },
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  const techPhone = normalize(tech.phone);
  await sendMessage(techPhone,
    " !\n\n Order: " + orderId + "\n: " + service.name +
    "\n: " + selectedType.name + "\n: " + selectedType.price + " "
  );
  await sendList(techPhone, "   Order", "Choose", [{
    title: "Order",
    rows: [
      { id: "accept_" + orderId, title: " Order" },
      { id: "reject_" + orderId, title: " Order" }
    ]
  }]);
  await sendMessage(from, "  !\n\n : " + orderId + "\n    Order.");
  await clearSession(from);
  return;
}

await sendMessage(from, " mrhba .");
```

} catch (err) {
console.error(“WEBHOOK ERROR:”, err);
}
});

// =====  =====
async function handleAccept(text, techPhone, tech) {
const orderId = text.replace(“accept_”, “”);
const ref = db.collection(“orders”).doc(orderId);
const snap = await ref.get();
if (!snap.exists) { await sendMessage(techPhone, “Order  .”); return; }
const order = snap.data();
if (order.status !== “pending”) { await sendMessage(techPhone, “   Order .”); return; }
await ref.update({ status: “accepted” });
await db.collection(“technicians”).doc(order.technicianId).update({ active: false });
const customerPhone = normalize(order.customer);
await sendMessage(techPhone, “ :\n: “ + customerPhone);
if (order.location && order.location.latitude) {
await sendLocation(techPhone, order.location.latitude, order.location.longitude);
}
await sendList(techPhone, orderId + “\n    Done”, “Done”, [{
title: “Order”,
rows: [{ id: “done_” + orderId, title: “Done Order” }]
}]);
await sendMessage(customerPhone,
“  !\n\n: “ + tech.name + “\n: “ + tech.phone +
“\n   .\n\n Order: “ + orderId
);
}

// =====  =====
async function handleReject(text, techPhone) {
const orderId = text.replace(“reject_”, “”);
const ref = db.collection(“orders”).doc(orderId);
const snap = await ref.get();
if (!snap.exists) { await sendMessage(techPhone, “Order  .”); return; }
const order = snap.data();
if (order.status !== “pending”) { await sendMessage(techPhone, “   Order .”); return; }
await ref.update({ status: “rejected” });
const customerPhone = normalize(order.customer);
await sendMessage(techPhone, “  Order.”);
await sendMessage(customerPhone, “      .\n Order: “ + orderId + “\n\n mrhba  Order.”);
}

// ===== Done =====
async function handleDone(text, techPhone, tech) {
const orderId = text.replace(“done_”, “”);
const ref = db.collection(“orders”).doc(orderId);
const snap = await ref.get();
if (!snap.exists) { await sendMessage(techPhone, “Order  .”); return; }
const order = snap.data();
if (order.status === “done”) { await sendMessage(techPhone, “ Order   .”); return; }
await ref.update({ status: “done”, completedAt: admin.firestore.FieldValue.serverTimestamp() });
const techRef = db.collection(“technicians”).doc(order.technicianId);
const techData = (await techRef.get()).data();
const fee = order.price * 0.2;
const newBalance = Math.max(0, (techData && techData.balance || 0) - fee);
await techRef.update({ balance: newBalance, active: true });
const customerPhone = normalize(order.customer);
await sendMessage(customerPhone, “   !\n Order: “ + orderId + “\n  “);
await sendMessage(techPhone, “ Done Order “ + orderId + “\n : “ + fee + “ \n : “ + newBalance + “ “);
}

app.listen(process.env.PORT || 3000, function() {
console.log(“Server running”);
});