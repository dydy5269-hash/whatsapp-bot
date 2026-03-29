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

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

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

async function sendMessage(to, text) {
try {
await axios.post(
“https://graph.facebook.com/v18.0/” + PHONE_NUMBER_ID + “/messages”,
{ messaging_product: “whatsapp”, to: to, text: { body: text } },
{ headers: { Authorization: “Bearer “ + WHATSAPP_TOKEN, “Content-Type”: “application/json” } }
);
} catch (e) { console.error(“sendMessage:”, e && e.message); }
}

async function sendList(to, body, button, sections) {
try {
await axios.post(
“https://graph.facebook.com/v18.0/” + PHONE_NUMBER_ID + “/messages”,
{ messaging_product: “whatsapp”, to: to, type: “interactive”,
interactive: { type: “list”, body: { text: body }, action: { button: button, sections: sections } } },
{ headers: { Authorization: “Bearer “ + WHATSAPP_TOKEN, “Content-Type”: “application/json” } }
);
} catch (e) { console.error(“sendList:”, e && e.message); }
}

async function sendLocation(to, lat, lng) {
try {
await axios.post(
“https://graph.facebook.com/v18.0/” + PHONE_NUMBER_ID + “/messages”,
{ messaging_product: “whatsapp”, to: to, type: “location”, location: { latitude: lat, longitude: lng } },
{ headers: { Authorization: “Bearer “ + WHATSAPP_TOKEN, “Content-Type”: “application/json” } }
);
} catch (e) { console.error(“sendLocation:”, e && e.message); }
}

async function getServices() {
const snap = await db.collection(“services”).get();
return snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
}
async function getTechByPhone(phone) {
const snap = await db.collection(“technicians”).where(“phone”, “==”, normalize(phone)).get();
if (snap.empty) return null;
return Object.assign({ id: snap.docs[0].id }, snap.docs[0].data());
}
async function getAvailableTech(serviceId) {
const snap = await db.collection(“technicians”)
.where(“active”, “==”, true)
.where(“serviceIds”, “array-contains”, serviceId).get();
if (snap.empty) return null;
return Object.assign({ id: snap.docs[0].id }, snap.docs[0].data());
}
async function getActiveOrder(phone) {
const snap = await db.collection(“orders”)
.where(“customer”, “==”, phone)
.where(“status”, “in”, [“pending”, “accepted”]).limit(1).get();
if (snap.empty) return null;
return Object.assign({ id: snap.docs[0].id }, snap.docs[0].data());
}

app.get(”/webhook”, function(req, res) {
if (req.query[“hub.verify_token”] === VERIFY_TOKEN) return res.send(req.query[“hub.challenge”]);
res.sendStatus(403);
});

app.post(”/webhook”, async function(req, res) {
res.sendStatus(200);
try {
var entry = req.body.entry;
if (!entry || !entry[0]) return;
var changes = entry[0].changes;
if (!changes || !changes[0]) return;
var val = changes[0].value;
if (!val || !val.messages || !val.messages[0]) return;
var msg = val.messages[0];
var from = normalize(msg.from);
var text = “”;
if (msg.type === “text”) text = msg.text.body.trim();
else if (msg.type === “interactive”) {
text = (msg.interactive.list_reply && msg.interactive.list_reply.id) ||
(msg.interactive.button_reply && msg.interactive.button_reply.id) || “”;
}
console.log(“FROM:”, from, “TEXT:”, text);

```
var tech = await getTechByPhone(from);
if (tech) {
  if (text.indexOf("accept_") === 0) { await handleAccept(text, from, tech); return; }
  if (text.indexOf("reject_") === 0) { await handleReject(text, from); return; }
  if (text.indexOf("done_") === 0) { await handleDone(text, from, tech); return; }
  await sendMessage(from,
    "Name: " + tech.name + "\nPhone: " + tech.phone +
    "\nRating: " + (tech.rating || "N/A") +
    "\nBalance: " + (tech.balance || 0) +
    "\nStatus: " + (tech.active ? "Available" : "Busy") +
    "\nServices: " + ((tech.serviceIds || []).join(", "))
  );
  return;
}

var session = await getSession(from);
if (!session.state || text === "mrhba") {
  var activeOrder = await getActiveOrder(from);
  if (activeOrder) {
    await sendMessage(from,
      "You have an active order\nID: " + activeOrder.orderId +
      "\nService: " + activeOrder.serviceName +
      "\nStatus: " + activeOrder.status
    );
    return;
  }
  await clearSession(from);
  var services = await getServices();
  await sendList(from, "Welcome! Choose a service", "Services", [{
    title: "Available Services",
    rows: services.map(function(s) { return { id: "service_" + s.id, title: s.name.substring(0, 24) }; })
  }]);
  await setSession(from, "main", {});
  return;
}

if (session.state === "main" && text.indexOf("service_") === 0) {
  var services = await getServices();
  var id = text.replace("service_", "");
  var service = services.find(function(s) { return s.id === id; });
  if (!service) { await sendMessage(from, "Service not found. Send mrhba to start."); return; }
  await setSession(from, "type", { service: service });
  await sendList(from, service.name + " - Choose type", "Types", [{
    title: "Available Types",
    rows: service.types.map(function(t, i) {
      return { id: "type_" + i, title: t.name.substring(0, 24), description: t.price + " SAR" };
    })
  }]);
  return;
}

if (session.state === "type" && text.indexOf("type_") === 0) {
  var index = parseInt(text.replace("type_", ""));
  var service = session.data && session.data.service;
  if (!service || isNaN(index) || !service.types[index]) {
    await sendMessage(from, "Error. Send mrhba to restart."); await clearSession(from); return;
  }
  var type = service.types[index];
  await setSession(from, "confirm", { service: service, selectedType: type });
  await sendList(from,
    "Confirm Order\nService: " + service.name + "\nType: " + type.name + "\nPrice: " + type.price + " SAR",
    "Action", [{ title: "Confirm", rows: [{ id: "yes", title: "Confirm Order" }, { id: "no", title: "Cancel" }] }]
  );
  return;
}

if (session.state === "confirm") {
  if (text === "no") { await clearSession(from); await sendMessage(from, "Order cancelled. Send mrhba to start."); return; }
  if (text === "yes") { await setSession(from, "location", session.data); await sendMessage(from, "Send your location to complete the order."); return; }
}

if (session.state === "location") {
  if (msg.type !== "location") { await sendMessage(from, "Please send your location using WhatsApp location feature."); return; }
  var service = session.data && session.data.service;
  var selectedType = session.data && session.data.selectedType;
  if (!service || !selectedType) { await sendMessage(from, "Session expired. Send mrhba."); await clearSession(from); return; }
  var tech = await getAvailableTech(service.id);
  if (!tech) { await sendMessage(from, "No technician available. Try later."); await clearSession(from); return; }
  var orderId = generateOrderId();
  await db.collection("orders").doc(orderId).set({
    orderId: orderId, customer: from, serviceName: service.name, serviceId: service.id,
    type: selectedType.name, price: selectedType.price, technicianId: tech.id, status: "pending",
    location: { latitude: msg.location.latitude, longitude: msg.location.longitude },
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  var techPhone = normalize(tech.phone);
  await sendMessage(techPhone, "New Order!\nID: " + orderId + "\nService: " + service.name + "\nType: " + selectedType.name + "\nPrice: " + selectedType.price + " SAR");
  await sendList(techPhone, "Accept this order?", "Choose", [{ title: "Order", rows: [{ id: "accept_" + orderId, title: "Accept" }, { id: "reject_" + orderId, title: "Reject" }] }]);
  await sendMessage(from, "Order sent!\nOrder ID: " + orderId + "\nYou will be notified when accepted.");
  await clearSession(from);
  return;
}

await sendMessage(from, "Send mrhba to start.");
```

} catch (err) { console.error(“WEBHOOK ERROR:”, err); }
});

