const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "12345";
const TOKEN = "EAANB4MVrO8QBQn3sbt7SafPkIswPKxEtMIhkYZAJ1XVAWuE44EI6N9DOidNDs6BaxHX65xRgXQuQZBS7AqpHNRK2JgVtMlRgyHn0VXigfTIIwZBpg8ufOKI7Og1AjHnHPZCBfQuGPjpw0yCfeQwbYuum1HxhxVZCk75DBwSvrxIqaUWZBXOR5lye3DwO48G9YfZALtqnZB8e7sK8saaAhZBX89YY8NbHtGa8MkMmvSWwlVPFIggGKjp1g1gZAjLHZAo3cZBdMQSEVMm3NOZAcb3FErEx2efsD";
const PHONE_NUMBER_ID = "962759303589757";



// Webhook verification
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token === VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});


// Receive messages
app.post("/webhook", async (req, res) => {
    try {
        const body = req.body;

        if (
            body.entry &&
            body.entry[0].changes &&
            body.entry[0].changes[0].value.messages &&
            body.entry[0].changes[0].value.messages[0]
        ) {
            const message = body.entry[0].changes[0].value.messages[0];
            const from = message.from;
            const text = message.text?.body?.toLowerCase() || "";

            let reply = "";

            if (text === "مرحبا" || text === "hi" || text === "hello" || text === "0" || text === "سلام") {

    reply = `مرحبا بك في طاقة للخدمات الهندسية ✨

اختر رقم الخدمة:

1️⃣ طلب خدمة
2️⃣ عرض الأسعار
3️⃣ موقعنا
4️⃣ تواصل مع الدعم`;

}
else if (text === "1") {

    reply = `📋 طلب خدمة

يرجى إرسال المعلومات التالية:

• نوع الخدمة
• الموقع
• وصف المشكلة
• صورة (اختياري)

↩️ اكتب 0 للرجوع للقائمة الرئيسية`;

}
else if (text === "2") {

    reply = `💰 قائمة الأسعار

🛠️ تركيب وصيانة:

• تركيب إنارة: 3 ر.ع
• تركيب مروحة: 5 ر.ع
• صيانة مفتاح/فيش: 2 ر.ع
• صيانة لوحة توزيع: 10 ر.ع

↩️ اكتب 0 للرجوع للقائمة الرئيسية`;

}
else if (text === "3") {

    reply = `📍 موقعنا:

طاقة للخدمات الهندسية
سلطنة عمان – ظفار

Google Maps:
https://maps.google.com

↩️ اكتب 0 للرجوع للقائمة الرئيسية`;

}
else if (text === "4") {

    reply = `📞 الدعم الفني:

واتساب: +968 99258043
الهاتف: +968 99258043

متاح 24 ساعة

↩️ اكتب 0 للرجوع للقائمة الرئيسية`;

}
else {

    reply = "اكتب مرحبا لعرض القائمة";

}


            await axios.post(
                `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`,
                {
                    messaging_product: "whatsapp",
                    to: from,
                    text: { body: reply }
                },
                {
                    headers: {
                        Authorization: `Bearer ${TOKEN}`,
                        "Content-Type": "application/json"
                    }
                }
            );
        }

        res.sendStatus(200);

    } catch (error) {
        console.error(error);
        res.sendStatus(500);
    }
});


// تشغيل السيرفر
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});









