import express from "express";
import fetch from "node-fetch";
import admin from "firebase-admin";

const app = express();
app.use(express.json());

const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const userState = {};
const techState = {};

const mainMenu =
  "أهلاً 👋\nاختر الخدمة:\n1️⃣ كهرباء\n2️⃣ سباكة\n3️⃣ تكييف\n\n0️⃣ رجوع";

// ================= ROUTES =================

app.get("/", (req, res) => {
  res.send("Server running 🔥");
});

app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === VERIFY_TOKEN
  ) {
    res.send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

// ================= MAIN LOGIC =================

app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body?.toLowerCase();
    const location = msg.location;

    let reply = "";

    // ================= الفني =================
    if (
      techState[from] &&
      (text === "1" || text === "2" || text === "start" || text === "done")
    ) {
      const state = techState[from];
      const orderRef = db.collection("orders").doc(state.orderId);

      if (text === "1") {
        await orderRef.update({
          status: "accepted",
          technician: from,
          technicianName: state.techName,
        });

        const order = (await orderRef.get()).data();

        await sendMessage(
          order.phone,
          `تم قبول طلبك ✅\n👨‍🔧 ${state.techName}\n📞 ${from}\n\nاكتب: حالة`
        );

        reply = "تم القبول ✅";
      }

      else if (text === "2") {
        const nextIndex = state.techIndex + 1;

        if (nextIndex < state.techs.length) {
          const nextTech = state.techs[nextIndex];

          techState[nextTech.phone] = {
            ...state,
            techIndex: nextIndex,
            techName: nextTech.name,
          };

          await sendMessage(nextTech.phone, "طلب جديد 🔥\n1 قبول\n2 رفض");

          reply = "تم التحويل 🔁";
        } else {
          const order = (await orderRef.get()).data();
          await sendMessage(order.phone, "❌ تم رفض الطلب من الجميع");
          reply = "انتهى";
        }

        delete techState[from];
      }

      else if (text === "start") {
        await orderRef.update({ status: "started" });
        const order = (await orderRef.get()).data();

        await sendMessage(order.phone, "🚧 الفني بدأ العمل");
        reply = "تم البدء";
      }

      else if (text === "done") {
        await orderRef.update({ status: "completed" });
        const order = (await orderRef.get()).data();

        await sendMessage(order.phone, "✅ تم الانتهاء\nقيّم من 1 إلى 5");

        userState[order.phone] = {
          step: "rate",
          orderId: state.orderId,
        };

        delete techState[from];
        reply = "تم الإنهاء";
      }
    }

    // ================= العميل =================

    else if (userState[from]?.step === "rate") {
      await db.collection("orders").doc(userState[from].orderId).update({
        clientRating: Number(text),
      });

      reply = "شكراً لتقييمك ⭐";
      delete userState[from];
    }

    else if (text === "حالة") {
      const snap = await db
        .collection("orders")
        .where("phone", "==", from)
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();

      if (!snap.empty) {
        const order = snap.docs[0].data();

        reply =
          `📊 حالة الطلب:\n` +
          `الخدمة: ${order.service}\n` +
          `الحالة: ${order.status}\n` +
          `الفني: ${order.technicianName || "لم يتم التعيين"}`;
      } else {
        reply = "لا يوجد طلب";
      }
    }

    else if (text === "0" || text === "مرحبا") {
      userState[from] = { step: "choose" };
      reply = mainMenu;
    }

    else if (!userState[from]) {
      reply = "اكتب مرحبا 👋";
    }

    else if (userState[from].step === "choose") {
      const map = { "1": "كهرباء", "2": "سباكة", "3": "تكييف" };

      if (map[text]) {
        userState[from] = { step: "location", service: map[text] };
        reply = "أرسل موقعك 📍";
      } else {
        reply = mainMenu;
      }
    }

    else if (userState[from].step === "location") {
      if (location) {
        const service = userState[from].service;

        const orderRef = await db.collection("orders").add({
          phone: from,
          service,
          location,
          status: "pending",
          createdAt: new Date(),
        });

        // ===== فلترة الفنيين حسب التقييم =====
        const techsSnap = await db
          .collection("technicians")
          .where("service", "==", service)
          .where("active", "==", true)
          .get();

        const techs = [];

        for (let doc of techsSnap.docs) {
          const data = doc.data();
          const rating = data.rating || 5;

          if (rating >= 3) {
            techs.push(data);
          }
        }

        if (techs.length > 0) {
          const tech = techs[0];

          techState[tech.phone] = {
            orderId: orderRef.id,
            techIndex: 0,
            techs,
            techName: tech.name,
          };

          await sendMessage(
            tech.phone,
            "طلب جديد 🔥\n1 قبول\n2 رفض"
          );

          reply = "تم إرسال الطلب ✅";
        } else {
          reply = "❌ لا يوجد فني مناسب (التقييم ضعيف)";
        }

        userState[from] = { step: "done" };
      }
    }

    else if (userState[from].step === "done") {
      if (text === "0") {
        userState[from] = { step: "choose" };
        reply = mainMenu;
      } else {
        reply = "طلبك قيد التنفيذ 🔄\nاكتب: حالة";
      }
    }

    await sendMessage(from, reply);
    res.sendStatus(200);

  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

// ================= SEND =================

async function sendMessage(to, text) {
  await fetch(
    `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        text: { body: text },
      }),
    }
  );
}

app.listen(process.env.PORT || 8080);
