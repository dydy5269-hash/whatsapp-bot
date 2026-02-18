const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const path = require("path");

const app = express();

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const PORT = process.env.PORT || 3000;

console.log("SYSTEM READY");

// الصفحة الرئيسية
app.get("/", (req, res) => {
    res.send("WhatsApp System Running");
});


// ========================
// Webhook verification
// ========================
app.get("/webhook", (req, res) => {

    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {

        console.log("WEBHOOK VERIFIED");
        return res.status(200).send(challenge);

    } else {

        return res.sendStatus(403);

    }

});


// ========================
// Receive WhatsApp messages
// ========================
app.post("/webhook", async (req, res) => {

    try {

        const body = req.body;

        if (
            body.object &&
            body.entry &&
            body.entry[0].changes &&
            body.entry[0].changes[0].value.messages
        ) {

            const message =
                body.entry[0].changes[0].value.messages[0];

            const from = message.from;
            const msgText = message.text?.body || "";

            console.log("NEW MESSAGE:", msgText);
            console.log("FROM:", from);

            // رد تلقائي
            await sendWhatsAppMessage(
                from,
                "مرحبا 👋\nتم استلام طلبك بنجاح.\nسيتم الرد عليك قريباً."
            );

        }

        res.sendStatus(200);

    } catch (error) {

        console.log("ERROR:", error);
        res.sendStatus(500);

    }

});


// ========================
// Send WhatsApp message
// ========================
async function sendWhatsAppMessage(to, message) {

    try {

        const url =
            "https://graph.facebook.com/v18.0/" +
            PHONE_NUMBER_ID +
            "/messages";

        const response = await fetch(url, {

            method: "POST",

            headers: {
                "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
                "Content-Type": "application/json"
            },

            body: JSON.stringify({

                messaging_product: "whatsapp",
                to: to,
                type: "text",
                text: {
                    body: message
                }

            })

        });

        const data = await response.json();

        console.log("MESSAGE SENT:", data);

    } catch (error) {

        console.log("SEND ERROR:", error);

    }

}


// ========================
// API test route
// ========================
app.get("/test", (req, res) => {

    res.send("System is working");

});


// ========================
// Start server
// ========================
app.listen(PORT, () => {

    console.log("SERVER RUNNING ON PORT:", PORT);

});
