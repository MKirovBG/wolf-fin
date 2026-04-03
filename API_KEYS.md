# API Keys & Environment Variables

All environment variables are stored in `.env` at the project root. The Settings UI can update most of them at runtime via `POST /api/keys` and `POST /api/config`.

## Required

### MT5 Bridge

| Variable | Description | Default |
|---|---|---|
| `MT5_BRIDGE_PORT` | Port the Python MT5 bridge listens on | `8000` |
| `MT5_BRIDGE_URL` | Override bridge base URL (if not localhost) | — |
| `MT5_BRIDGE_KEY` | Shared secret for bridge authentication | — (unset = no auth) |

The bridge must be running before the backend starts. See [docs/mt5-bridge.md](docs/mt5-bridge.md).

### LLM Provider (at least one)

| Variable | Provider | How to get |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API | console.anthropic.com |
| `CLAUDE_SESSION_TOKEN` | Claude.ai subscription | OAuth flow in Settings UI, or auto-imported from Claude Code CLI |
| `OPENROUTER_API_KEY` | OpenRouter (multi-model) | openrouter.ai/keys |
| `OLLAMA_URL` | Local Ollama | Set to `http://localhost:11434` (default) |
| `OPENAI_ACCESS_TOKEN` | OpenAI subscription | OAuth flow in Settings UI |
| `OPENAI_REFRESH_TOKEN` | OpenAI token refresh | Set automatically by OAuth flow |
| `OPENAI_TOKEN_EXPIRES` | OpenAI expiry timestamp | Set automatically by OAuth flow |

The active platform LLM is set via `PLATFORM_LLM_PROVIDER` and `PLATFORM_LLM_MODEL`. These can also be configured in the Settings page.

## Optional

### News & Economic Calendar

| Variable | Description | How to get |
|---|---|---|
| `FINNHUB_KEY` | Finnhub API key for forex news and economic calendar | finnhub.io (free tier available) |

Without this key, news and calendar context are empty in analyses.

## Server

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP server port | `3000` |
| `LOG_LEVEL` | pino log level (`debug`, `info`, `warn`, `error`) | `info` |

## Example `.env`

```env
# LLM
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENROUTER_API_KEY=sk-or-v1-...
PLATFORM_LLM_PROVIDER=anthropic
PLATFORM_LLM_MODEL=claude-opus-4-6

# News
FINNHUB_KEY=abc123xyz

# MT5 bridge
MT5_BRIDGE_PORT=8000
MT5_BRIDGE_KEY=my-secret-key

# Server
PORT=3000
LOG_LEVEL=info
```

## Checking Key Status

`GET /api/keys` returns which keys are set (boolean flags only — values never returned):

```json
{
  "anthropicApiKey": true,
  "claudeSessionToken": false,
  "openrouterApiKey": false,
  "finnhubKey": true,
  "ollamaUrl": null,
  "openaiStatus": "not_configured"
}
```

`POST /api/test-connection` with `{ "service": "anthropic" | "openrouter" | "finnhub" | "mt5" | "ollama" }` tests live connectivity.
