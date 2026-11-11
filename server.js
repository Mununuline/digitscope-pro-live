const express = require("express");
const path = require("path");
const crypto = require("crypto");
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const publicDirectory = path.join(__dirname, "public");
const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000;
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use(express.static(publicDirectory, { etag: true, maxAge: process.env.NODE_ENV === "production" ? "5m" : 0 }));
function cookieValue(req, name) {
  const raw = req.headers.cookie || "";
  const item = raw.split(";").map(x => x.trim()).find(x => x.startsWith(name + "="));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : "";
}
function sameOrigin(req) {
  const origin = req.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === req.get("host"); } catch { return false; }
}
app.use("/api/autotrader", (req, res, next) => sameOrigin(req) ? next() : res.status(403).json({ error: "Cross-origin request rejected." }));
app.post("/api/autotrader/session", async (req, res) => {
  if (process.env.NODE_ENV === "production" && !(req.secure || req.get("x-forwarded-proto") === "https")) return res.status(400).json({ error: "Secure HTTPS connection required." });
  const token = String(req.body?.token || "").trim();
  const appId = String(req.body?.appId || "").trim();
  const accountId = String(req.body?.accountId || "").trim();
  if (!token || !appId || !accountId) return res.status(400).json({ error: "Enter your Deriv API token, App ID and demo account ID." });
  if (!/^\d{3,12}$/.test(appId) || !/^VRTC\d+$/i.test(accountId)) return res.status(400).json({ error: "Demo-only connection: use a numeric App ID and a VRTC demo account ID." });
  try {
    const response = await fetch("https://api.derivws.com/trading/v1/options/accounts/" + encodeURIComponent(accountId) + "/otp", {
      method: "POST", headers: { "Authorization": "Bearer " + token, "Deriv-App-ID": appId, "Accept": "application/json" }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(502).json({ error: body?.errors?.[0]?.message || body?.message || "Deriv could not authorize this demo account. Check the token, App ID and account ID." });
    const wsUrl = body?.data?.url;
    if (typeof wsUrl !== "string" || !wsUrl.startsWith("wss://api.derivws.com/trading/v1/options/ws/demo?")) return res.status(403).json({ error: "Deriv did not return a demo WebSocket session. Real-account sessions are blocked." });
    const id = crypto.randomBytes(32).toString("hex");
    sessions.set(id, { accountId, createdAt: Date.now() });
    res.cookie("dsp_demo_session", id, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: SESSION_TTL_MS });
    res.json({ ok: true, wsUrl, accountId, mode: "DEMO" });
  } catch (error) {
    res.status(502).json({ error: "Could not reach Deriv authentication service." });
  }
});
app.get("/api/autotrader/status", (req, res) => {
  const id = cookieValue(req, "dsp_demo_session");
  const session = sessions.get(id);
  if (!session || Date.now() - session.createdAt > SESSION_TTL_MS) {
    if (id) sessions.delete(id);
    return res.json({ connected: false, mode: "DEMO" });
  }
  res.json({ connected: true, mode: "DEMO", accountId: session.accountId });
});
app.post("/api/autotrader/logout", (req, res) => {
  const id = cookieValue(req, "dsp_demo_session");
  if (id) sessions.delete(id);
  res.clearCookie("dsp_demo_session", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/" });
  res.json({ ok: true });
});
app.get("/health", (_req, res) => res.status(200).json({ ok: true, app: "DigitScope Pro", service: "web", autoTrader: "demo-only-auth-preview", timestamp: new Date().toISOString() }));
app.get("*", (_req, res) => res.sendFile(path.join(publicDirectory, "index.html")));
app.listen(PORT, "0.0.0.0", () => console.log("DigitScope Pro running on port " + PORT));
