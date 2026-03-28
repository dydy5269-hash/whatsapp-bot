import express from "express";
import path from "path";

const app = express();
app.use(express.json());

// عرض ملفات public
app.use(express.static(path.join(process.cwd(), "public")));

app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running...");
});