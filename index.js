const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json());

/*
====================
Firebase init
====================
*/

let serviceAccount;

try {

    const decoded = Buffer
        .from(process.env.FIREBASE_KEY, "base64")
        .toString("utf8");

    serviceAccount = JSON.parse(decoded);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });

    console.log("Firebase connected");

} catch (e) {

    console.log("Firebase error:", e.message);
}

const db = admin.firestore();

/*
====================
WhatsApp config
====================
*/

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

/*
====================
Send text message
====================
*/

async function sendMessage(to, message) {

    await axios.post(

        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,

        {
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body: message }
        },

        {
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                "Content-Type": "application/json"
            }
        }
    );
}

/*
====================
Send buttons
====================
*/

async function sendButtons(to) {

    await axios.post(

        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,

        {
            messaging_product: "whatsapp",
            to,
            type: "interactive",

            interactive: {

                type: "button",

                body: {
                    text: "اختر الخدمة المطلوبة"
                },

                action: {

                    buttons: [

                        {
                            type: "reply",
                            reply: {
                                id: "electricity",
                                title: "⚡ كهرباء"
                            }
                        },

                        {
                            type: "reply",
                            reply: {
                                id: "plumbing",
                                title: "🚰 سباكة"
                            }
                        },

                        {
                            type: "reply",
                            reply: {
                                id: "ac",
                                title: "❄️ تكييف"
                            }
                        }

                    ]
                }
            }
        },

        {
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                "Content-Type": "application/json"
            }
        }
    );
}

/*
====================
Get available technician
====================
*/

async function findTechnician(service) {

    const snapshot = await db
        .collection("technicians")
        .where("service", "==", service)
        .where("status", "==", "available")
        .limit(1)
        .get();

    if (snapshot.empty) return null;

    return snapshot.docs[0];
}

/*
====================
Webhook verify
====================
*/

app.get("/webhook", (req, res) => {

    if (req.query["hub.verify_token"] === "taqa_verify") {

        return res.send(req.query["hub.challenge"]);
    }

    res.sendStatus(403);
});

/*
====================
Webhook receive
====================
*/

app.post("/webhook", async (req, res) => {

    try {

        const msg =
            req.body.entry?.[0]
            ?.changes?.[0]
            ?.value?.messages?.[0];

        if (!msg) return res.sendStatus(200);

        const from = msg.from;

        /*
        ==================
        First message
        ==================
        */

        if (msg.type === "text") {

            await sendButtons(from);
        }

        /*
        ==================
        Service selected
        ==================
        */

        if (msg.type === "interactive") {

            const service =
                msg.interactive.button_reply.id;

            const technicianDoc =
                await findTechnician(service);

            if (!technicianDoc) {

                await sendMessage(
                    from,
                    "لا يوجد فني متاح حالياً"
                );

                return;
            }

            const technician =
                technicianDoc.data();

            const orderId = uuidv4();

            await db
                .collection("orders")
                .doc(orderId)
                .set({

                    id: orderId,
                    customerPhone: from,
                    technicianPhone: technician.phone,
                    service,
                    status: "pending",
                    createdAt: new Date()

                });

            await sendMessage(
                from,
                "تم ارسال الفني"
            );

            await sendMessage(
                technician.phone,
                `طلب جديد

approve ${orderId}`
            );
        }

    } catch (e) {

        console.log(e.message);
    }

    res.sendStatus(200);
});

/*
====================
Technician commands
====================
*/

app.post("/tech", async (req, res) => {

    const { phone, message } = req.body;

    if (message.startsWith("approve")) {

        const orderId = message.split(" ")[1];

        const orderRef =
            db.collection("orders").doc(orderId);

        await orderRef.update({
            status: "approved"
        });

        const order =
            (await orderRef.get()).data();

        await sendMessage(
            order.customerPhone,
            "الفني في الطريق"
        );
    }

    if (message.startsWith("done")) {

        const orderId = message.split(" ")[1];

        const orderRef =
            db.collection("orders").doc(orderId);

        await orderRef.update({
            status: "completed"
        });

        const order =
            (await orderRef.get()).data();

        await sendMessage(
            order.customerPhone,
            "تم الانتهاء"
        );
    }

    res.sendStatus(200);
});

/*
====================
Start server
====================
*/

app.listen(process.env.PORT || 3000, () => {

    console.log("Server started");
});
