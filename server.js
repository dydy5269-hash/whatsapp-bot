import express from "express";
import axios from "axios";
import admin from "firebase-admin";

const app = express();
app.use(express.json());

// ---------- FIREBASE ----------
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY))
  });
}
const db = admin.firestore();

// ---------- ENV ----------
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// ---------- CONFIG ----------
const COMMISSION = 0.2; // 20%

// ---------- STATE ----------
const userState = {};
const userData = {};

// ---------- HELPERS ----------
function normalizePhone(phone) {
  return phone.replace("+", "");
}

async function sendMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        text: { body: text }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (err) {
    console.error("sendMessage error:", err.response?.data || err.message);
  }
}

async function sendList(to, bodyText, buttonText, sections) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: bodyText },
          action: {
            button: buttonText,
            sections: sections
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (err) {
    console.error("sendList error:", err.response?.data || err.message);
  }
}

// ---------- SERVICES ----------
async function getServices() {
  const snap = await db.collection("services").get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// ---------- TECH ----------
async function getAvailableTechnician(serviceId) {
  const snap = await db
    .collection("technicians")
    .where("available", "==", true)
    .get();

  const techs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return techs.find(t => t.services.includes(serviceId));
}

// ---------- VERIFY ----------
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.send(req.query["hub.challenge"]);
  }
  return res.sendStatus(403);
});

