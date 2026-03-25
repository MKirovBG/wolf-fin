// Wolf-Fin — HTTP dashboard server
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, appendFileSync, readFileSync, writeFileSync } from 'fs';
import pino from 'pino';
import { getState, getAgent, upsertAgent, removeAgent, setAgentStatus, getLogs, subscribeToLogs, subscribeToAgentStatus } from './state.js';
import { dbGetCycleResults, dbGetCycleResultsForAgent, dbGetCycleById, dbGetLogsForCycle, dbGetMaxLogId, dbGetLogClearFloor, dbSetLogClearFloor, makeAgentKey, dbGetStrategy, dbSaveStrategy, dbDeleteStrategy, dbGetMemories, dbClearMemories, dbDeleteMemory, dbGetActivePlan, dbGetAllPlans, dbResetAgentData, dbGetSelectedAccount, dbSetSelectedAccount, dbSavePromptAnalysis, dbGetPromptAnalysis, dbGetLatestMCResult, dbSaveBacktestResult, dbUpdateBacktestReport, dbGetBacktestResult, dbUpsertMt5Accounts, dbMarkMt5AccountsGone, dbGetAllMt5Accounts, dbGetAgentStats } from '../db/index.js';
import { getRiskStateFor } from '../guardrails/riskStateStore.js';
import { startAgentSchedule, pauseAgentSchedule, stopAgentSchedule } from '../scheduler/index.js';
import { runAgentTick } from '../agent/index.js';
import { getAdapter } from '../adapters/registry.js';
import { MT5Adapter, setBridgeActiveLogin } from '../adapters/mt5.js';
import { runBacktest } from '../adapters/backtest.js';
import { BACKTEST_DEFAULTS } from '../adapters/backtest.js';
import { fetchCalendarForDisplay } from '../adapters/calendar.js';
const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const __dirname = dirname(fileURLToPath(import.meta.url));
// ── Helpers ────────────────────────────────────────────────────────────────────
const ENV_KEYS = [
    'ANTHROPIC_API_KEY', 'CLAUDE_MODEL',
    'CLAUDE_SESSION_TOKEN',
    'OPENROUTER_API_KEY',
    'BINANCE_API_KEY', 'BINANCE_API_SECRET',
    'FINNHUB_KEY', 'COINGECKO_KEY',
    'OLLAMA_URL',
    'PLATFORM_LLM_PROVIDER', 'PLATFORM_LLM_MODEL',
];
function envPresent(key) {
    return !!process.env[key]?.trim();
}
function persistEnvKey(key, value) {
    const envPath = join(__dirname, '../../.env');
    if (!existsSync(envPath))
        return;
    const content = readFileSync(envPath, 'utf8');
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
        writeFileSync(envPath, content.replace(regex, `${key}=${value}`));
    }
    else {
        appendFileSync(envPath, `\n${key}=${value}`);
    }
    process.env[key] = value;
}
async function testConnection(service) {
    try {
        switch (service) {
            case 'anthropic': {
                const r = await fetch('https://api.anthropic.com/v1/models', {
                    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01' },
                });
                return r.ok ? { ok: true, message: 'Connected' } : { ok: false, message: `HTTP ${r.status}` };
            }
            case 'anthropic-subscription': {
                const token = process.env.CLAUDE_SESSION_TOKEN;
                if (!token)
                    return { ok: false, message: 'CLAUDE_SESSION_TOKEN not set' };
                const r = await fetch('https://api.anthropic.com/v1/models', {
                    headers: { 'Authorization': `Bearer ${token}`, 'anthropic-version': '2023-06-01' },
                });
                return r.ok ? { ok: true, message: 'Connected (subscription)' } : { ok: false, message: `HTTP ${r.status}` };
            }
            case 'openrouter': {
                const key = process.env.OPENROUTER_API_KEY;
                if (!key)
                    return { ok: false, message: 'OPENROUTER_API_KEY not set' };
                const r = await fetch('https://openrouter.ai/api/v1/models', {
                    headers: { 'Authorization': `Bearer ${key}` },
                });
                if (!r.ok)
                    return { ok: false, message: `HTTP ${r.status}` };
                const data = await r.json();
                return { ok: true, message: `Connected — ${data.data.length} models available` };
            }
            case 'binance': {
                const binKey = process.env.BINANCE_API_KEY?.trim();
                const binSecret = process.env.BINANCE_API_SECRET?.trim();
                if (binKey && binSecret) {
                    const { createHmac } = await import('crypto');
                    const testnet = process.env.BINANCE_TESTNET === 'true';
                    const base = testnet ? 'https://testnet.binance.vision' : 'https://api.binance.com';
                    const ts = Date.now();
                    const qs = `timestamp=${ts}`;
                    const sig = createHmac('sha256', binSecret).update(qs).digest('hex');
                    const r = await fetch(`${base}/api/v3/account?${qs}&signature=${sig}`, {
                        headers: { 'X-MBX-APIKEY': binKey },
                    });
                    if (r.ok) {
                        const data = await r.json();
                        const nonZero = (data.balances ?? []).filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0).length;
                        return { ok: true, message: `Account OK — ${nonZero} non-zero balance${nonZero !== 1 ? 's' : ''}` };
                    }
                    const errText = await r.text();
                    return { ok: false, message: `HTTP ${r.status}: ${errText}` };
                }
                const base = 'https://api.binance.com';
                const r = await fetch(`${base}/api/v3/ping`);
                return r.ok ? { ok: true, message: 'Ping OK (no keys set — auth not verified)' } : { ok: false, message: `HTTP ${r.status}` };
            }
            case 'ollama': {
                const baseUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
                const r = await fetch(`${baseUrl}/api/tags`);
                if (!r.ok)
                    return { ok: false, message: `HTTP ${r.status}` };
                const data = await r.json();
                return { ok: true, message: `Connected — ${data.models.length} local model${data.models.length !== 1 ? 's' : ''}` };
            }
            case 'finnhub': {
                const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${process.env.FINNHUB_KEY ?? ''}`);
                return r.ok ? { ok: true, message: 'Connected' } : { ok: false, message: `HTTP ${r.status}` };
            }
            case 'coingecko': {
                const cgKey = process.env.COINGECKO_KEY?.trim();
                const isDemo = cgKey?.startsWith('CG-');
                const base = (cgKey && !isDemo) ? 'https://pro-api.coingecko.com' : 'https://api.coingecko.com';
                const headers = {};
                if (cgKey && isDemo)
                    headers['x-cg-demo-api-key'] = cgKey;
                if (cgKey && !isDemo)
                    headers['x-cg-pro-api-key'] = cgKey;
                const r = await fetch(`${base}/api/v3/simple/price?ids=bitcoin&vs_currencies=usd`, { headers });
                if (!r.ok)
                    return { ok: false, message: `HTTP ${r.status}` };
                const data = await r.json();
                const price = data?.bitcoin?.usd;
                const tier = !cgKey ? 'free tier' : isDemo ? 'demo key' : 'pro key';
                return price
                    ? { ok: true, message: `Connected (${tier}) — BTC $${price.toLocaleString()}` }
                    : { ok: false, message: 'Connected but response malformed' };
            }
            default:
                return { ok: false, message: 'Unknown service' };
        }
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : (typeof e === 'object' && e !== null && 'message' in e ? String(e.message) : String(e));
        return { ok: false, message: msg };
    }
}
function defaultAgentState(config) {
    return { config, status: 'idle', lastCycle: null, startedAt: null, cycleCount: 0 };
}
// ── Server ─────────────────────────────────────────────────────────────────────
export async function startServer() {
    const app = Fastify({ logger: false });
    // ── Status ──────────────────────────────────────────────────────────────────
    app.get('/api/status', async () => {
        const { agents, recentEvents } = getState();
        return {
            agents: Object.entries(agents).map(([key, agent]) => ({ ...agent, agentKey: key })),
            recentEvents,
            risk: getRiskStateFor('crypto'),
        };
    });
    // ── Selected account ────────────────────────────────────────────────────────
    app.get('/api/selected-account', async () => {
        return dbGetSelectedAccount() ?? null;
    });
    app.post('/api/selected-account', async (req) => {
        const body = req.body;
        dbSetSelectedAccount(body);
        return { ok: true };
    });
    // ── Agents ──────────────────────────────────────────────────────────────────
    app.get('/api/agents', async (req) => {
        const { market, accountId } = req.query;
        let entries = Object.entries(getState().agents);
        // Filter by market when specified
        if (market)
            entries = entries.filter(([, a]) => a.config.market === market);
        // Filter by accountId (MT5 login or 'binance')
        if (accountId !== undefined) {
            if (market === 'mt5' || (!market && accountId !== 'binance')) {
                entries = entries.filter(([, a]) => String(a.config.mt5AccountId ?? '') === accountId);
            }
            // crypto/binance: accountId='binance' — market filter above is sufficient
        }
        // Include agentKey in every response so frontend never has to reconstruct it
        return entries.map(([key, agent]) => ({ ...agent, agentKey: key }));
    });
    app.post('/api/agents', async (req) => {
        const body = req.body;
        const key = makeAgentKey(body.market, body.symbol, body.mt5AccountId, body.name);
        // Detect agents sharing the same market+symbol+broker but different name
        const conflicts = Object.entries(getState().agents)
            .filter(([existingKey, a]) => existingKey !== key &&
            a.config.market === body.market &&
            a.config.symbol === body.symbol &&
            (a.config.mt5AccountId ?? null) === (body.mt5AccountId ?? null))
            .map(([, a]) => a.config.name ?? 'unnamed');
        upsertAgent(defaultAgentState(body));
        return { ok: true, key, conflicts: conflicts.length > 0 ? conflicts : undefined };
    });
    app.delete('/api/agents/:key', async (req) => {
        const { key } = req.params;
        const decoded = decodeURIComponent(key);
        stopAgentSchedule(decoded);
        removeAgent(decoded);
        // Cascade delete all agent data from DB
        const { dbResetAgentData } = await import('../db/index.js');
        dbResetAgentData(decoded);
        return { ok: true };
    });
    app.patch('/api/agents/:key/config', async (req) => {
        const { key } = req.params;
        const patch = req.body;
        const agent = getAgent(key);
        if (!agent)
            return { ok: false, message: 'Agent not found' };
        const wasRunning = agent.status === 'running';
        if (wasRunning)
            stopAgentSchedule(key);
        const updated = { ...agent, config: { ...agent.config, ...patch } };
        upsertAgent(updated);
        if (wasRunning)
            startAgentSchedule(updated.config);
        return { ok: true };
    });
    app.post('/api/agents/:key/start', async (req) => {
        const { key } = req.params;
        const agent = getAgent(key);
        if (!agent)
            return { ok: false, message: 'Agent not found' };
        startAgentSchedule(agent.config);
        return { ok: true };
    });
    app.post('/api/agents/:key/pause', async (req) => {
        const { key } = req.params;
        if (!getAgent(key))
            return { ok: false, message: 'Agent not found' };
        pauseAgentSchedule(key);
        return { ok: true };
    });
    app.post('/api/agents/:key/stop', async (req) => {
        const { key } = req.params;
        if (!getAgent(key))
            return { ok: false, message: 'Agent not found' };
        stopAgentSchedule(key);
        return { ok: true };
    });
    app.post('/api/agents/:key/trigger', async (req) => {
        const { key } = req.params;
        const agent = getAgent(key);
        if (!agent)
            return { ok: false, message: 'Agent not found' };
        const { instructions } = (req.body ?? {});
        runAgentTick(agent.config, 'trading', instructions).catch(err => log.error({ err, key }, 'manual trigger error'));
        return { ok: true };
    });
    app.get('/api/agents/:key/cycles', async (req, reply) => {
        const key = decodeURIComponent(req.params.key);
        const { limit } = req.query;
        if (!getAgent(key))
            return reply.status(404).send({ error: 'Agent not found' });
        return dbGetCycleResultsForAgent(key, limit ? parseInt(limit) : 100);
    });
    // ── System Prompt ────────────────────────────────────────────────────────────
    app.get('/api/system-prompt/:key', async (req, reply) => {
        const { key } = req.params;
        const agent = getAgent(key);
        if (!agent)
            return reply.status(404).send({ error: 'Agent not found' });
        const { buildSystemPrompt } = await import('../agent/index.js');
        const prompt = buildSystemPrompt(agent.config, key);
        return reply.send({ prompt });
    });
    // ── Logs ────────────────────────────────────────────────────────────────────
    app.get('/api/logs', async (req) => {
        const { since, agent } = req.query;
        const floor = dbGetLogClearFloor();
        const effectiveSince = Math.max(since ? parseInt(since) : 0, floor);
        return getLogs(effectiveSince || undefined, agent);
    });
    app.post('/api/logs/clear', async () => {
        const maxId = dbGetMaxLogId();
        dbSetLogClearFloor(maxId);
        return { ok: true, clearedAt: maxId };
    });
    // ── SSE log stream — real-time push, replaces polling ────────────────────────
    app.get('/api/events', async (req, reply) => {
        const { agent, since } = req.query;
        const floor = dbGetLogClearFloor();
        const sinceId = Math.max(since ? parseInt(since) : 0, floor);
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.setHeader('X-Accel-Buffering', 'no');
        reply.raw.flushHeaders();
        // Fresh connection (no since param): push last 50 entries as initial state
        // Reconnect (since param present): push only missed entries since last seen ID
        if (!since) {
            const recent = getLogs(undefined, agent, 50);
            for (const entry of [...recent].reverse()) {
                reply.raw.write(`data: ${JSON.stringify(entry)}\n\n`);
            }
        }
        else if (sinceId > 0) {
            const missed = getLogs(sinceId, agent, 100);
            for (const entry of [...missed].reverse()) {
                reply.raw.write(`data: ${JSON.stringify(entry)}\n\n`);
            }
        }
        // Subscribe to log events
        const unsubscribeLogs = subscribeToLogs((entry) => {
            if (agent && entry.agentKey !== agent)
                return;
            if (entry.id <= floor)
                return;
            try {
                reply.raw.write(`data: ${JSON.stringify(entry)}\n\n`);
            }
            catch { /* client disconnected */ }
        });
        // Subscribe to agent status/cycle changes — send as named 'agent' event
        const unsubscribeStatus = subscribeToAgentStatus((event) => {
            if (agent && event.agentKey !== agent)
                return;
            try {
                reply.raw.write(`event: agent\ndata: ${JSON.stringify({ ...event.agent, agentKey: event.agentKey })}\n\n`);
            }
            catch { /* client disconnected */ }
        });
        // Heartbeat every 20s to keep connection alive through proxies
        const heartbeat = setInterval(() => {
            try {
                reply.raw.write(': heartbeat\n\n');
            }
            catch {
                clearInterval(heartbeat);
                unsubscribeLogs();
                unsubscribeStatus();
            }
        }, 20_000);
        req.raw.on('close', () => {
            clearInterval(heartbeat);
            unsubscribeLogs();
            unsubscribeStatus();
        });
        // Keep the handler open — reply.raw handles the stream
        await new Promise(resolve => req.raw.on('close', resolve));
    });
    // ── Market Data (read-only snapshot, no agent/Claude involved) ───────────────
    app.get('/api/market/:market/:symbol', async (req, reply) => {
        const { market, symbol } = req.params;
        if (market !== 'crypto' && market !== 'mt5') {
            return reply.status(400).send({ error: 'market must be crypto or mt5' });
        }
        try {
            const adapter = getAdapter(market);
            const snapshot = await adapter.getSnapshot(symbol, getRiskStateFor('crypto'));
            return snapshot;
        }
        catch (e) {
            log.error({ market, symbol, err: e }, 'market data fetch error');
            return reply.status(502).send({ error: e instanceof Error ? e.message : 'Fetch failed' });
        }
    });
    // ── Keys ────────────────────────────────────────────────────────────────────
    app.get('/api/keys', async () => {
        return Object.fromEntries(ENV_KEYS.map(k => [k, envPresent(k)]));
    });
    app.post('/api/keys', async (req) => {
        const { key, value } = req.body;
        if (!ENV_KEYS.includes(key)) {
            return { ok: false, message: 'Unknown key' };
        }
        persistEnvKey(key, value);
        return { ok: true };
    });
    app.post('/api/keys/test/:service', async (req) => {
        const { service } = req.params;
        return testConnection(service);
    });
    // ── Claude Auth ───────────────────────────────────────────────────────────────
    const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
    const CLAUDE_REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
    const pkceStore = new Map();
    // Method 1: import directly from local Claude Code CLI credentials
    app.post('/api/auth/claude/import-from-cli', async (_req, reply) => {
        try {
            const { homedir } = await import('os');
            const credPath = join(homedir(), '.claude', '.credentials.json');
            if (!existsSync(credPath)) {
                return reply.status(404).send({ ok: false, message: 'Claude Code credentials not found at ~/.claude/.credentials.json — make sure Claude Code CLI is installed and logged in.' });
            }
            const creds = JSON.parse(readFileSync(credPath, 'utf8'));
            const token = creds?.claudeAiOauth?.accessToken;
            if (!token) {
                return reply.status(400).send({ ok: false, message: 'No access token found in Claude Code credentials.' });
            }
            persistEnvKey('CLAUDE_SESSION_TOKEN', token);
            return { ok: true, subscriptionType: creds?.claudeAiOauth?.subscriptionType ?? 'unknown' };
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return reply.status(500).send({ ok: false, message: msg });
        }
    });
    // Method 2: manual PKCE flow — returns auth URL; user pastes code back via /exchange
    app.get('/api/auth/claude/start', async () => {
        const { randomBytes, createHash } = await import('crypto');
        const verifier = randomBytes(32).toString('base64url');
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        const state = randomBytes(16).toString('hex');
        pkceStore.set(state, { verifier, createdAt: Date.now() });
        for (const [k, v] of pkceStore) {
            if (Date.now() - v.createdAt > 600_000)
                pkceStore.delete(k);
        }
        const params = new URLSearchParams({
            client_id: CLAUDE_CLIENT_ID,
            response_type: 'code',
            redirect_uri: CLAUDE_REDIRECT_URI,
            scope: 'org:create_api_key user:profile user:inference',
            code_challenge: challenge,
            code_challenge_method: 'S256',
            state,
        });
        return { url: `https://claude.ai/oauth/authorize?${params}`, state };
    });
    // Method 2 exchange: user pastes code from the redirect URL
    app.post('/api/auth/claude/exchange', async (req, reply) => {
        const { code, state } = req.body;
        const stored = state ? pkceStore.get(state) : null;
        if (!stored)
            return reply.status(400).send({ ok: false, message: 'State expired or invalid — please start the auth flow again.' });
        pkceStore.delete(state);
        try {
            const tokenRes = await fetch('https://console.anthropic.com/v1/oauth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    grant_type: 'authorization_code',
                    client_id: CLAUDE_CLIENT_ID,
                    code,
                    redirect_uri: CLAUDE_REDIRECT_URI,
                    code_verifier: stored.verifier,
                }),
            });
            if (!tokenRes.ok) {
                const text = await tokenRes.text();
                return reply.status(502).send({ ok: false, message: `Token exchange failed (${tokenRes.status}): ${text}` });
            }
            const data = await tokenRes.json();
            persistEnvKey('CLAUDE_SESSION_TOKEN', data.access_token);
            return { ok: true };
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return reply.status(500).send({ ok: false, message: msg });
        }
    });
    // ── Platform LLM config ─────────────────────────────────────────────────────
    app.get('/api/platform-llm', async () => {
        return {
            provider: (process.env.PLATFORM_LLM_PROVIDER || 'anthropic'),
            model: process.env.PLATFORM_LLM_MODEL || '',
        };
    });
    app.post('/api/platform-llm', async (req) => {
        const { provider, model } = req.body;
        const validProviders = ['anthropic', 'anthropic-subscription', 'openrouter', 'ollama'];
        if (!validProviders.includes(provider))
            return { ok: false, message: 'Invalid provider' };
        persistEnvKey('PLATFORM_LLM_PROVIDER', provider);
        persistEnvKey('PLATFORM_LLM_MODEL', model ?? '');
        // Apply immediately to the running process — no restart needed
        process.env.PLATFORM_LLM_PROVIDER = provider;
        process.env.PLATFORM_LLM_MODEL = model ?? '';
        return { ok: true };
    });
    // ── Economic Calendar ────────────────────────────────────────────────────────
    app.get('/api/economic-calendar', async (req) => {
        const { currencies, days } = req.query;
        const events = await fetchCalendarForDisplay(currencies ? currencies.split(',').map(c => c.trim().toUpperCase()) : undefined, days ? parseInt(days, 10) : 7);
        return { ok: true, events };
    });
    // ── Agent Analytics ──────────────────────────────────────────────────────────
    app.get('/api/agents/:key/analytics', async (req, reply) => {
        const key = decodeURIComponent(req.params.key);
        if (!getAgent(key))
            return reply.status(404).send({ error: 'Agent not found' });
        const cycles = dbGetCycleResultsForAgent(key, 2000);
        const stats = dbGetAgentStats(key);
        // Build heatmap: "hour:dayOfWeek" → { totalPnl, count }
        const heatmap = {};
        for (const c of cycles) {
            if (c.pnlUsd == null)
                continue;
            const d = new Date(c.time);
            const cell = `${d.getUTCHours()}:${d.getUTCDay()}`;
            if (!heatmap[cell])
                heatmap[cell] = { totalPnl: 0, count: 0 };
            heatmap[cell].totalPnl += c.pnlUsd;
            heatmap[cell].count++;
        }
        return { ok: true, cycles, stats, heatmap };
    });
    // ── Reports ─────────────────────────────────────────────────────────────────
    app.get('/api/reports/summary', async () => {
        const summary = (market) => {
            const events = dbGetCycleResults(market);
            return {
                totalCycles: events.length,
                buys: events.filter(e => e.decision.toUpperCase().startsWith('BUY')).length,
                sells: events.filter(e => e.decision.toUpperCase().startsWith('SELL')).length,
                holds: events.filter(e => e.decision.toUpperCase().startsWith('HOLD')).length,
                errors: events.filter(e => e.error).length,
                risk: getRiskStateFor(market),
            };
        };
        return { crypto: summary('crypto'), mt5: summary('mt5') };
    });
    app.get('/api/reports/trades', async (req) => {
        const { market } = req.query;
        return dbGetCycleResults(market);
    });
    // ── Cycle detail — full context for a single cycle ───────────────────────────
    app.get('/api/cycles/:id', async (req, reply) => {
        const { id } = req.params;
        const cycle = dbGetCycleById(parseInt(id, 10));
        if (!cycle)
            return reply.status(404).send({ error: 'Cycle not found' });
        // Fetch the agent config for context
        const agentState = getAgent(cycle.agentKey);
        // Fetch all log entries that occurred during this cycle's execution window
        const logs = dbGetLogsForCycle(cycle.agentKey, cycle.time);
        return reply.send({ cycle, agent: agentState ?? null, logs });
    });
    async function fetchBinanceEntry() {
        const { createHmac } = await import('crypto');
        const binKey = process.env.BINANCE_API_KEY?.trim() ?? '';
        const binSecret = process.env.BINANCE_API_SECRET?.trim() ?? '';
        if (!binKey)
            throw new Error('Keys not configured');
        const testnet = process.env.BINANCE_TESTNET === 'true';
        const mode = testnet ? 'TESTNET' : 'LIVE';
        const base = testnet ? 'https://testnet.binance.vision' : 'https://api.binance.com';
        const ts = Date.now();
        const qs = `timestamp=${ts}`;
        const sig = createHmac('sha256', binSecret).update(qs).digest('hex');
        const [acct, orders] = await Promise.all([
            fetch(`${base}/api/v3/account?${qs}&signature=${sig}`, { headers: { 'X-MBX-APIKEY': binKey } })
                .then(r => { if (!r.ok)
                throw new Error(`account HTTP ${r.status}`); return r.json(); }),
            fetch(`${base}/api/v3/openOrders?timestamp=${ts}&signature=${createHmac('sha256', binSecret).update(`timestamp=${ts}`).digest('hex')}`, { headers: { 'X-MBX-APIKEY': binKey } })
                .then(r => { if (!r.ok)
                return []; return r.json(); }),
        ]);
        return {
            id: `binance-${mode.toLowerCase()}`, exchange: 'binance', mode, connected: true,
            balances: acct.balances
                .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
                .map(b => ({ asset: b.asset, free: parseFloat(b.free), locked: parseFloat(b.locked) }))
                .sort((a, b) => (b.free + b.locked) - (a.free + a.locked)),
            openOrders: orders.map(o => ({
                symbol: o.symbol, side: o.side, type: o.type,
                price: parseFloat(o.price), origQty: parseFloat(o.origQty),
                executedQty: parseFloat(o.executedQty), status: o.status, time: o.time,
            })),
        };
    }
    async function fetchMt5Entries() {
        const base = `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`;
        let health = { connected: false };
        let bridgeUp = false;
        let bridgeAccounts = [];
        try {
            health = await fetch(`${base}/health`).then(r => r.ok ? r.json() : { connected: false }).catch(() => ({ connected: false }));
            const accountsRes = await fetch(`${base}/accounts`);
            if (accountsRes.ok) {
                const data = await accountsRes.json();
                bridgeAccounts = data.accounts ?? [];
                bridgeUp = true;
            }
        }
        catch { /* bridge offline — fall through to DB */ }
        const activeLogin = health.account?.login;
        // Keep the adapter's buildUrl in sync — active account must not append ?accountId=
        if (activeLogin != null)
            setBridgeActiveLogin(activeLogin);
        // ── 2. If bridge is up, persist whatever it currently reports ─────────────
        if (bridgeUp) {
            // Always include the currently active account from /health even if /accounts doesn't list it.
            // This covers: (a) zero-account bridges, (b) bridges that cache old accounts after an MT5 account switch.
            if (activeLogin != null && !bridgeAccounts.some(a => a.login === activeLogin)) {
                const fullAcct = await fetch(`${base}/account`).then(r => r.ok ? r.json() : null).catch(() => null);
                if (fullAcct) {
                    bridgeAccounts.push({ login: fullAcct.login, name: fullAcct.name, server: fullAcct.server });
                }
            }
            if (bridgeAccounts.length > 0) {
                // Resolve mode for each account from the bridge
                const toUpsert = bridgeAccounts.map(a => ({
                    login: a.login,
                    name: a.name ?? `Account ${a.login}`,
                    server: a.server ?? '',
                    mode: (a.login === activeLogin && health.account
                        ? (health.account.trade_mode === 2 ? 'LIVE' : 'DEMO')
                        : 'DEMO'),
                }));
                dbUpsertMt5Accounts(toUpsert);
                dbMarkMt5AccountsGone(bridgeAccounts.map(a => a.login));
            }
        }
        // ── 3. Load the full persistent registry (bridge-live + disconnected) ──────
        const allKnown = dbGetAllMt5Accounts();
        // ── 4. Build entries — live accounts get full data, others show as inactive ─
        const results = await Promise.all(allKnown.map(async (acct) => {
            const inBridge = acct.inBridge && bridgeUp;
            // Inactive: not in current bridge report or bridge is down
            if (!inBridge || (activeLogin !== undefined && acct.login !== activeLogin)) {
                const reason = !bridgeUp
                    ? 'MT5 bridge is offline.'
                    : !acct.inBridge
                        ? `Not found in MT5 bridge — log into this account in MT5 to reconnect. Last seen: ${new Date(acct.lastSeenAt).toLocaleString()}`
                        : 'Not active — MT5 supports one connection at a time. Switch accounts in the MT5 bridge to view this account.';
                return {
                    id: `mt5-${acct.login}`,
                    exchange: 'mt5',
                    mode: acct.mode,
                    connected: false,
                    login: acct.login,
                    name: acct.name,
                    server: acct.server,
                    error: reason,
                };
            }
            // Active: fetch full data.
            // The bridge only supports /account (no params) for the currently active login —
            // ?accountId= returns 404 on single-account bridge builds.
            const accountUrl = acct.login === activeLogin ? `${base}/account` : `${base}/account?accountId=${acct.login}`;
            const positionsUrl = acct.login === activeLogin ? `${base}/positions` : `${base}/positions?accountId=${acct.login}`;
            try {
                const [acctData, positions] = await Promise.all([
                    fetch(accountUrl).then(r => { if (!r.ok)
                        throw new Error(`HTTP ${r.status}`); return r.json(); }),
                    fetch(positionsUrl).then(r => r.ok ? r.json() : []).catch(() => []),
                ]);
                const mode = acctData.trade_mode === 2 ? 'LIVE' : 'DEMO';
                return {
                    id: `mt5-${acct.login}`,
                    exchange: 'mt5', mode, connected: true,
                    login: acctData.login,
                    name: acctData.name ?? acct.name,
                    server: acctData.server,
                    summary: { balance: acctData.balance, equity: acctData.equity, margin: acctData.margin, freeMargin: acctData.free_margin, profit: acctData.profit, leverage: acctData.leverage, login: acctData.login, server: acctData.server },
                    positions,
                };
            }
            catch (e) {
                return { id: `mt5-${acct.login}`, exchange: 'mt5', mode: acct.mode, connected: false, login: acct.login, name: acct.name, server: acct.server, error: e instanceof Error ? e.message : `Failed to fetch account ${acct.login}` };
            }
        }));
        // ── 5. If nothing in DB yet and bridge is also empty, return a placeholder ─
        if (results.length === 0 && bridgeUp) {
            return [{ id: 'mt5-unknown', exchange: 'mt5', mode: 'DEMO', connected: false, error: 'No accounts registered in MT5 bridge.' }];
        }
        if (results.length === 0) {
            return [{ id: 'mt5-unknown', exchange: 'mt5', mode: 'DEMO', connected: false, error: 'Bridge not running' }];
        }
        return results;
    }
    // ── Symbol search ────────────────────────────────────────────────────────────
    const CRYPTO_SYMBOLS = [
        'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT',
        'LINKUSDT', 'LTCUSDT', 'MATICUSDT', 'UNIUSDT', 'ATOMUSDT', 'ETCUSDT', 'XLMUSDT', 'ALGOUSDT',
        'VETUSDT', 'FILUSDT', 'THETAUSDT', 'AAVEUSDT', 'MKRUSDT', 'AXSUSDT', 'SANDUSDT', 'MANAUSDT',
        'DOGEUSDT', 'SHIBUSDT', 'TRXUSDT', 'NEARUSDT', 'FTMUSDT', 'HBARUSDT', 'ICPUSDT', 'EGLDUSDT',
    ];
    app.get('/api/symbols', async (req, reply) => {
        const { market, search = '', accountId } = req.query;
        const q = search.toLowerCase();
        if (market === 'mt5') {
            const bridgeBase = `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`;
            try {
                const params = new URLSearchParams();
                if (q)
                    params.set('search', q);
                if (accountId)
                    params.set('accountId', accountId);
                const res = await fetch(`${bridgeBase}/symbols?${params}`);
                if (!res.ok)
                    return reply.status(502).send({ error: 'MT5 bridge error' });
                const data = await res.json();
                return reply.send(data.slice(0, 100).map(s => ({ symbol: s.name, description: s.description })));
            }
            catch {
                return reply.status(502).send({ error: 'MT5 bridge unavailable' });
            }
        }
        if (market === 'crypto') {
            const results = q ? CRYPTO_SYMBOLS.filter(s => s.toLowerCase().includes(q)) : CRYPTO_SYMBOLS;
            return reply.send(results.map(s => ({ symbol: s, description: s.replace('USDT', ' / USDT') })));
        }
        return reply.send([]);
    });
    // ── Anthropic models ──────────────────────────────────────────────────────
    app.get('/api/anthropic/models', async (_req, reply) => {
        const key = process.env.ANTHROPIC_API_KEY;
        if (!key)
            return reply.status(400).send({ error: 'ANTHROPIC_API_KEY not set' });
        const res = await fetch('https://api.anthropic.com/v1/models', {
            headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        });
        if (!res.ok)
            return reply.status(502).send({ error: `Anthropic HTTP ${res.status}` });
        const data = await res.json();
        const models = data.data
            .map(m => ({ id: m.id, name: m.display_name || m.id }))
            .sort((a, b) => b.id.localeCompare(a.id));
        return reply.send(models);
    });
    // ── OpenRouter models ─────────────────────────────────────────────────────
    app.get('/api/openrouter/models', async (_req, reply) => {
        const key = process.env.OPENROUTER_API_KEY;
        if (!key)
            return reply.status(400).send({ error: 'OPENROUTER_API_KEY not set' });
        const res = await fetch('https://openrouter.ai/api/v1/models', {
            headers: { 'Authorization': `Bearer ${key}` },
        });
        if (!res.ok)
            return reply.status(502).send({ error: `OpenRouter HTTP ${res.status}` });
        const data = await res.json();
        const models = data.data
            .map(m => ({
            id: m.id,
            name: m.name || m.id,
            contextLength: m.context_length ?? 0,
            promptCost: m.pricing?.prompt,
            completionCost: m.pricing?.completion,
        }))
            .sort((a, b) => a.name.localeCompare(b.name));
        return reply.send(models);
    });
    app.get('/api/ollama/models', async (_req, reply) => {
        const baseUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
        try {
            const res = await fetch(`${baseUrl}/api/tags`);
            if (!res.ok)
                return reply.status(502).send({ error: `Ollama HTTP ${res.status}` });
            const data = await res.json();
            const models = data.models.map(m => ({
                id: m.name,
                name: m.name,
                size: m.details?.parameter_size ?? '',
                family: m.details?.family ?? '',
            }));
            return reply.send(models);
        }
        catch {
            return reply.status(502).send({ error: `Ollama is not reachable at ${baseUrl}` });
        }
    });
    app.get('/api/mt5-accounts', async (_req, reply) => {
        // Returns the full persistent DB registry (all ever-seen accounts) so the agent
        // create form always shows every account including newly-discovered ones.
        // The active account (currently on the bridge) is flagged with active:true for auto-selection.
        const base = `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`;
        try {
            // Get active login from bridge health (non-fatal if bridge is down)
            const health = await fetch(`${base}/health`)
                .then(r => r.ok ? r.json() : { connected: false })
                .catch(() => ({ connected: false }));
            const activeLogin = health.account?.login;
            if (activeLogin != null)
                setBridgeActiveLogin(activeLogin);
            // Load from persistent DB — includes all accounts ever seen, not just what bridge reports now
            const allKnown = dbGetAllMt5Accounts();
            // For the active account, fetch live balance/equity; others return DB metadata only
            const enriched = await Promise.all(allKnown.map(async (acc) => {
                const isActive = acc.login === activeLogin;
                let balance = null;
                let equity = null;
                let currency = 'USD';
                let mode = acc.mode;
                if (isActive) {
                    const acctData = await fetch(`${base}/account`)
                        .then(r => r.ok ? r.json() : null)
                        .catch(() => null);
                    if (acctData) {
                        balance = acctData.balance;
                        equity = acctData.equity;
                        currency = acctData.currency ?? 'USD';
                        mode = acctData.trade_mode === 2 ? 'LIVE' : 'DEMO';
                    }
                }
                return {
                    login: acc.login,
                    name: acc.name || `Account ${acc.login}`,
                    server: acc.server,
                    balance,
                    equity,
                    currency,
                    mode,
                    active: isActive,
                    inBridge: acc.inBridge,
                };
            }));
            // Sort: active first, then by last seen (most recent first)
            enriched.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
            return reply.send(enriched);
        }
        catch (e) {
            return reply.status(502).send({ error: e instanceof Error ? e.message : 'Bridge error' });
        }
    });
    app.get('/api/accounts', async (_req, reply) => {
        const jobs = [];
        if (process.env.BINANCE_API_KEY)
            jobs.push(fetchBinanceEntry().catch(err => ({ id: 'binance-main', exchange: 'binance', mode: (process.env.BINANCE_TESTNET === 'true' ? 'TESTNET' : 'LIVE'), connected: false, error: String(err) })));
        // MT5 bridge — try all registered accounts; silently skip if bridge is not running
        const mt5Entries = await fetchMt5Entries().catch(() => [{ id: 'mt5-unknown', exchange: 'mt5', mode: 'DEMO', connected: false, error: 'Bridge not running' }]);
        mt5Entries.forEach(e => jobs.push(Promise.resolve(e)));
        const accounts = await Promise.all(jobs);
        return reply.send(accounts);
    });
    // ── Positions ────────────────────────────────────────────────────────────────
    app.get('/api/positions', async (_req, reply) => {
        const agents = Object.values(getState().agents);
        if (agents.length === 0)
            return [];
        const results = await Promise.allSettled(agents.map(async (agent) => {
            const adapter = getAdapter(agent.config.market, agent.config.mt5AccountId);
            const orders = await adapter.getOpenOrders(agent.config.symbol);
            return orders.map(o => ({
                ...o,
                agentKey: makeAgentKey(agent.config.market, agent.config.symbol, agent.config.mt5AccountId, agent.config.name),
                market: agent.config.market,
                paper: false,
            }));
        }));
        const positions = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
        return reply.send(positions);
    });
    app.post('/api/orders/:ticket/cancel', async (req, reply) => {
        const ticket = parseInt(req.params.ticket, 10);
        const { agentKey } = req.body;
        const agentState = getState().agents[agentKey];
        if (!agentState)
            return reply.status(404).send({ error: 'Agent not found' });
        const adapter = getAdapter(agentState.config.market, agentState.config.mt5AccountId);
        await adapter.cancelOrder(agentState.config.symbol, ticket);
        return reply.send({ ok: true, ticket });
    });
    app.post('/api/positions/:ticket/close', async (req, reply) => {
        const ticket = parseInt(req.params.ticket, 10);
        const { agentKey, volume } = req.body;
        const agentState = getState().agents[agentKey];
        if (!agentState)
            return reply.status(404).send({ error: 'Agent not found' });
        const adapter = getAdapter(agentState.config.market, agentState.config.mt5AccountId);
        const mt5 = adapter;
        if (typeof mt5.closePosition !== 'function')
            return reply.status(400).send({ error: 'close not supported for this market' });
        const result = await mt5.closePosition(ticket, volume);
        return reply.send(result);
    });
    app.post('/api/positions/:ticket/modify', async (req, reply) => {
        const ticket = parseInt(req.params.ticket, 10);
        const { agentKey, sl, tp } = req.body;
        const agentState = getState().agents[agentKey];
        if (!agentState)
            return reply.status(404).send({ error: 'Agent not found' });
        const adapter = getAdapter(agentState.config.market, agentState.config.mt5AccountId);
        const mt5 = adapter;
        if (typeof mt5.modifyPosition !== 'function')
            return reply.status(400).send({ error: 'modify not supported for this market' });
        const result = await mt5.modifyPosition(ticket, sl, tp);
        return reply.send(result);
    });
    app.get('/api/trades', async (_req, reply) => {
        const agents = Object.values(getState().agents);
        if (agents.length === 0)
            return [];
        const results = await Promise.allSettled(agents.map(async (agent) => {
            const adapter = getAdapter(agent.config.market, agent.config.mt5AccountId);
            const fills = await adapter.getTradeHistory(agent.config.symbol, 50);
            return fills.map(f => ({
                ...f,
                agentKey: makeAgentKey(agent.config.market, agent.config.symbol, agent.config.mt5AccountId, agent.config.name),
                market: agent.config.market,
                paper: false,
            }));
        }));
        const trades = results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
            .sort((a, b) => b.time - a.time);
        return reply.send(trades);
    });
    // ── Agent Strategy ────────────────────────────────────────────────────────────
    app.get('/api/agents/:key/strategy', async (req) => {
        const { key } = req.params;
        return dbGetStrategy(key) ?? {};
    });
    app.put('/api/agents/:key/strategy', async (req, reply) => {
        const { key } = req.params;
        const body = req.body;
        dbSaveStrategy({ ...body, agentKey: key });
        return reply.send({ ok: true });
    });
    app.delete('/api/agents/:key/strategy', async (req, reply) => {
        const { key } = req.params;
        dbDeleteStrategy(key);
        return reply.send({ ok: true });
    });
    // ── Agent Memory ──────────────────────────────────────────────────────────────
    app.get('/api/agents/:key/memories', async (req) => {
        const { key } = req.params;
        const { category } = req.query;
        return dbGetMemories(key, category, 100);
    });
    app.delete('/api/agents/:key/memories', async (req, reply) => {
        const { key } = req.params;
        dbClearMemories(key);
        return reply.send({ ok: true });
    });
    app.delete('/api/agents/:key/memories/:category/:memKey', async (req, reply) => {
        const { key, category, memKey } = req.params;
        dbDeleteMemory(key, category, decodeURIComponent(memKey));
        return reply.send({ ok: true });
    });
    // ── Reset all agent data (keeps config) ────────────────────────────────────
    app.post('/api/agents/:key/reset', async (req, reply) => {
        const { key } = req.params;
        const decoded = decodeURIComponent(key);
        // Stop the agent first if running
        const { stopAgentSchedule } = await import('../scheduler/index.js');
        stopAgentSchedule(decoded);
        setAgentStatus(decoded, 'idle');
        const result = dbResetAgentData(decoded);
        return reply.send({ ok: true, ...result });
    });
    // ── Agent Performance Stats ───────────────────────────────────────────────────
    app.get('/api/agents/:key/stats', async (req, reply) => {
        const { key } = req.params;
        return reply.send(dbGetAgentStats(decodeURIComponent(key)));
    });
    // ── Agent Plans ───────────────────────────────────────────────────────────────
    app.get('/api/agents/:key/plans', async (req) => {
        const { key } = req.params;
        return dbGetAllPlans(key, 10);
    });
    app.get('/api/agents/:key/plan/active', async (req) => {
        const { key } = req.params;
        return dbGetActivePlan(key) ?? {};
    });
    app.post('/api/agents/:key/plan', async (req, reply) => {
        const { key } = req.params;
        const agent = getAgent(key);
        if (!agent)
            return reply.status(404).send({ error: 'Agent not found' });
        if (agent.status === 'running') {
            // Agent is running — queue the plan request for the next tick
            const { queuePlanRequest } = await import('./state.js');
            queuePlanRequest(key);
            return reply.send({ ok: true, message: 'Planning cycle queued — will run on next tick' });
        }
        // Agent is idle — run immediately
        runAgentTick(agent.config, 'planning').catch(err => log.error({ err, key }, 'planning cycle error'));
        return reply.send({ ok: true, message: 'Planning cycle triggered' });
    });
    // ── Agent Monte Carlo (latest tick result) ───────────────────────────────────
    // Key is in query param to avoid %2F-in-path routing issues.
    app.get('/api/agent-mc', async (req, reply) => {
        const { key } = req.query;
        if (!key)
            return reply.status(400).send({ error: 'key required' });
        const result = dbGetLatestMCResult(key);
        if (!result)
            return reply.send({ ok: false, mc: null });
        return reply.send({ ok: true, mc: result.mc, time: result.time });
    });
    // ── Agent Prompt Analysis (Platform LLM) ─────────────────────────────────────
    // Key is in the body/query, not the URL path, to avoid %2F routing issues
    // with agent keys that contain slashes (e.g. "crypto:BTC/USDT").
    app.get('/api/agent-analyze', async (req, reply) => {
        const { key } = req.query;
        if (!key)
            return reply.status(400).send({ error: 'key required' });
        const saved = dbGetPromptAnalysis(key);
        if (!saved)
            return reply.send({ ok: false, analysis: null });
        return reply.send({ ok: true, ...saved });
    });
    app.post('/api/agent-analyze', async (req, reply) => {
        const { key } = req.body;
        const agent = getAgent(key);
        if (!agent)
            return reply.status(404).send({ error: 'Agent not found' });
        try {
            const { getLLMProvider, getModelForConfig } = await import('../llm/index.js');
            const { buildSystemPrompt } = await import('../agent/index.js');
            const provider = getLLMProvider(agent.config);
            const model = getModelForConfig(agent.config);
            const systemPrompt = buildSystemPrompt(agent.config, key);
            const strategy = dbGetStrategy(key);
            const memories = dbGetMemories(key, undefined, 20);
            const plan = dbGetActivePlan(key);
            const configSummary = [
                `Symbol: ${agent.config.symbol} (${agent.config.market.toUpperCase()})`,
                `Fetch Mode: ${agent.config.fetchMode}`,
                agent.config.leverage ? `Leverage: ${agent.config.leverage}x` : null,
                agent.config.dailyTargetUsd ? `Daily Target: $${agent.config.dailyTargetUsd}` : null,
                agent.config.maxRiskPercent ? `Max Risk/Trade: ${agent.config.maxRiskPercent}%` : null,
                agent.config.maxDailyLossUsd ? `Max Daily Loss: $${agent.config.maxDailyLossUsd}` : null,
                agent.config.maxDrawdownPercent ? `Max Drawdown: ${agent.config.maxDrawdownPercent}%` : null,
                agent.config.llmProvider ? `Agent LLM: ${agent.config.llmProvider}` : null,
            ].filter(Boolean).join('\n');
            const memorySummary = memories.length > 0
                ? memories.map(m => `[${m.category}] ${m.key}: ${m.value}`).join('\n')
                : 'No memories yet';
            const analysisPrompt = `You are analyzing a Wolf-Fin AI trading agent. Provide a thorough, plain-English analysis that helps the user understand exactly how this agent will behave — what it trades, how it decides, what protects it, and what to expect.

AGENT CONFIGURATION:
${configSummary}

COMPILED SYSTEM PROMPT:
${systemPrompt.slice(0, 6000)}

STRATEGY DOCUMENT:
${strategy ? `Style: ${strategy.style}\nEntry Rules: ${strategy.entryRules}\nExit Rules: ${strategy.exitRules}${strategy.filters ? `\nFilters: ${strategy.filters}` : ''}${strategy.notes ? `\nNotes: ${strategy.notes}` : ''}`.slice(0, 2000) : 'Not configured'}

PERSISTENT MEMORIES (${memories.length}):
${memorySummary}

ACTIVE PLAN:
${plan ? `Bias: ${plan.marketBias}${plan.keyLevels ? `\nKey Levels: ${plan.keyLevels}` : ''}${plan.riskNotes ? `\nRisk Notes: ${plan.riskNotes}` : ''}\n${plan.planText}`.slice(0, 1000) : 'No active plan'}

Return ONLY valid JSON in exactly this shape — no markdown, no explanation:
{
  "headline": "One clear sentence describing what this agent does and its goal",
  "sections": [
    {
      "title": "Trading Objective",
      "icon": "🎯",
      "content": "2-4 sentences. What market, what the agent is trying to achieve, its style (scalping/swing/trend etc)"
    },
    {
      "title": "How Decisions Are Made",
      "icon": "🧠",
      "content": "2-4 sentences. How the AI reads the market, what signals it looks for, how it decides LONG/SHORT/HOLD/CLOSE"
    },
    {
      "title": "Risk Controls",
      "icon": "🛡️",
      "content": "2-4 sentences. Stop loss strategy, take profit, position sizing, daily loss limits, drawdown protection"
    },
    {
      "title": "Market Context & Signals",
      "icon": "📡",
      "content": "2-4 sentences. What data feeds, indicators, news, or macro context the agent uses"
    },
    {
      "title": "Memory & Adaptation",
      "icon": "💾",
      "content": "2-4 sentences. How the agent learns from past decisions, uses persistent memory and session plans"
    },
    {
      "title": "Trade Execution",
      "icon": "⚡",
      "content": "2-4 sentences. How orders are placed, what tools are used, how positions are managed after entry"
    }
  ]
}`;
            const response = await provider.createMessage({
                model,
                max_tokens: 2048,
                system: 'You are a trading system analyst. Return only valid JSON.',
                tools: [],
                messages: [{ role: 'user', content: analysisPrompt }],
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const text = response.content
                .filter((b) => b.type === 'text')
                .map((b) => b.text).join('');
            // Strip markdown fences if present
            const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
            const analysis = JSON.parse(clean);
            const meta = { provider: agent.config.llmProvider || process.env.PLATFORM_LLM_PROVIDER || 'anthropic', model };
            dbSavePromptAnalysis(key, analysis, meta);
            return reply.send({ ok: true, analysis, meta });
        }
        catch (err) {
            log.error({ err, key }, 'agent analyze error');
            return reply.status(500).send({ error: String(err) });
        }
    });
    // ── Backtesting (MT5 only) ────────────────────────────────────────────────────
    // Key in query param (GET) or body (POST) to avoid %2F path-segment issues.
    // Load the last saved backtest result + AI report for an agent.
    app.get('/api/agent-backtest-result', async (req, reply) => {
        const { key } = req.query;
        if (!key)
            return reply.status(400).send({ error: 'key required' });
        const saved = dbGetBacktestResult(key);
        if (!saved)
            return reply.send({ ok: false, saved: null });
        return reply.send({ ok: true, saved });
    });
    app.post('/api/agent-backtest', async (req, reply) => {
        const { key, timeframe = 'H1', bars = 2000, slMult, tpMult, maxHoldBars, rsiOversold, rsiOverbought, requireEmaConfirm, rsiPeriod, emaFast, emaSlow, atrPeriod, startingEquityUsd, maxRiskPercent, } = req.body;
        if (!key)
            return reply.status(400).send({ error: 'key required' });
        const agent = getAgent(key);
        if (!agent)
            return reply.status(404).send({ error: 'Agent not found' });
        if (agent.config.market !== 'mt5') {
            return reply.status(400).send({ error: 'Backtesting is only available for MT5 agents.' });
        }
        try {
            // Fetch historical candles from MT5 bridge — use the agent's account if configured
            const tf = timeframe.toUpperCase();
            const candleCount = Math.min(Math.max(bars ?? 2000, 100), 10_000);
            const adapter = new MT5Adapter(agent.config.mt5AccountId);
            const [candles, symbolInfo] = await Promise.all([
                adapter.getHistoricalCandles(agent.config.symbol, tf, candleCount),
                adapter.getSymbolInfo(agent.config.symbol).catch(() => ({ pipSize: 1, pipValue: 1, point: 0.00001 })),
            ]);
            if (candles.length < 60) {
                return reply.status(422).send({ error: `Not enough historical data — only ${candles.length} bars returned. Try a higher timeframe.` });
            }
            const cfg = {
                ...BACKTEST_DEFAULTS,
                slMult: slMult ?? BACKTEST_DEFAULTS.slMult,
                tpMult: tpMult ?? BACKTEST_DEFAULTS.tpMult,
                maxHoldBars: maxHoldBars ?? BACKTEST_DEFAULTS.maxHoldBars,
                rsiOversold: rsiOversold ?? BACKTEST_DEFAULTS.rsiOversold,
                rsiOverbought: rsiOverbought ?? BACKTEST_DEFAULTS.rsiOverbought,
                requireEmaConfirm: requireEmaConfirm ?? BACKTEST_DEFAULTS.requireEmaConfirm,
                rsiPeriod: rsiPeriod ?? BACKTEST_DEFAULTS.rsiPeriod,
                emaFast: emaFast ?? BACKTEST_DEFAULTS.emaFast,
                emaSlow: emaSlow ?? BACKTEST_DEFAULTS.emaSlow,
                atrPeriod: atrPeriod ?? BACKTEST_DEFAULTS.atrPeriod,
                startingEquityUsd: startingEquityUsd ?? BACKTEST_DEFAULTS.startingEquityUsd,
                maxRiskPercent: maxRiskPercent ?? (agent.config.maxRiskPercent ?? BACKTEST_DEFAULTS.maxRiskPercent),
                pipSize: symbolInfo.pipSize,
                pipValue: symbolInfo.pipValue,
            };
            const result = runBacktest(candles, cfg);
            // Persist — report is saved separately once the LLM finishes
            dbSaveBacktestResult(key, { result, timeframe: tf, barsRequested: candleCount });
            return reply.send({ ok: true, result, timeframe: tf, barsRequested: candleCount });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error({ err: msg }, 'backtest failed');
            return reply.status(500).send({ error: `Backtest failed: ${msg}` });
        }
    });
    // ── Backtest AI Report ────────────────────────────────────────────────────────
    // Generates a detailed LLM-written analysis of a completed backtest run.
    // Uses the agent's own LLM provider setting (same as trading decisions).
    app.post('/api/agent-backtest-report', async (req, reply) => {
        const { key, timeframe, barsRequested, result } = req.body;
        if (!key || !result)
            return reply.status(400).send({ error: 'key and result required' });
        const agent = getAgent(key);
        if (!agent)
            return reply.status(404).send({ error: 'Agent not found' });
        try {
            const { getLLMProvider, getModelForConfig } = await import('../llm/index.js');
            const provider = getLLMProvider(agent.config);
            const model = getModelForConfig(agent.config);
            const { stats, config, trades, barsTotal, warmupBars } = result;
            const activeTrades = barsTotal - warmupBars;
            const coveragePct = barsTotal > 0 ? ((activeTrades / barsTotal) * 100).toFixed(1) : '—';
            const tradingPeriodBars = `${barsTotal} bars (${warmupBars} warmup, ${activeTrades} active)`;
            // Sample a few best/worst trades for context
            const sorted = [...trades].sort((a, b) => b.pnlUsd - a.pnlUsd);
            const bestTrades = sorted.slice(0, 3).map(t => `${t.direction} ${t.openTime.slice(0, 10)} → ${t.exitReason} P&L $${t.pnlUsd.toFixed(2)} (held ${t.barsHeld} bars)`);
            const worstTrades = sorted.slice(-3).reverse().map(t => `${t.direction} ${t.openTime.slice(0, 10)} → ${t.exitReason} P&L $${t.pnlUsd.toFixed(2)} (held ${t.barsHeld} bars)`);
            const reportPrompt = `You are an expert quantitative trading analyst. Analyse the following backtesting results for a rule-based trading agent and return a detailed report.

AGENT: ${key}
SYMBOL: ${agent.config.symbol} (${agent.config.market.toUpperCase()})
TIMEFRAME: ${timeframe}   BARS REQUESTED: ${barsRequested}   BARS PROCESSED: ${tradingPeriodBars}

─── BACKTEST CONFIGURATION ───────────────────────────────────────────────────
SL Multiplier (× ATR14): ${config.slMult}
TP Multiplier (× ATR14): ${config.tpMult}
Max Hold (bars):         ${config.maxHoldBars}
RSI Oversold threshold:  ${config.rsiOversold}   (long entries below this)
RSI Overbought threshold:${config.rsiOverbought}  (short entries above this)
EMA20 > EMA50 required:  ${config.requireEmaConfirm}
Starting Equity:         $${config.startingEquityUsd}
Max Risk per Trade:       ${config.maxRiskPercent}%

─── PERFORMANCE STATISTICS ───────────────────────────────────────────────────
Total Trades:      ${stats.totalTrades}
Win Rate:          ${stats.winRate != null ? (stats.winRate * 100).toFixed(1) + '%' : '—'}  (${stats.wins}W / ${stats.losses}L)
Total P&L:         $${stats.totalPnl.toFixed(2)}
Profit Factor:     ${stats.profitFactor != null ? stats.profitFactor.toFixed(2) : '—'}
Sharpe Ratio:      ${stats.sharpe != null ? stats.sharpe.toFixed(2) : '—'}
Max Drawdown:      $${stats.maxDrawdown.toFixed(2)} (${stats.maxDrawdownPct.toFixed(1)}%)
Avg Win:           ${stats.avgWin != null ? '$' + stats.avgWin.toFixed(2) : '—'}
Avg Loss:          ${stats.avgLoss != null ? '$' + stats.avgLoss.toFixed(2) : '—'}
Risk / Reward:     ${stats.riskReward != null ? stats.riskReward.toFixed(2) : '—'}
Expectancy/trade:  $${stats.expectancy.toFixed(2)}
Avg Hold (bars):   ${stats.avgBarsHeld.toFixed(1)}
Max Consec Wins:   ${stats.maxConsecWins}
Max Consec Losses: ${stats.maxConsecLosses}

─── BEST 3 TRADES ────────────────────────────────────────────────────────────
${bestTrades.join('\n') || 'No trades'}

─── WORST 3 TRADES ───────────────────────────────────────────────────────────
${worstTrades.join('\n') || 'No trades'}

Provide a comprehensive, expert-level analysis. Be direct, specific, and quantitative — reference the exact numbers above. Do not be generic.

Return ONLY valid JSON — no markdown fences, no explanation outside the JSON — in this exact shape:
{
  "verdict": {
    "rating": "STRONG" | "VIABLE" | "MARGINAL" | "AVOID",
    "summary": "2-3 sentence overall verdict on whether this strategy is deployable."
  },
  "performance": {
    "headline": "One sentence framing the performance results.",
    "detail": "3-5 sentences analysing win rate, profit factor, Sharpe, P&L and expectancy. Explain what they mean in practice."
  },
  "risk": {
    "headline": "One sentence framing the risk profile.",
    "detail": "3-5 sentences on max drawdown, consecutive losses, risk/reward geometry, and position sizing suitability."
  },
  "signals": {
    "headline": "One sentence on signal quality.",
    "detail": "3-5 sentences on how well the RSI + EMA thresholds are working, trade frequency, avg hold time, and whether EMA confirmation is helping or over-filtering."
  },
  "optimizations": [
    "Specific, actionable suggestion 1 (e.g. 'Raise RSI oversold from 35 to 28 — current threshold triggers too early in trending moves')",
    "Specific, actionable suggestion 2",
    "Specific, actionable suggestion 3",
    "Specific, actionable suggestion 4"
  ],
  "tradePatterns": {
    "headline": "One sentence on observed trade patterns.",
    "detail": "2-4 sentences on best/worst trades, exit reason distribution, any directional bias (long vs short), and hold-time observations."
  }
}`;
            const response = await provider.createMessage({
                model,
                max_tokens: 8192,
                system: 'You are an expert quantitative trading analyst. Return only valid JSON.',
                tools: [],
                messages: [{ role: 'user', content: reportPrompt }],
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const raw = response.content
                .filter((b) => b.type === 'text')
                .map((b) => b.text).join('');
            // Strip markdown fences then extract the outermost {...} block — guards
            // against the LLM prefixing/suffixing prose or truncating mid-JSON.
            const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
            const start = stripped.indexOf('{');
            const end = stripped.lastIndexOf('}');
            if (start === -1 || end === -1 || end <= start) {
                log.error({ raw: stripped.slice(0, 300) }, 'backtest report: no JSON object found in LLM response');
                throw new Error('LLM did not return a valid JSON object. Try again.');
            }
            const report = JSON.parse(stripped.slice(start, end + 1));
            // Persist the report alongside the backtest result
            dbUpdateBacktestReport(key, report, model);
            return reply.send({ ok: true, report, model, provider: agent.config.llmProvider || process.env.PLATFORM_LLM_PROVIDER || 'anthropic' });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error({ err: msg }, 'backtest report failed');
            return reply.status(500).send({ error: `Report generation failed: ${msg}` });
        }
    });
    // ── Serve React frontend ─────────────────────────────────────────────────────
    const frontendDist = join(__dirname, '../../frontend-dist');
    if (existsSync(frontendDist)) {
        await app.register(fastifyStatic, { root: frontendDist, prefix: '/' });
        app.setNotFoundHandler((_req, reply) => { reply.sendFile('index.html'); });
    }
    else {
        app.get('/', async (_req, reply) => {
            reply.type('text/html').send(`
        <html><body style="background:#0d0d0d;color:#e0e0e0;font-family:monospace;padding:40px">
          <h2 style="color:#00e676">Wolf-Fin API running</h2>
          <p>Frontend: run <code>cd frontend && pnpm dev</code> then open <a style="color:#00e676" href="http://localhost:5173">localhost:5173</a></p>
          <p>API: <a style="color:#00e676" href="/api/status">/api/status</a></p>
        </body></html>
      `);
        });
    }
    await app.listen({ port: PORT, host: '0.0.0.0' });
    log.info({ port: PORT }, `server running at http://localhost:${PORT}`);
    // ── MT5 bridge: prime bridgeActiveLogin immediately so agents don't start with
    //    an undefined active login (which causes ?accountId= on every bridge request).
    fetchMt5Entries().catch(() => { });
    // ── Startup connectivity checks ──────────────────────────────────────────────
    const services = ['anthropic', 'binance', 'finnhub', 'coingecko'];
    log.info('checking service connectivity...');
    for (const service of services) {
        testConnection(service).then(result => {
            if (result.ok) {
                log.info({ service }, `[${service}] ${result.message}`);
            }
            else {
                log.warn({ service }, `[${service}] ${result.message}`);
            }
        }).catch(err => {
            log.warn({ service, err }, `[${service}] check failed`);
        });
    }
}
//# sourceMappingURL=index.js.map