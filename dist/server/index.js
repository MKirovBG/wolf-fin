// Wolf-Fin — HTTP dashboard server
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, appendFileSync, readFileSync, writeFileSync } from 'fs';
import pino from 'pino';
import { dbGetAllSymbols, dbGetSymbol, dbUpsertSymbol, dbDeleteSymbol, dbGetAnalyses, dbGetLatestAnalysis, dbGetAllRecentAnalyses, dbGetAnalysisById, dbGetAllMt5Accounts, dbUpsertMt5Accounts, dbMarkMt5AccountsGone, makeSymbolKey, } from '../db/index.js';
import { getLogs, subscribeToLogs, subscribeToAnalyses, broadcastAnalysisUpdate } from './state.js';
import { runAnalysis, isAnalysisRunning } from '../analyzer/index.js';
import { syncSchedule, stopSchedule, getScheduledKeys } from '../scheduler/index.js';
import { setBridgeActiveLogin } from '../adapters/mt5.js';
import { getPlatformLLMModel, getOpenAITokenStatus } from '../llm/index.js';
import { fetchCalendarForDisplay } from '../adapters/calendar.js';
const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const __dirname = dirname(fileURLToPath(import.meta.url));
// ── Helpers ────────────────────────────────────────────────────────────────────
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
                const key = process.env.ANTHROPIC_API_KEY;
                if (!key)
                    return { ok: false, message: 'ANTHROPIC_API_KEY not set' };
                const r = await fetch('https://api.anthropic.com/v1/models', {
                    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
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
                return { ok: true, message: 'Connected' };
            }
            case 'finnhub': {
                const key = process.env.FINNHUB_KEY;
                if (!key)
                    return { ok: false, message: 'FINNHUB_KEY not set' };
                const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${key}`);
                return r.ok ? { ok: true, message: 'Connected' } : { ok: false, message: `HTTP ${r.status}` };
            }
            case 'mt5': {
                const base = `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`;
                const r = await fetch(`${base}/health`).catch(() => null);
                if (!r || !r.ok)
                    return { ok: false, message: 'Bridge offline' };
                return { ok: true, message: 'Bridge connected' };
            }
            case 'ollama': {
                const baseUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
                const r = await fetch(`${baseUrl}/api/tags`).catch(() => null);
                return r?.ok ? { ok: true, message: 'Connected' } : { ok: false, message: 'Ollama not running' };
            }
            default:
                return { ok: false, message: `Unknown service: ${service}` };
        }
    }
    catch (e) {
        return { ok: false, message: String(e) };
    }
}
async function fetchMt5Entries() {
    const base = `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`;
    const key = process.env.MT5_BRIDGE_KEY ?? '';
    const hdrs = key ? { 'X-Bridge-Key': key } : {};
    let health = { connected: false };
    let bridgeUp = false;
    let bridgeAccounts = [];
    try {
        health = await fetch(`${base}/health`, { headers: hdrs })
            .then(r => r.ok ? r.json() : { connected: false })
            .catch(() => ({ connected: false }));
        const accRes = await fetch(`${base}/accounts`, { headers: hdrs });
        if (accRes.ok) {
            const d = await accRes.json();
            bridgeAccounts = d.accounts ?? [];
            bridgeUp = true;
        }
    }
    catch { /* bridge offline */ }
    const activeLogin = health.account?.login;
    if (activeLogin != null)
        setBridgeActiveLogin(activeLogin);
    // Persist known accounts to DB
    if (bridgeUp) {
        dbMarkMt5AccountsGone();
        const toUpsert = bridgeAccounts.map(a => ({
            login: a.login,
            name: a.name ?? '',
            server: a.server ?? '',
            mode: 'DEMO',
            lastSeenAt: new Date().toISOString(),
            inBridge: true,
        }));
        if (activeLogin != null && !toUpsert.some(a => a.login === activeLogin)) {
            toUpsert.push({
                login: activeLogin,
                name: '',
                server: '',
                mode: health.account?.trade_mode === 0 ? 'DEMO' : 'LIVE',
                lastSeenAt: new Date().toISOString(),
                inBridge: true,
            });
        }
        if (toUpsert.length > 0)
            dbUpsertMt5Accounts(toUpsert);
    }
    const allKnown = dbGetAllMt5Accounts();
    if (allKnown.length === 0) {
        return [{ id: 'mt5-unknown', exchange: 'mt5', mode: 'DEMO', connected: false,
                error: bridgeUp ? 'No accounts found in bridge' : 'MT5 bridge offline' }];
    }
    return allKnown.map(acct => {
        const isActive = activeLogin != null && acct.login === activeLogin;
        const inBridge = acct.inBridge && bridgeUp;
        const mode = acct.mode === 'LIVE' ? 'LIVE' : 'DEMO';
        return {
            id: `mt5-${acct.login}`,
            exchange: 'mt5',
            mode: mode,
            connected: isActive,
            label: acct.name || acct.server || `MT5 #${acct.login}`,
            error: !inBridge ? `Last seen: ${new Date(acct.lastSeenAt).toLocaleString()}` : undefined,
            summary: { login: acct.login, name: acct.name, server: acct.server },
        };
    });
}
// ── Server ─────────────────────────────────────────────────────────────────────
export async function startServer() {
    const app = Fastify({ logger: false });
    // ── Watch symbols CRUD ───────────────────────────────────────────────────────
    app.get('/api/symbols', async () => {
        return dbGetAllSymbols();
    });
    app.get('/api/symbols/:key', async (req, reply) => {
        const { key } = req.params;
        const sym = dbGetSymbol(key);
        if (!sym)
            return reply.status(404).send({ error: 'Symbol not found' });
        return sym;
    });
    app.post('/api/symbols', async (req, reply) => {
        const body = req.body;
        if (!body.symbol)
            return reply.status(400).send({ error: 'symbol is required' });
        const symbol = body.symbol.toUpperCase().replace(/_/g, '');
        const key = makeSymbolKey(symbol, body.mt5AccountId);
        if (dbGetSymbol(key)) {
            return reply.status(409).send({ error: `Symbol ${symbol} already in watchlist` });
        }
        const sym = {
            key,
            symbol,
            market: 'mt5',
            displayName: body.displayName,
            mt5AccountId: body.mt5AccountId,
            scheduleEnabled: body.scheduleEnabled ?? false,
            scheduleIntervalMs: body.scheduleIntervalMs,
            scheduleStartUtc: body.scheduleStartUtc,
            scheduleEndUtc: body.scheduleEndUtc,
            indicatorConfig: body.indicatorConfig,
            candleConfig: body.candleConfig,
            contextConfig: body.contextConfig,
            llmProvider: body.llmProvider,
            llmModel: body.llmModel,
            createdAt: new Date().toISOString(),
        };
        dbUpsertSymbol(sym);
        syncSchedule(sym);
        return reply.status(201).send({ ok: true, key });
    });
    app.patch('/api/symbols/:key', async (req, reply) => {
        const { key } = req.params;
        const existing = dbGetSymbol(key);
        if (!existing)
            return reply.status(404).send({ error: 'Symbol not found' });
        const patch = req.body;
        const updated = {
            ...existing,
            ...patch,
            key, // never change the key
            symbol: existing.symbol,
            market: existing.market,
            createdAt: existing.createdAt,
        };
        dbUpsertSymbol(updated);
        syncSchedule(updated);
        return { ok: true };
    });
    app.delete('/api/symbols/:key', async (req, reply) => {
        const { key } = req.params;
        if (!dbGetSymbol(key))
            return reply.status(404).send({ error: 'Symbol not found' });
        stopSchedule(key);
        dbDeleteSymbol(key);
        return { ok: true };
    });
    // ── Analysis ──────────────────────────────────────────────────────────────────
    app.post('/api/symbols/:key/analyze', async (req, reply) => {
        const { key } = req.params;
        const sym = dbGetSymbol(key);
        if (!sym)
            return reply.status(404).send({ error: 'Symbol not found' });
        if (isAnalysisRunning(key))
            return reply.status(409).send({ error: 'Analysis already running' });
        // Run in background — return immediately, client polls or listens to SSE
        runAnalysis(key)
            .then(result => broadcastAnalysisUpdate(key, result.id))
            .catch(err => log.error({ symbolKey: key, err }, 'manual analysis failed'));
        return { ok: true, message: 'Analysis started' };
    });
    app.get('/api/symbols/:key/analyses', async (req, reply) => {
        const { key } = req.params;
        const { limit } = req.query;
        if (!dbGetSymbol(key))
            return reply.status(404).send({ error: 'Symbol not found' });
        return dbGetAnalyses(key, limit ? parseInt(limit) : 50);
    });
    app.get('/api/symbols/:key/analyses/latest', async (req, reply) => {
        const { key } = req.params;
        const result = dbGetLatestAnalysis(key);
        if (!result)
            return reply.status(404).send({ error: 'No analyses yet' });
        return result;
    });
    app.get('/api/analyses', async (req) => {
        const { limit } = req.query;
        return dbGetAllRecentAnalyses(limit ? parseInt(limit) : 100);
    });
    app.get('/api/analyses/:id', async (req, reply) => {
        const { id } = req.params;
        const result = dbGetAnalysisById(parseInt(id));
        if (!result)
            return reply.status(404).send({ error: 'Analysis not found' });
        return result;
    });
    // Running state
    app.get('/api/symbols/:key/running', async (req) => {
        const { key } = req.params;
        return { running: isAnalysisRunning(key) };
    });
    // Scheduled symbols
    app.get('/api/scheduled', async () => {
        return { keys: getScheduledKeys() };
    });
    // ── Logs ──────────────────────────────────────────────────────────────────────
    app.get('/api/logs', async (req) => {
        const { sinceId, symbolKey, limit } = req.query;
        return getLogs(sinceId ? parseInt(sinceId) : undefined, symbolKey, limit ? parseInt(limit) : 200);
    });
    // SSE: real-time log stream
    app.get('/api/logs/stream', async (req, reply) => {
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        const unsub = subscribeToLogs(entry => {
            reply.raw.write(`data: ${JSON.stringify(entry)}\n\n`);
        });
        req.raw.on('close', unsub);
        reply.raw.write(': connected\n\n');
        return reply;
    });
    // SSE: analysis completion events
    app.get('/api/analyses/stream', async (req, reply) => {
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        const unsub = subscribeToAnalyses(event => {
            reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        });
        req.raw.on('close', unsub);
        reply.raw.write(': connected\n\n');
        return reply;
    });
    // ── MT5 Accounts ──────────────────────────────────────────────────────────────
    app.get('/api/accounts', async (_req, reply) => {
        const mt5Entries = await fetchMt5Entries().catch(() => [
            { id: 'mt5-unknown', exchange: 'mt5', mode: 'DEMO', connected: false, error: 'Bridge offline' }
        ]);
        return reply.send(mt5Entries);
    });
    app.get('/api/mt5-accounts', async (_req, reply) => {
        const base = `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`;
        const key = process.env.MT5_BRIDGE_KEY ?? '';
        const hdrs = key ? { 'X-Bridge-Key': key } : {};
        try {
            const health = await fetch(`${base}/health`, { headers: hdrs })
                .then(r => r.ok ? r.json() : {})
                .catch(() => ({}));
            const activeLogin = health.account?.login;
            const allKnown = dbGetAllMt5Accounts();
            return reply.send(allKnown.map(a => ({
                login: a.login,
                name: a.name,
                server: a.server,
                mode: a.mode,
                active: activeLogin === a.login,
                inBridge: a.inBridge,
            })));
        }
        catch {
            return reply.send(dbGetAllMt5Accounts());
        }
    });
    // MT5 bridge health pass-through
    app.get('/api/mt5/health', async (_req, reply) => {
        const base = `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`;
        try {
            const r = await fetch(`${base}/health`);
            const data = await r.json();
            return reply.send(data);
        }
        catch {
            return reply.status(503).send({ connected: false, error: 'Bridge offline' });
        }
    });
    // Symbol search (for add symbol form)
    app.get('/api/symbols/search', async (req, reply) => {
        const { q, accountId } = req.query;
        if (!q || q.length < 1)
            return reply.send([]);
        const base = `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`;
        try {
            const url = `${base}/symbols?search=${encodeURIComponent(q)}`;
            const r = await fetch(url);
            if (!r.ok)
                return reply.send([]);
            const data = await r.json();
            const symbols = (data.symbols ?? []).slice(0, 50).map(s => ({
                symbol: s.name,
                description: s.description,
            }));
            return reply.send(symbols);
        }
        catch {
            // Fallback: return query as a symbol candidate
            return reply.send([{ symbol: q.toUpperCase(), description: q.toUpperCase() }]);
        }
    });
    // ── LLM / Integration config ──────────────────────────────────────────────────
    app.get('/api/keys', async () => {
        return {
            anthropicApiKey: !!process.env.ANTHROPIC_API_KEY?.trim(),
            claudeSessionToken: !!process.env.CLAUDE_SESSION_TOKEN?.trim(),
            openrouterApiKey: !!process.env.OPENROUTER_API_KEY?.trim(),
            finnhubKey: !!process.env.FINNHUB_KEY?.trim(),
            ollamaUrl: process.env.OLLAMA_URL || null,
            openaiStatus: getOpenAITokenStatus(),
        };
    });
    app.post('/api/keys', async (req) => {
        const body = req.body;
        const allowed = ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'FINNHUB_KEY', 'OLLAMA_URL'];
        for (const key of allowed) {
            if (body[key] != null)
                persistEnvKey(key, body[key]);
        }
        return { ok: true };
    });
    app.post('/api/test-connection', async (req) => {
        const { service } = req.body;
        return testConnection(service);
    });
    // Platform LLM config
    app.get('/api/platform-llm', async () => {
        return {
            provider: process.env.PLATFORM_LLM_PROVIDER || 'anthropic',
            model: getPlatformLLMModel(),
        };
    });
    app.post('/api/platform-llm', async (req) => {
        const { provider, model } = req.body;
        const validProviders = ['anthropic', 'anthropic-subscription', 'openrouter', 'ollama', 'openai-subscription'];
        if (!validProviders.includes(provider))
            return { ok: false, message: 'Invalid provider' };
        persistEnvKey('PLATFORM_LLM_PROVIDER', provider);
        persistEnvKey('PLATFORM_LLM_MODEL', model ?? '');
        process.env.PLATFORM_LLM_PROVIDER = provider;
        process.env.PLATFORM_LLM_MODEL = model ?? '';
        return { ok: true };
    });
    // Anthropic model list
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
        return reply.send(data.data.map(m => ({ id: m.id, name: m.display_name ?? m.id })));
    });
    // OpenRouter model list
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
        return reply.send(data.data.map(m => ({ id: m.id, name: m.name ?? m.id })));
    });
    // Ollama model list
    app.get('/api/ollama/models', async (_req, reply) => {
        const base = process.env.OLLAMA_URL || 'http://localhost:11434';
        const res = await fetch(`${base}/api/tags`).catch(() => null);
        if (!res?.ok)
            return reply.status(503).send({ error: 'Ollama not reachable' });
        const data = await res.json();
        return reply.send((data.models ?? []).map(m => ({ id: m.name, name: m.name })));
    });
    // ── Claude / OpenAI auth ──────────────────────────────────────────────────────
    const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
    const CLAUDE_REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
    const pkceStore = new Map();
    app.post('/api/auth/claude/import-from-cli', async (_req, reply) => {
        try {
            const { homedir } = await import('os');
            const credPath = join(homedir(), '.claude', '.credentials.json');
            if (!existsSync(credPath)) {
                return reply.status(404).send({ ok: false, message: 'Claude Code credentials not found' });
            }
            const creds = JSON.parse(readFileSync(credPath, 'utf8'));
            const token = creds?.claudeAiOauth?.accessToken;
            if (!token)
                return reply.status(400).send({ ok: false, message: 'No access token in credentials' });
            persistEnvKey('CLAUDE_SESSION_TOKEN', token);
            return { ok: true, subscriptionType: creds?.claudeAiOauth?.subscriptionType ?? 'unknown' };
        }
        catch (e) {
            return reply.status(500).send({ ok: false, message: String(e) });
        }
    });
    app.get('/api/auth/claude/start', async () => {
        const { randomBytes, createHash } = await import('crypto');
        const verifier = randomBytes(32).toString('base64url');
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        const state = randomBytes(16).toString('base64url');
        pkceStore.set(state, { verifier, createdAt: Date.now() });
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: CLAUDE_CLIENT_ID,
            redirect_uri: CLAUDE_REDIRECT_URI,
            scope: 'openid',
            code_challenge: challenge,
            code_challenge_method: 'S256',
            state,
        });
        return { url: `https://claude.ai/oauth/authorize?${params}`, state };
    });
    app.post('/api/auth/claude/exchange', async (req, reply) => {
        const { code, state } = req.body;
        const stored = state ? pkceStore.get(state) : null;
        if (!stored)
            return reply.status(400).send({ ok: false, message: 'State expired — restart auth flow' });
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
                const err = await tokenRes.text();
                return reply.status(tokenRes.status).send({ ok: false, message: err });
            }
            const data = await tokenRes.json();
            persistEnvKey('CLAUDE_SESSION_TOKEN', data.access_token);
            return { ok: true };
        }
        catch (e) {
            return reply.status(500).send({ ok: false, message: String(e) });
        }
    });
    // OpenAI OAuth (PKCE)
    const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
    const OPENAI_AUTH_URL = 'https://auth.openai.com/oauth/authorize';
    const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token';
    const OPENAI_REDIRECT_URI = 'http://localhost:1455/auth/callback';
    const OPENAI_SCOPES = 'openid profile email offline_access';
    const openAIPkceStore = new Map();
    app.get('/api/auth/openai/start', async () => {
        const { randomBytes, createHash } = await import('crypto');
        const verifier = randomBytes(32).toString('base64url');
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        const state = randomBytes(16).toString('base64url');
        openAIPkceStore.set(state, { verifier, createdAt: Date.now() });
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: OPENAI_CLIENT_ID,
            redirect_uri: OPENAI_REDIRECT_URI,
            scope: OPENAI_SCOPES,
            code_challenge: challenge,
            code_challenge_method: 'S256',
            state,
        });
        return { url: `${OPENAI_AUTH_URL}?${params}`, state };
    });
    app.post('/api/auth/openai/exchange', async (req, reply) => {
        const { code, state } = req.body;
        const stored = state ? openAIPkceStore.get(state) : null;
        if (!stored)
            return reply.status(400).send({ ok: false, message: 'State expired — restart auth flow' });
        openAIPkceStore.delete(state);
        try {
            const tokenRes = await fetch(OPENAI_TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    client_id: OPENAI_CLIENT_ID,
                    code,
                    redirect_uri: OPENAI_REDIRECT_URI,
                    code_verifier: stored.verifier,
                }),
            });
            if (!tokenRes.ok) {
                const err = await tokenRes.text();
                return reply.status(tokenRes.status).send({ ok: false, message: err });
            }
            const data = await tokenRes.json();
            persistEnvKey('OPENAI_ACCESS_TOKEN', data.access_token);
            if (data.refresh_token)
                persistEnvKey('OPENAI_REFRESH_TOKEN', data.refresh_token);
            if (data.expires_in)
                persistEnvKey('OPENAI_TOKEN_EXPIRES', String(Date.now() + data.expires_in * 1000));
            return { ok: true };
        }
        catch (e) {
            return reply.status(500).send({ ok: false, message: String(e) });
        }
    });
    app.post('/api/auth/openai/refresh', async (_req, reply) => {
        const refreshToken = process.env.OPENAI_REFRESH_TOKEN;
        if (!refreshToken)
            return reply.status(400).send({ ok: false, message: 'No refresh token stored' });
        try {
            const { refreshOpenAIToken } = await import('../llm/openai-subscription.js');
            const data = await refreshOpenAIToken(refreshToken);
            persistEnvKey('OPENAI_ACCESS_TOKEN', data.access_token);
            if (data.refresh_token)
                persistEnvKey('OPENAI_REFRESH_TOKEN', data.refresh_token);
            if (data.expires_in)
                persistEnvKey('OPENAI_TOKEN_EXPIRES', String(Date.now() + data.expires_in * 1000));
            return { ok: true };
        }
        catch (e) {
            return reply.status(500).send({ ok: false, message: String(e) });
        }
    });
    // ── Calendar ──────────────────────────────────────────────────────────────────
    app.get('/api/calendar', async () => {
        return fetchCalendarForDisplay();
    });
    // ── Dashboard status ──────────────────────────────────────────────────────────
    app.get('/api/status', async () => {
        const symbols = dbGetAllSymbols();
        const recentAnalyses = dbGetAllRecentAnalyses(20);
        return {
            symbols,
            recentAnalyses,
            scheduled: getScheduledKeys(),
        };
    });
    // ── Serve React frontend ──────────────────────────────────────────────────────
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
    log.info({ port: PORT }, `Wolf-Fin server running at http://localhost:${PORT}`);
    // Prime MT5 bridge data on startup
    fetchMt5Entries().catch(() => { });
}
//# sourceMappingURL=index.js.map