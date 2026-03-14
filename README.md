# Wolf-Fin

An autonomous crypto trading agent powered by Claude (Anthropic) and Binance.

## Stack

- **Runtime**: Node.js 22+ with TypeScript (ESM)
- **AI**: `@anthropic-ai/sdk` — Claude Opus 4.6 with adaptive thinking
- **Exchange**: `binance` — Binance REST + WebSocket
- **API server**: `fastify` — status and control endpoints
- **Validation**: `zod` — schema validation for tool inputs and configs
- **Scheduling**: `node-cron` — periodic tasks (rebalancing, health checks)
- **Logging**: `pino` — structured JSON logging

## Project Structure

```
src/
  agent/       — Core agent loop (Claude tool-use agentic loop)
  tools/       — Anthropic tool definitions (market data, order placement, etc.)
  adapters/    — Exchange & data-source adapters (Binance, etc.)
  guardrails/  — Risk checks, position limits, circuit breakers
  scheduler/   — Cron-based scheduled tasks
```

## Setup

```bash
cp .env.example .env
# Fill in your API keys

pnpm install
pnpm dev
```

## Development

```bash
pnpm dev       # Run with tsx (hot reload)
pnpm build     # Compile to dist/
pnpm start     # Run compiled output
pnpm test      # Run vitest test suite
```

## Safety

- Always start with `BINANCE_TESTNET=true`
- Review guardrails in `src/guardrails/` before going live
- Set conservative `MAX_POSITION_USD` and `MAX_DAILY_LOSS_USD` limits
