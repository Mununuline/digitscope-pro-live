# DigitScope Pro Live

A browser dashboard for live Deriv public synthetic-index market data and digit statistics.

## Included

- Deriv public WebSocket connection, no trading token required.
- Automatic synthetic-market discovery and market selector.
- Historical tick loading and live tick subscription.
- Last quoted digit extraction using market precision.
- Digit 0–9 frequency chart.
- Matches / Differs, Over / Under, and Even / Odd statistics.
- A simple rolling-frequency baseline with walk-forward hit-rate evaluation.
- Reconnection handling, subscription cleanup, and health endpoint.
- Responsive layout for desktop and mobile.


## AI Market Assistant

The terminal includes a multi-market research assistant that evaluates the currently selected market and returns **TRADE**, **WAIT**, or **NO TRADE**. Its deterministic safeguards are authoritative; an optional language model can only explain the supplied evidence and cannot override the decision.

A TRADE eligibility result requires:
- At least 500 live ticks and a qualified statistical signal.
- Feed latency no higher than 250 ms.
- At least 100 contract-matched out-of-sample outcomes.
- A fresh Deriv proposal quote.
- The 95% Wilson lower confidence bound and estimated event probability both above quoted break-even.

**Order execution is disabled.** The assistant does not place live or demo orders. A TRADE label means only that the configured evidence gates passed; it is not a guarantee or a recommendation to risk funds.

For optional natural-language explanations, configure these server-side environment variables in Render:
- `AI_GATEWAY_API_KEY` - Vercel AI Gateway API key.
- `AI_GATEWAY_MODEL` - a currently supported Gateway model ID.

If either variable is absent or the Gateway is unavailable, the deterministic rules-only explanation remains active. Never expose the Gateway key in browser code or commit it to GitHub.

The assistant API is `POST /api/assistant/analyze`. Its decision logic is isolated in `assistant-engine.js` and covered by `tests/assistant-engine.test.js`.

## Important limitations

This is an analytics dashboard, not a guaranteed prediction system and it does not place trades. Historical frequency does not prove that a digit is more likely on the next tick. The rolling-frequency baseline is experimental and its hit rate is not evidence of a profitable trading strategy. Test independently on out-of-sample data before relying on any signal.

The dashboard uses Deriv's public market-data WebSocket endpoint:
`wss://api.derivws.com/trading/v1/options/ws/public`

No Deriv account token is needed for public market data. Never put account tokens or passwords in frontend files or GitHub.

## Run locally

Requires Node.js 18 or newer.

```bash
npm install
npm run check
npm start
```

Open `http://localhost:3000`.

## Deploy on Render

Create or update a **Web Service** connected to this repository:

- Runtime: Node
- Branch: `main`
- Build command: `npm install`
- Start command: `npm start`
- Root directory: leave blank
- Environment: Node 18 or newer

Render supplies the `PORT` environment variable automatically.

After deployment, test:
- Your Render service URL
- `YOUR_RENDER_URL/health` should return JSON with `"ok": true`
- The dashboard should show a live Deriv connection and market names.

## Files

- `server.js` - Express static server and health endpoint
- `package.json` - dependencies and scripts
- `public/index.html` - dashboard structure
- `public/styles.css` - responsive styling
- `public/app.js` - Deriv WebSocket, tick processing and statistics


## AI Strategy Discovery Engine (integrated roadmap)

DigitScope Pro is being extended beyond fixed-pattern analysis into an AI-assisted **strategy discovery, testing, competition, and improvement engine**. The intended workflow is still simple: select a Volatility market, tap **SCAN**, and receive a target last digit (0–9), contract, entry/expiry tick, and a TRADE / WAIT / NO TRADE decision with evidence.

The engine will observe prevailing market regimes; manufacture versioned, reproducible strategy hypotheses; evaluate them chronologically on unseen outcomes; compare them against baselines and current payout break-even; and promote only robust, contract-matched candidates. AI can propose new strategies and parameter variants, but the deterministic assistant remains the final decision gate and cannot be overridden by an LLM.

The strategy lifecycle, Quick Scan result contract, implementation sequence, and required tests are specified in [docs/AI-STRATEGY-DISCOVERY.md](docs/AI-STRATEGY-DISCOVERY.md). An initial exploratory candidate generator is now available at `POST /api/strategy/discover`; it tests seven versioned hypotheses with chronological one-step replay. It is research-only and always returns `WAIT` / `tradeEligible: false` until independent future shadow validation and the full promotion controls are implemented.

**Important:** This is an integrated architecture and implementation roadmap, not a claim that autonomous strategy generation or contract-specific validation is already live. Preserve DS-01–DS-08 and their provenance constraints; do not use unresolved registry data for performance comparisons. Order execution remains disabled.
