const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true, app: "DigitScope Pro" }));

app.listen(PORT, () => {
  console.log(`DigitScope Pro running on port ${PORT}`);
});
