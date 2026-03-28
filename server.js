import express from "express";
import path from "path";

const app = express();

// عرض ملفات public
app.use(express.static(path.join(process.cwd(), "public")));

// صفحة رئيسية
app.get("/", (req, res) => {
  res.send("🔥 Server is running");
});

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});