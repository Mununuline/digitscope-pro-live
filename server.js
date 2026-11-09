const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const publicDirectory = path.join(__dirname, "public");

app.disable("x-powered-by");
app.use(express.static(publicDirectory, {
  etag: true,
  maxAge: process.env.NODE_ENV === "production" ? "5m" : 0
}));

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    app: "DigitScope Pro",
    service: "web",
    timestamp: new Date().toISOString()
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDirectory, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`DigitScope Pro running on port ${PORT}`);
});