// ---------- WEBHOOK ----------
app.post("/webhook", async (req, res) => {
  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = normalizePhone(msg.from);
    let incomingText = "";

    if (msg.type === "text") {
      incomingText = msg.text.body.trim();
    } else if (msg.type === "interactive") {
      incomingText =
        msg.interactive.list_reply?.id ||
        msg.interactive.button_reply?.id ||
        "";
    }

    console.log("STATE:", userState[from], "TEXT:", incomingText);

    // ===== TECH ACTIONS =====
    if (incomingText.startsWith("accept_")) {
      const orderId = incomingText.replace("accept_", "");
      await db.collection("orders").doc(orderId).update({
        status: "accepted"
      });

      const order = (await db.collection("orders").doc(orderId).get()).data();

      await sendMessage(order.phone, "👨‍🔧 تم قبول طلبك");

      await sendList(
        from,
        "إدارة الطلب:",
        "خيارات",
        [
          {
            title: "الحالة",
            rows: [
              { id: `ontheway_${orderId}`, title: "🚗 في الطريق" },
              { id: `done_${orderId}`, title: "✅ تم الإنجاز" }
            ]
          }
        ]
      );

      return res.sendStatus(200);
    }

    if (incomingText.startsWith("reject_")) {
      const orderId = incomingText.replace("reject_", "");
      await db.collection("orders").doc(orderId).update({
        status: "rejected"
      });

      const order = (await db.collection("orders").doc(orderId).get()).data();

      await sendMessage(order.phone, "❌ تم رفض الطلب");

      return res.sendStatus(200);
    }

    if (incomingText.startsWith("ontheway_")) {
      const orderId = incomingText.replace("ontheway_", "");

      await db.collection("orders").doc(orderId).update({
        status: "on_the_way"
      });

      const order = (await db.collection("orders").doc(orderId).get()).data();

      await sendMessage(order.phone, "🚗 الفني في الطريق إليك");

      return res.sendStatus(200);
    }

    if (incomingText.startsWith("done_")) {
      const orderId = incomingText.replace("done_", "");

      await db.collection("orders").doc(orderId).update({
        status: "done"
      });

      const order = (await db.collection("orders").doc(orderId).get()).data();

      await sendList(
        order.phone,
        "⭐ كيف كانت الخدمة؟",
        "تقييم",
        [
          {
            title: "التقييم",
            rows: [
              { id: `rate_${orderId}_5`, title: "⭐⭐⭐⭐⭐" },
              { id: `rate_${orderId}_4`, title: "⭐⭐⭐⭐" },
              { id: `rate_${orderId}_3`, title: "⭐⭐⭐" },
              { id: `rate_${orderId}_2`, title: "⭐⭐" },
              { id: `rate_${orderId}_1`, title: "⭐" }
            ]
          }
        ]
      );

      return res.sendStatus(200);
    }

    if (incomingText.startsWith("rate_")) {
      const parts = incomingText.split("_");
      const orderId = parts[1];
      const rating = parseInt(parts[2]);

      const orderRef = db.collection("orders").doc(orderId);
      const order = (await orderRef.get()).data();

      await orderRef.update({
        rating: rating,
        status: "completed"
      });

      const techRef = db.collection("technicians").doc(order.technicianId);
      const tech = (await techRef.get()).data();

      const newTotal = (tech.totalRating || 0) + rating;
      const newCount = (tech.ratingCount || 0) + 1;
      const avg = newTotal / newCount;

      const price = order.type.price || 0;
      const commission = price * COMMISSION;
      const net = price - commission;

      const newWallet = (tech.wallet || 0) + net;

      await techRef.update({
        totalRating: newTotal,
        ratingCount: newCount,
        avgRating: avg,
        wallet: newWallet
      });

      await db.collection("transactions").add({
        technicianId: order.technicianId,
        orderId: orderId,
        amount: net,
        commission: commission,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      await sendMessage(
        tech.phone,
        `📊 تقرير الطلب

الخدمة: ${order.serviceName}
السعر: ${price} ريال

⭐ التقييم: ${rating}/5
📈 المعدل: ${avg.toFixed(1)}

💰 أرباحك: ${net.toFixed(2)} ريال
🏦 رصيدك: ${newWallet.toFixed(2)} ريال
💸 العمولة: ${commission.toFixed(2)} ريال`
      );

      await sendMessage(order.phone, "🙏 شكراً لتقييمك");

      return res.sendStatus(200);
    }

    // ===== START =====
    if (!userState[from] || incomingText === "مرحبا" || incomingText === "0") {
      userState[from] = "main";

      const services = await getServices();

      await sendList(
        from,
        "👋 مرحباً\nاختر الخدمة:",
        "الخدمات",
        [
          {
            title: "القائمة",
            rows: services.map(s => ({
              id: `service_${s.id}`,
              title: s.name.substring(0, 24),
            }))
          }
        ]
      );

      return res.sendStatus(200);
    }

    // ===== SERVICE =====
    if (userState[from] === "main") {
      const services = await getServices();
      const id = incomingText.replace("service_", "");
      const service = services.find(s => s.id === id);

      if (!service) {
        await sendMessage(from, "❌ اختيار غير صحيح");
        return res.sendStatus(200);
      }

      userData[from] = {
        serviceId: service.id,
        serviceName: service.name,
        types: service.types
      };

      userState[from] = "type";

      await sendList(
        from,
        `⚡ ${service.name}`,
        "الأنواع",
        [
          {
            title: "اختر النوع",
            rows: service.types.map((t, i) => ({
              id: `type_${i}`,
              title: t.nametitle.substring(0, 24),
              description: `${t.price} ريال`
            }))
          }
        ]
      );

      return res.sendStatus(200);
    }

    // ===== TYPE =====
    if (userState[from] === "type") {
      const index = parseInt(incomingText.replace("type_", ""));
      const type = userData[from].types[index];

      if (!type) {
        await sendMessage(from, "❌ اختيار غير صحيح");
        return res.sendStatus(200);
      }

      userData[from].selectedType = type;
      userState[from] = "confirm";

      await sendList(
        from,
        `🧾 ${type.name}\n💰 ${type.price} ريال`,
        "تأكيد",
        [
          {
            title: "تأكيد",
            rows: [
              { id: "confirm_yes", title: "✅ تأكيد" },
              { id: "confirm_no", title: "❌ إلغاء" }
            ]
          }
        ]
      );

      return res.sendStatus(200);
    }

    // ===== CONFIRM =====
    if (userState[from] === "confirm") {
      if (incomingText === "confirm_no") {
        delete userState[from];
        delete userData[from];
        await sendMessage(from, "❌ تم الإلغاء");
        return res.sendStatus(200);
      }

      if (incomingText === "confirm_yes") {
        userState[from] = "location";
        await sendMessage(from, "📍 أرسل موقعك");
        return res.sendStatus(200);
      }
    }

    // ===== LOCATION =====
    if (userState[from] === "location") {
      if (msg.type !== "location") {
        await sendMessage(from, "📍 أرسل الموقع");
        return res.sendStatus(200);
      }

      const loc = msg.location;

      const tech = await getAvailableTechnician(userData[from].serviceId);

      const orderRef = await db.collection("orders").add({
        phone: from,
        serviceId: userData[from].serviceId,
        serviceName: userData[from].serviceName,
        type: userData[from].selectedType,
        technicianId: tech ? tech.id : null,
        status: tech ? "pending_tech" : "pending",
        location: {
          lat: loc.latitude,
          lng: loc.longitude
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      if (tech) {
        await sendMessage(
          tech.phone,
          `📥 طلب جديد

الخدمة: ${userData[from].serviceName}
النوع: ${userData[from].selectedType.name}
السعر: ${userData[from].selectedType.price} ريال`
        );

        await sendList(
          tech.phone,
          "اختر:",
          "تنفيذ",
          [
            {
              title: "الطلب",
              rows: [
                { id: `accept_${orderRef.id}`, title: "✅ قبول" },
                { id: `reject_${orderRef.id}`, title: "❌ رفض" }
              ]
            }
          ]
        );
      }

      await sendMessage(from, "🚀 تم إرسال الطلب");

      delete userState[from];
      delete userData[from];

      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error(err);
    return res.sendStatus(200);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running...");
});
