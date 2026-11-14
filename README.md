# DigitScope Pro Live

A focused, mobile-friendly Deriv last-digit analysis dashboard.

## Main workflow

1. Connect to the Deriv public market-data WebSocket (no trading token required).
2. Select one synthetic market.
3. Collect live tick observations and view the latest digit tape.
4. Choose a sample window of 50, 100, 250, 500 or 1,000 observations.
5. Select a digit from 0 to 9.
6. Read its observed MATCHES and DIFFERS counts and percentages.

## Calculation rules

- A tick is counted only when Deriv supplies a valid quote precision and the quote can be formatted at that precision.
- The last digit is extracted from the final digit of the precision-formatted quote.
- The app collects one live stream for the selected market. It does not combine historical replay with live subscription data.
- Stable Deriv tick IDs are used to skip repeated deliveries when those IDs are present. Repeated quotes and timestamps without a stable ID are not collapsed, because they may be legitimate separate ticks.
- The displayed sample is the most recent valid observations up to the selected window. The actual sample count is always shown.
- MATCHES and DIFFERS use the same denominator: MATCHES counts the selected digit; DIFFERS counts all other digits. Their counts sum to the sample size.

## Important limitations

This is descriptive market-data analysis, not a prediction engine. Historical frequency does not guarantee the next digit, establish a profitable trading strategy, or imply that outcomes are independent. No trades are placed and no account token is needed.

The app keeps its live sample in memory for the current browser session. It does not clear, migrate or rewrite browser storage. Existing dataset registry and provenance code remains in the repository unchanged.

## Run locally

Requires Node.js 18 or newer.

```bash
npm install
npm run check
npm start
```

Open `http://localhost:3000`.

## Deploy on Render

Create or update a Node Web Service:

- Build command: `npm install`
- Start command: `npm start`
- Root directory: leave blank
- Node version: 18 or newer

After deployment, `/health` should return JSON with `"ok": true`. Confirm that the dashboard shows a live Deriv connection and begins collecting ticks for the selected market.

## Retained integrity modules

The dataset registry and the historical validation modules remain in the repository for preservation and diagnostics. They are not part of the simplified main screen. Do not treat DS-05 and DS-07 as independent when they share target ticks; DS-08 remains a derived view of DS-06.
