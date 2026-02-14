const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json());

/*
==============================
Firebase init from Railway ENV
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

} catch (err) {

    console.error("Firebase error:", err.message);
}

/*
==============================
CONFIG
==============================
*/

const db = admin.firestore();

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const TECHNICIAN_PHONE = "96899258043"; // رقم الفني

/*
==============================
Send WhatsApp Message
==============================
*/

async function sendMessage(to, message) {

    try {

        await axios.post(
            `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: to,
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

    } catch (err) {

        console.log("Send error:", err.message);
    }
}

/*
==============================
Webhook verify
==============================
*/

app.get("/webhook", (req, res) => {

    const VERIFY_TOKEN = "taqa_verify";

    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token === VERIFY_TOKEN) {

        res.status(200).send(challenge);

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
        const value = changes?.value;
        const messages = value?.messages;

        if (!messages) {
            return res.sendStatus(200);
        }

        const msg = messages[0];
        const from = msg.from;
        const text = msg.text?.body;

        console.log("Message:", text);

        /*
        =====================
        Client requests service
        =====================
        */

        if (text === "1") {

            const orderId = uuidv4();

            await db.collection("orders").doc(orderId).set({

                id: orderId,
                customerPhone: from,
                service: "electricity",
                status: "pending",
                createdAt: new Date()

            });

            await sendMessage(
                from,
                "تم استلام طلبك ✅ سيتم ارسال الفني"
            );

            await sendMessage(
                TECHNICIAN_PHONE,
                `طلب جديد ⚡

رقم الطلب:
${orderId}

اكتب:
approve ${orderId}
للموافقة`
            );
        }

        /*
        =====================
        Technician approves
        =====================
        */

        if (text?.startsWith("approve")) {

            const orderId = text.split(" ")[1];

            await db.collection("orders")
                .doc(orderId)
                .update({

                    status: "approved"
                });

            const order = await db.collection("orders")
                .doc(orderId)
                .get();

            const customerPhone = order.data().customerPhone;

            await sendMessage(
                customerPhone,
                "تم قبول طلبك 👨‍🔧 الفني في الطريق"
            );

            await sendMessage(
                TECHNICIAN_PHONE,
                "تم تسجيل الموافقة"
            );
        }

        /*
        =====================
        Technician finishes
        =====================
        */

        if (text?.startsWith("done")) {

            const orderId = text.split(" ")[1];

            await db.collection("orders")
                .doc(orderId)
                .update({

                    status: "completed"
                });

            const order = await db.collection("orders")
                .doc(orderId)
                .get();

            const customerPhone = order.data().customerPhone;

            await sendMessage(
                customerPhone,
                "تم الانتهاء من الخدمة ✅\nقيم الخدمة من 1 إلى 5"
            );
        }

        /*
        =====================
        Rating
        =====================
        */

        if (["1", "2", "3", "4", "5"].includes(text)) {

            await sendMessage(
                from,
                "شكراً لتقييمك ⭐"
            );
        }

    } catch (err) {

        console.log(err.message);
    }

    res.sendStatus(200);
});

/*
==============================
Server start
==============================
*/

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

    console.log("Server running on port", PORT);
});