async function handleAccept(text, techPhone, tech) {
var orderId = text.replace(“accept_”, “”);
var ref = db.collection(“orders”).doc(orderId);
var snap = await ref.get();
if (!snap.exists) { await sendMessage(techPhone, “Order not found.”); return; }
var order = snap.data();
if (order.status !== “pending”) { await sendMessage(techPhone, “Order already processed.”); return; }
await ref.update({ status: “accepted” });
await db.collection(“technicians”).doc(order.technicianId).update({ active: false });
var customerPhone = normalize(order.customer);
await sendMessage(techPhone, “Customer phone: “ + customerPhone);
if (order.location && order.location.latitude) await sendLocation(techPhone, order.location.latitude, order.location.longitude);
await sendList(techPhone, orderId + “ - Finish when done”, “Done”, [{ title: “Order”, rows: [{ id: “done_” + orderId, title: “Finish Order” }] }]);
await sendMessage(customerPhone, “Order accepted!\nTech: “ + tech.name + “\nPhone: “ + tech.phone + “\nOn the way.\nOrder ID: “ + orderId);
}

async function handleReject(text, techPhone) {
var orderId = text.replace(“reject_”, “”);
var ref = db.collection(“orders”).doc(orderId);
var snap = await ref.get();
if (!snap.exists) { await sendMessage(techPhone, “Order not found.”); return; }
var order = snap.data();
if (order.status !== “pending”) { await sendMessage(techPhone, “Order already processed.”); return; }
await ref.update({ status: “rejected” });
await sendMessage(techPhone, “Order rejected.”);
await sendMessage(normalize(order.customer), “Sorry, technician rejected your order.\nID: “ + orderId + “\nSend mrhba to retry.”);
}

async function handleDone(text, techPhone, tech) {
var orderId = text.replace(“done_”, “”);
var ref = db.collection(“orders”).doc(orderId);
var snap = await ref.get();
if (!snap.exists) { await sendMessage(techPhone, “Order not found.”); return; }
var order = snap.data();
if (order.status === “done”) { await sendMessage(techPhone, “Order already completed.”); return; }
await ref.update({ status: “done”, completedAt: admin.firestore.FieldValue.serverTimestamp() });
var techRef = db.collection(“technicians”).doc(order.technicianId);
var techData = (await techRef.get()).data();
var fee = order.price * 0.2;
var newBalance = Math.max(0, ((techData && techData.balance) || 0) - fee);
await techRef.update({ balance: newBalance, active: true });
await sendMessage(normalize(order.customer), “Order completed!\nID: “ + orderId + “\nThank you!”);
await sendMessage(techPhone, “Order “ + orderId + “ done.\nFee: “ + fee + “ SAR\nBalance: “ + newBalance + “ SAR”);
}

app.listen(process.env.PORT || 3000, function() { console.log(“Server running”); });