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
