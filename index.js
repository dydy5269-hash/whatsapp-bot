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

app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body?.toLowerCase();
    const location = msg.location;

    let reply = "";

    // ===== الفني =====
    if (techState[from]) {
      const state = techState[from];
      const orderRef = db.collection("orders").doc(state.orderId);

      if (text === "1") {
        // قبول
        await orderRef.update({
          status: "accepted",
          technician: from,
        });

        const order = (await orderRef.get()).data();

        await sendMessage(
          order.phone,
          `تم قبول الطلب ✅\n👨‍🔧 ${state.techName}\n📞 ${from}`
        );

        reply = "تم القبول ✅";
        delete techState[from];
      }

      else if (text === "2") {
        // رفض → تحويل
        const nextIndex = state.techIndex + 1;

        if (nextIndex < state.techs.length) {
          const nextTech = state.techs[nextIndex];

          techState[nextTech.phone] = {
            ...state,
            techIndex: nextIndex,
            techName: nextTech.name,
          };

          await sendMessage(
            nextTech.phone,
            "طلب جديد 🔥\n1️⃣ قبول\n2️⃣ رفض"
          );

          reply = "تم التحويل 🔁";
        } else {
          const order = (await orderRef.get()).data();
          await sendMessage(order.phone, "❌ تم رفض الطلب من الجميع");

          reply = "انتهى ❌";
        }

        delete techState[from];
      }

      else if (text === "start") {
        await orderRef.update({ status: "started" });
        const order = (await orderRef.get()).data();

        await sendMessage(order.phone, "🚧 الفني بدأ العمل");
        reply = "تم بدء العمل";
      }

      else if (text === "done") {
        await orderRef.update({ status: "completed" });
        const order = (await orderRef.get()).data();

        await sendMessage(order.phone, "✅ تم إنهاء العمل\nقيّم من 1 إلى 5");
        techState[from].step = "rate_client";

        reply = "تم الإنهاء";
      }

      else if (state.step === "rate_client") {
        await orderRef.update({ techRating: text });
        reply = "تم تقييم العميل ⭐";
        delete techState[from];
      }

      else {
        reply = "1 قبول\n2 رفض\nstart بدء\ndone إنهاء";
      }
    }

    // ===== العميل =====
    else if (userState[from]?.step === "rate") {
      const orderId = userState[from].orderId;

      await db.collection("orders").doc(orderId).update({
        clientRating: text,
      });

      reply = "شكراً لتقييمك ⭐";
      delete userState[from];
    }

    else if (text === "0") {
      userState[from] = { step: "choose" };
      reply = mainMenu;
    }

    else if (!userState[from]) {
      if (text === "مرحبا") {
        userState[from] = { step: "choose" };
        reply = mainMenu;
      } else {
        reply = "اكتب مرحبا 👋";
      }
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

        const techsSnap = await db
          .collection("technicians")
          .where("service", "==", service)
          .where("active", "==", true)
          .get();

        if (!techsSnap.empty) {
          const techs = techsSnap.docs.map(d => d.data());
          const tech = techs[0];

          techState[tech.phone] = {
            orderId: orderRef.id,
            techIndex: 0,
            techs,
            techName: tech.name,
          };

          await sendMessage(
            tech.phone,
            "طلب جديد 🔥\n1️⃣ قبول\n2️⃣ رفض"
          );

          reply = "تم إرسال الطلب ✅";
        } else {
          reply = "❌ لا يوجد فني";
        }

        userState[from] = { step: "done", orderId: orderRef.id };
      }
    }

    else if (userState[from].step === "done") {
      reply = "طلبك قيد التنفيذ 🔄";
    }

    await sendMessage(from, reply);
    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

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
