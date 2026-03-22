# API Keys Registration Checklist

## Required (app won't start without these)

- [ ] **Anthropic** — https://console.anthropic.com
  - API Keys → Create Key
  - `.env`: `ANTHROPIC_API_KEY`

- [ ] **Binance** — https://testnet.binance.vision _(testnet, free — no real money)_
  - Account → API Management → Create API → Enable Spot Trading
  - `.env`: `BINANCE_API_KEY`, `BINANCE_API_SECRET`

---

## Optional (app works without these)

- [ ] **Finnhub** — https://finnhub.io/register
  - Free tier: 60 req/min
  - `.env`: `FINNHUB_KEY`

- [ ] **Twelve Data** — https://twelvedata.com/register
  - Free tier: 800 req/day
  - `.env`: `TWELVE_DATA_KEY`

- [ ] **CoinGecko** — https://www.coingecko.com/en/api
  - Free tier works without a key (just rate-limited)
  - `.env`: `COINGECKO_KEY`



