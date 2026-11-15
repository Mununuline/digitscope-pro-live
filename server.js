const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const publicDirectory = path.join(__dirname, "public");
const DERIV_APP_ID = process.env.DERIV_APP_ID || "";
const DERIV_REDIRECT_URI = process.env.DERIV_REDIRECT_URI || "https://digitscope-pro-test.onrender.com/deriv/callback";
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
const assistantRequests = new Map();
const ALLOWED_MARKETS = new Set(["R_10","R_25","R_50","R_75","R_100","1HZ10V","1HZ25V","1HZ50V","1HZ75V","1HZ100V"]);

function wilsonLowerBound(wins, trials, z = 1.96) {
  if (!trials) return 0;
  const p = wins / trials, z2 = z * z;
  return (p + z2 / (2 * trials) - z * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials)) / (1 + z2 / trials);
}

function evaluateAssistant(input) {
  const market = String(input.market || "");
  const contract = String(input.contract || "");
  const tickCount = Number(input.tickCount);
  const latencyMs = input.latencyMs === null ? null : Number(input.latencyMs);
  const validationTrials = Number(input.validationTrials);
  const validationWins = Number(input.validationWins);
  const payout = Number(input.totalPayout);
  const estimatedChance = Number(input.estimatedChance);
  const reasons = [];
  if (!ALLOWED_MARKETS.has(market)) reasons.push("Unknown or unsupported market.");
  if (!["MATCHES","DIFFERS"].includes(contract)) reasons.push("No valid contract candidate.");
  if (!Number.isInteger(tickCount) || tickCount < 500) reasons.push("At least 500 live ticks are required.");
  if (input.signalQualified !== true) reasons.push("The statistical signal gate is not qualified.");
  if (latencyMs !== null && (!Number.isFinite(latencyMs) || latencyMs > 250)) reasons.push("Feed latency is too high or unavailable.");
  if (!Number.isInteger(validationTrials) || validationTrials < 100) reasons.push("At least 100 independent, contract-matched out-of-sample trials are required.");
  if (!Number.isInteger(validationWins) || validationWins < 0 || validationWins > validationTrials) reasons.push("Validation outcome counts are invalid.");
  if (!Number.isFinite(payout) || payout <= 1) reasons.push("A current Deriv total-payout quote is required.");
  if (!Number.isFinite(estimatedChance) || estimatedChance <= 0 || estimatedChance >= 1) reasons.push("A valid estimated event probability is required.");
  const lowerBound = Number.isInteger(validationTrials) && validationTrials > 0 &&
    Number.isInteger(validationWins) && validationWins >= 0 && validationWins <= validationTrials
      ? wilsonLowerBound(validationWins, validationTrials) : 0;
  const breakEven = Number.isFinite(payout) && payout > 1 ? 1 / payout : null;
  if (breakEven !== null && lowerBound <= breakEven) reasons.push("The 95% Wilson lower bound does not exceed the quoted break-even probability.");
  if (Number.isFinite(estimatedChance) && breakEven !== null && estimatedChance <= breakEven) reasons.push("The estimated probability does not exceed the quoted break-even probability.");
  const decision = reasons.length ? (tickCount < 500 || validationTrials < 100 || !Number.isFinite(payout) || payout <= 1 ? "WAIT" : "NO TRADE") : "TRADE";
  return {
    decision, market, contract, tickCount: Number.isFinite(tickCount) ? tickCount : 0,
    validationTrials: Number.isFinite(validationTrials) ? validationTrials : 0,
    validationWinRate: validationTrials > 0 && validationWins >= 0 && validationWins <= validationTrials ? validationWins / validationTrials : null,
    validationLowerBound: lowerBound, breakEvenProbability: breakEven, reasons,
    execution: "DISABLED — decision support only; no order was placed."
  };
}

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
    res.json({ connected: true, demoOnly: true, accounts });
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

app.post("/api/deriv/disconnect", (req, res) => {
  noStore(res);
  const session = getSession(req, res, false);
  if (session) {
    delete session.accessToken;
    delete session.tokenExpiresAt;
    delete session.oauth;
  }
  res.json({ connected: false, demoOnly: true });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDirectory, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("DigitScope Pro running on port " + PORT);
});
