import express from "express";

const app = express();

app.get("/", (req, res) => {
  res.send("WORKING 🔥");
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("Server running");
});
