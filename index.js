const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

/*
==============================
Firebase initialization
==============================
*/

let serviceAccount;

try {

    if (!process.env.FIREBASE_KEY) {
        throw new Error("FIREBASE_KEY not found");
    }

    const decoded = Buffer.from(
        process.env.FIREBASE_KEY,
        "base64"
    ).toString("utf8");

    serviceAccount = JSON.parse(decoded);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });

    console.log("Firebase connected");

} catch (error) {

    console.log("Firebase error:", error.message);

}

const db = admin.firestore();

/*
==============================
Load WhatsApp settings
==============================
*/

let WHATSAPP_TOKEN = "";
let PHONE_NUMBER_ID = "";
let VERIFY_TOKEN = "123456";

async function loadSettings() {

    const doc = await db.collection("settings")
        .doc("whatsapp")
        .get();

    if (doc.exists) {

        const data = doc.data();

        WHATSAPP_TOKEN = data.token;
        PHONE_NUMBER_ID = data.phone_number;
        VERIFY_TOKEN = data.verify_token;

        console.log("WhatsApp settings loaded");

    }

}

loadSettings();

/*
==============================
Send WhatsApp message
==============================
*/

async function sendMessage(to, text) {

    await axios.post(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
        {
            messaging_product: "whatsapp",
            to: to,
            type: "text",
            text: {
                body: text
            }
        },
        {
            headers: {
                Authorization: `Bearer ${WHATSAPP_TOKEN}`,
                "Content-Type": "application/json"
            }
        }
    );

}

/*
==============================
Send services list
==============================
*/

async function sendServices(to) {

    const snapshot = await db.collection("services")
        .where("active", "==", true)
        .get();

    let text = "اختر الخدمة المطلوبة:\n\n";

    snapshot.forEach(doc => {

        const s = doc.data();

        text += `${s.emoji} ${s.name}\n`;

    });

    await sendMessage(to, text);

}

/*
==============================
Find technician
==============================
*/

async function findTechnician(service) {

    const snapshot = await db.collection("technicians")
        .where("service", "==", service)
        .where("active", "==", true)
        .limit(1)
        .get();

    if (snapshot.empty) return null;

    return snapshot.docs[0];

}

/*
==============================
Create order
==============================
*/

async function createOrder(userPhone, serviceId) {

    const order = {

        userPhone,
        serviceId,
        status: "pending",
        createdAt: new Date()

    };

    const ref = await db.collection("orders").add(order);

    return ref.id;

}

/*
==============================
Send order to technician
==============================
*/

async function sendOrderToTechnician(orderId, technicianDoc, userPhone, serviceId) {

    const tech = technicianDoc.data();

    const text =
        `طلب جديد\n\n` +
        `الخدمة: ${serviceId}\n` +
        `العميل: ${userPhone}\n\n` +
        `اكتب:\n` +
        `قبول ${orderId}\n` +
        `او\n` +
        `رفض ${orderId}`;

    await sendMessage(tech.phone, text);

}

/*
==============================
Handle technician response
==============================
*/

async function handleTechnicianResponse(from, message) {

    if (message.startsWith("قبول")) {

        const orderId = message.split(" ")[1];

        await db.collection("orders")
            .doc(orderId)
            .update({
                status: "accepted",
                technician: from
            });

        const order = await db.collection("orders")
            .doc(orderId)
            .get();

        await sendMessage(
            order.data().userPhone,
            "تم قبول طلبك وجاري التوجه إليك"
        );

    }

    if (message.startsWith("رفض")) {

        const orderId = message.split(" ")[1];

        await db.collection("orders")
            .doc(orderId)
            .update({
                status: "rejected"
            });

        const order = await db.collection("orders")
            .doc(orderId)
            .get();

        await sendMessage(
            order.data().userPhone,
            "تم رفض الطلب وسيتم محاولة إرسال فني آخر"
        );

    }

}

/*
==============================
Webhook verify
==============================
*/

app.get("/webhook", (req, res) => {

    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {

        res.send(challenge);

    } else {

        res.sendStatus(403);

    }

});

/*
==============================
Webhook receive messages
==============================
*/

app.post("/webhook", async (req, res) => {

    try {

        const entry = req.body.entry?.[0];
        const changes = entry?.changes?.[0];
        const message = changes?.value?.messages?.[0];

        if (!message) return res.sendStatus(200);

        const from = message.from;
        const text = message.text?.body;

        console.log("Message:", text);

        if (text === "مرحبا") {

            await sendServices(from);

            return res.sendStatus(200);

        }

        const services = await db.collection("services").get();

        let selectedService = null;

        services.forEach(doc => {

            if (text.includes(doc.data().name)) {

                selectedService = doc.id;

            }

        });

        if (selectedService) {

            const orderId = await createOrder(from, selectedService);

            const technician = await findTechnician(selectedService);

            if (!technician) {

                await sendMessage(from, "لا يوجد فني متاح حالياً");

                return res.sendStatus(200);

            }

            await sendOrderToTechnician(
                orderId,
                technician,
                from,
                selectedService
            );

            await sendMessage(
                from,
                "تم إرسال الطلب للفني"
            );

            return res.sendStatus(200);

        }

        await handleTechnicianResponse(from, text);

        res.sendStatus(200);

    } catch (error) {

        console.log(error);

        res.sendStatus(500);

    }

});

/*
==============================
Start server
==============================
*/

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

    console.log("Server running on port", PORT);

});
