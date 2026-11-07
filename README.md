# DigitScope Pro

A clean-start Deriv synthetic-index digit analytics dashboard.

## Features in this starter
- Connects to Deriv's public WebSocket market-data endpoint.
- Loads up to 1,000 historical ticks for a selected synthetic index.
- Streams live ticks.
- Extracts the last quoted digit using the market's reported precision.
- Displays empirical digit frequencies, even/odd, over/under and matches/differs statistics.

## Important limitations
This first version is an analytics baseline, not a proven prediction model and does not place trades. Historical frequencies do not establish the probability of the next tick when outcomes are independent or close to independent. Do not use these percentages as guaranteed signals.

Before adding a forecasting model, implement walk-forward testing, a baseline comparison, calibration, and sufficient out-of-sample evaluation. Keep any Deriv account token out of browser code and out of GitHub.

## Run locally
Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Then open http://localhost:3000

## Deploy
Deploy this repository as a Node.js web service on a host such as Render. Build command: `npm install`. Start command: `npm start`.

## Data source
Deriv public WebSocket: `wss://api.derivws.com/trading/v1/options/ws/public`
