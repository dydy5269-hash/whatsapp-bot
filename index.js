import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "10mb" }));

const userState = {};
const userData = {};

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// ===== SEND MESSAGE =====
async function sendMessage(to, text) {
  try {
    await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        text: { body: text },
      }),
    });
  } catch (e) {
    console.log("Send Error:", e);
  }
}

// ===== TECH =====
async function getTechnician(phone) {
  if (phone === "96890000000") {
    return {
      name: "أحمد سالم",
      phone: "96890000000",
      service: "كهرباء",
      rating: "4.8",
    };
  }
  return null;
}

// ===== WEBHOOK =====
app.post("/webhook", async (req, res) => {
  try {
    let msg;

    try {
      msg = req.body.entry[0].changes[0].value.messages[0];
    } catch {
      return res.sendStatus(200);
    }

    const from = msg.from;
    const text = msg.text?.body || "";

    // ===== TECH REPLY =====
    if (userState[from] === "tech_reply") {
      const data = userData[from];
      if (!data) return res.sendStatus(200);

      const client = data.client;
      const tech = data.tech;
      const location = data.location;

      let mapLink = "لا يوجد موقع";

      if (location && location.latitude && location.longitude) {
        mapLink = `https://maps.google.com/?q=${location.latitude},${location.longitude}`;
      }

      if (text.trim() === "1") {
        await sendMessage(
          client,
          `🚀 تم تأكيد طلبك

👨‍🔧 الفني:
${tech.name}
📞 ${tech.phone}
⭐ ${tech.rating}

⏳ في الطريق إليك`
        );

        await sendMessage(
          from,
          `📥 تفاصيل العميل

👤 ${client}
📞 ${client}

🔧 ${data.service}
📍 ${mapLink}`
        );

        userState[from] = "working";
        userState[client] = "waiting_service";
      }

      if (text.trim() === "2") {
        await sendMessage(client, `❌ تم رفض الطلب`);
        userState[from] = null;
      }

      return res.sendStatus(200);
    }

    // ===== LOCATION =====
    if (msg.type === "location") {
      const location = msg.location;

      userData[from] = {
        ...userData[from],
        location,
      };

      await sendMessage(from, "✅ تم استلام الموقع");

      const techPhone = "96890000000";
      const tech = await getTechnician(techPhone);
      if (!tech) return res.sendStatus(200);

      userData[techPhone] = {
        client: from,
        tech,
        location,
        service: userData[from]?.service || "كهرباء",
      };

      userState[techPhone] = "tech_reply";

      await sendMessage(
        techPhone,
        `📥 طلب جديد

👤 ${from}
🔧 ${userData[from]?.service || "كهرباء"}
📍 موقع متوفر

1️⃣ قبول
2️⃣ رفض`
      );

      return res.sendStatus(200);
    }

    // ===== WAIT LOCATION =====
    if (userState[from] === "waiting_location") {
      await sendMessage(from, "📍 أرسل الموقع عبر Location");
      return res.sendStatus(200);
    }

    // ===== START =====
    if (!userState[from]) {
      userState[from] = "menu";

      await sendMessage(
        from,
        `👋 مرحباً بك

1️⃣ كهرباء
2️⃣ سباكة
3️⃣ تكييف`
      );

      return res.sendStatus(200);
    }

    // ===== MENU =====
    if (userState[from] === "menu") {
      if (text === "1") {
        userState[from] = "confirm";

        userData[from] = { service: "كهرباء" };

        await sendMessage(
          from,
          `🧾 الطلب

🔧 كهرباء
💰 10 ريال

1️⃣ نعم
2️⃣ لا`
        );
      }

      return res.sendStatus(200);
    }

    // ===== CONFIRM =====
    if (userState[from] === "confirm") {
      if (text === "1") {
        userState[from] = "waiting_location";
        await sendMessage(from, "📍 أرسل موقعك");
      } else {
        userState[from] = "menu";
      }

      return res.sendStatus(200);
    }

    // ===== TECH ACCOUNT =====
    const tech = await getTechnician(from);

    if (tech && userState[from] !== "tech_reply") {
      await sendMessage(
        from,
        `👨‍🔧 حسابك

${tech.name}
⭐ ${tech.rating}`
      );
    }

    return res.sendStatus(200);
  } catch (err) {
    console.log("CRASH:", err);
    return res.sendStatus(200);
  }
});

// ===== TEST ROUTE =====
app.get("/", (req, res) => {
  res.send("Bot is working");
});

app.listen(3000, () => {
  console.log("Server running...");
});
