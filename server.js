const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const publicDirectory = path.join(__dirname, "public");
const DERIV_APP_ID = process.env.DERIV_APP_ID || "";
const DERIV_REDIRECT_URI = process.env.DERIV_REDIRECT_URI || "https://digitscope-pro-live1.onrender.com/deriv/callback";
const DERIV_AUTH_URL = "https://auth.deriv.com/oauth2/auth";
const DERIV_TOKEN_URL = "https://auth.deriv.com/oauth2/token";
const DERIV_API_BASE = "https://api.derivws.com";
const COOKIE_NAME = "dsp_oauth_session";
const sessions = new Map();

app.disable("x-powered-by");
app.use(express.json({ limit: "24kb" }));
app.use(express.static(publicDirectory, {
  etag: true,
  maxAge: process.env.NODE_ENV === "production" ? "5m" : 0
}));

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map(part => {
    const index = part.indexOf("=");
    if (index < 0) return ["", ""];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function getSession(req, res, create = false) {
  const cookies = parseCookies(req.headers.cookie);
  let id = cookies[COOKIE_NAME];
  let session = id && sessions.get(id);
  if (session && session.expiresAt <= Date.now()) {
    sessions.delete(id);
    session = null;
  }
  if (!session && create) {
    id = crypto.randomBytes(32).toString("hex");
    session = { createdAt: Date.now(), expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 };
    sessions.set(id, session);
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader("Set-Cookie", COOKIE_NAME + "=" + id + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800" + secure);
  }
  return session || null;
}

function base64url(buffer) {
  return buffer.toString("base64").replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");
}

function noStore(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}

function safeAccount(account) {
  const type = String(account.account_type || account.type || "").toLowerCase();
  const isDemo = type === "demo" || type === "virtual" || account.is_virtual === true;
  if (!isDemo) return null;
  const balance = account.balance && typeof account.balance === "object"
    ? account.balance.balance
    : account.balance;
  return {
    account_id: String(account.account_id || account.id || account.loginid || ""),
    account_type: "demo",
    currency: String(account.currency || ""),
    balance: Number.isFinite(Number(balance)) ? Number(balance) : null,
    display_name: String(account.display_name || account.name || "Deriv Demo")
  };
}

async function fetchDemoAccounts(accessToken) {
  const response = await fetch(DERIV_API_BASE + "/trading/v1/options/accounts", {
    headers: { Authorization: "Bearer " + accessToken, Accept: "application/json" }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body.errors && body.errors[0] && body.errors[0].message;
    throw new Error(error || "Deriv account lookup failed (HTTP " + response.status + ").");
  }
  const root = body.data || body;
  const accounts = Array.isArray(root) ? root : (root.accounts || root.items || []);
  return accounts.map(safeAccount).filter(account => account && account.account_id);
}


// AI Market Assistant: deterministic eligibility gates always own the decision.
// An optional language model may explain the supplied evidence, but cannot
// upgrade WAIT/NO TRADE or place orders.
const assistantRequests = new WeakMap();
const { evaluateAssistant } = require("./assistant-engine");
const { discoverStrategies } = require("./strategy-discovery");

app.post("/api/assistant/analyze", async (req, res) => {
  noStore(res);
  const session = getSession(req, res, true);
  const now = Date.now();
  const last = assistantRequests.get(session);
  if (last && now - last < 2500) return res.status(429).json({ error: "Please wait before requesting another analysis." });
  assistantRequests.set(session, now);
  const result = evaluateAssistant(req.body || {});
  let commentary = "Rule-based analysis is active. " + (result.reasons.length ? result.reasons.join(" ") : "All evidence gates passed.");
  let aiMode = "RULES_ONLY";
  if (process.env.AI_GATEWAY_API_KEY && process.env.AI_GATEWAY_MODEL) {
    try {
      const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": "Bearer " + process.env.AI_GATEWAY_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.AI_GATEWAY_MODEL,
          temperature: 0.1,
          max_tokens: 180,
          messages: [
            { role: "system", content: "You are DigitScope's market-analysis explainer. Explain only the supplied verified metrics in plain concise language. Never invent evidence, probabilities, market loopholes, or forecasts. The deterministic decision is authoritative: do not change it, upgrade it, or recommend overriding it. State clearly that synthetic-index outcomes may be unpredictable." },
            { role: "user", content: JSON.stringify({ ...result, authoritativeDecision: result.decision }) }
          ]
        }),
        signal: AbortSignal.timeout(8000)
      });
      const body = await response.json().catch(() => ({}));
      const text = body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
      if (response.ok && typeof text === "string" && text.trim()) {
        commentary = text.trim().slice(0, 1200);
        aiMode = "AI_GATEWAY";
      }
    } catch (_) {
      // Keep the deterministic result and fallback commentary on model failures.
    }
  }
  res.json({ ...result, commentary, aiMode, analyzedAt: new Date().toISOString() });
});


app.post("/api/strategy/discover", (req, res) => {
  noStore(res);
  try {
    const result = discoverStrategies(req.body || {});
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || "Strategy discovery request is invalid." });
  }
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    app: "DigitScope Pro",
    service: "web",
    timestamp: new Date().toISOString()
  });
});

// Begin OAuth 2.0 Authorization Code + PKCE. The access token never reaches browser JavaScript.
app.get("/deriv/connect", (req, res) => {
  noStore(res);
  if (!DERIV_APP_ID) return res.status(503).send("Deriv OAuth is not configured. Set DERIV_APP_ID in Render.");
  const session = getSession(req, res, true);
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const state = crypto.randomBytes(24).toString("hex");
  session.oauth = { verifier, state, expiresAt: Date.now() + 10 * 60 * 1000 };
  const url = new URL(DERIV_AUTH_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: DERIV_APP_ID,
    redirect_uri: DERIV_REDIRECT_URI,
    scope: "trade",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256"
  }).toString();
  res.redirect(302, url.toString());
});

app.get("/deriv/callback", async (req, res) => {
  noStore(res);
  const session = getSession(req, res, false);
  const oauth = session && session.oauth;
  const returnedState = String(req.query.state || "");
  if (!oauth || oauth.expiresAt < Date.now() || !returnedState ||
      returnedState.length !== oauth.state.length ||
      !crypto.timingSafeEqual(Buffer.from(returnedState), Buffer.from(oauth.state))) {
    if (session) delete session.oauth;
    return res.status(400).send("Deriv sign-in could not be verified. Please return to DigitScope Pro and connect again.");
  }
  delete session.oauth;
  if (req.query.error) {
    return res.redirect(303, "/?deriv=cancelled");
  }
  const code = String(req.query.code || "");
  if (!code || code.length > 4096) return res.status(400).send("Deriv did not return an authorization code.");

  try {
    const tokenResponse = await fetch(DERIV_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: DERIV_APP_ID,
        code,
        code_verifier: oauth.verifier,
        redirect_uri: DERIV_REDIRECT_URI
      })
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.status(502).send("Deriv authorization could not be completed. Please reconnect and try again.");
    }
    session.accessToken = tokenData.access_token;
    session.tokenExpiresAt = Date.now() + Math.max(0, Number(tokenData.expires_in) || 0) * 1000;
    session.expiresAt = Math.min(session.tokenExpiresAt, Date.now() + 7 * 24 * 60 * 60 * 1000);
    res.redirect(303, "/?deriv=connected");
  } catch (_error) {
    res.status(502).send("Could not reach Deriv to complete sign-in. Please try again.");
  }
});

app.get("/api/deriv/status", async (req, res) => {
  noStore(res);
  const session = getSession(req, res, false);
  if (!session || !session.accessToken || session.tokenExpiresAt <= Date.now()) {
    if (session) delete session.accessToken;
    return res.json({ connected: false, demoOnly: true, accounts: [] });
  }
  try {
    const accounts = await fetchDemoAccounts(session.accessToken);
    res.json({ connected: true, demoOnly: true, accounts, selectedAccountId: session.selectedDemoAccountId || null });
  } catch (error) {
    const message = String(error.message || "");
    if (/401|unauthori[sz]ed|expired/i.test(message)) delete session.accessToken;
    res.status(502).json({
      connected: Boolean(session.accessToken),
      demoOnly: true,
      accounts: [],
      error: "Unable to retrieve Demo account details from Deriv. " + message
    });
  }
});

app.post("/api/deriv/select-account", async (req, res) => {
  noStore(res);
  const session = getSession(req, res, false);
  if (!session || !session.accessToken || session.tokenExpiresAt <= Date.now()) {
    return res.status(401).json({ error: "Connect your Deriv account first." });
  }
  const accountId = String(req.body && req.body.account_id || "");
  if (!accountId || accountId.length > 64) return res.status(400).json({ error: "Choose a valid Demo account." });
  try {
    const accounts = await fetchDemoAccounts(session.accessToken);
    const account = accounts.find(item => item.account_id === accountId);
    if (!account) return res.status(403).json({ error: "Only a Demo account linked to this Deriv login can be selected." });
    session.selectedDemoAccountId = account.account_id;
    res.json({ selected: true, account });
  } catch (error) {
    res.status(502).json({ error: "Could not verify the Demo account. " + error.message });
  }
});

// Generate a short-lived, single-use authenticated WebSocket URL for the
// selected Demo account. The OAuth token stays on the server.
app.post("/api/deriv/demo-otp", async (req, res) => {
  noStore(res);
  const session = getSession(req, res, false);
  if (!session || !session.accessToken || session.tokenExpiresAt <= Date.now()) {
    return res.status(401).json({ error: "Connect Deriv before requesting a Demo trading session." });
  }
  const accountId = String(session.selectedDemoAccountId || "");
  if (!accountId) return res.status(400).json({ error: "Select a Demo account first." });
  try {
    const accounts = await fetchDemoAccounts(session.accessToken);
    if (!accounts.some(item => item.account_id === accountId)) {
      delete session.selectedDemoAccountId;
      return res.status(403).json({ error: "Selected account is no longer an eligible Demo account. Select it again." });
    }
    const response = await fetch(DERIV_API_BASE + "/trading/v1/options/accounts/" + encodeURIComponent(accountId) + "/otp", {
      method: "POST",
      headers: { Authorization: "Bearer " + session.accessToken, Accept: "application/json" }
    });
    const body = await response.json().catch(() => ({}));
    const data = body.data || body;
    if (!response.ok || !data.url || !String(data.url).startsWith("wss://api.derivws.com/trading/v1/options/ws/demo")) {
      const detail = body.errors && body.errors[0] && body.errors[0].message;
      throw new Error(detail || "Deriv did not return a Demo WebSocket URL.");
    }
    res.json({ url: data.url, account: accounts.find(item => item.account_id === accountId) });
  } catch (error) {
    res.status(502).json({ error: "Unable to open the Deriv Demo trading session. " + error.message });
  }
});

app.post("/api/deriv/disconnect", (req, res) => {
  noStore(res);
  const session = getSession(req, res, false);
  if (session) {
    delete session.accessToken;
    delete session.tokenExpiresAt;
    delete session.oauth;
    delete session.selectedDemoAccountId;
  }
  res.json({ connected: false, demoOnly: true });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDirectory, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("DigitScope Pro running on port " + PORT);
});
