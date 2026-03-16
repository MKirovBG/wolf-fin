// Wolf-Fin — HTTP dashboard server
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, appendFileSync, readFileSync, writeFileSync } from 'fs';
import pino from 'pino';
import { getState, getAgent, upsertAgent, removeAgent, getLogs } from './state.js';
import { dbGetCycleResults, dbGetMaxLogId, dbGetLogClearFloor, dbSetLogClearFloor } from '../db/index.js';
import { getRiskState, MAX_DAILY_LOSS_USD } from '../guardrails/riskState.js';
import { getRiskStateFor } from '../guardrails/riskStateStore.js';
import { startAgentSchedule, pauseAgentSchedule, stopAgentSchedule } from '../scheduler/index.js';
import { runAgentCycle } from '../agent/index.js';
import { getAdapter } from '../adapters/registry.js';
const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const __dirname = dirname(fileURLToPath(import.meta.url));
// ── Helpers ────────────────────────────────────────────────────────────────────
const ENV_KEYS = [
    'ANTHROPIC_API_KEY', 'CLAUDE_MODEL',
    'OPENROUTER_API_KEY',
    'ALPACA_API_KEY', 'ALPACA_API_SECRET', 'ALPACA_PAPER_KEY', 'ALPACA_PAPER_SECRET',
    'BINANCE_API_KEY', 'BINANCE_API_SECRET',
    'FINNHUB_KEY', 'TWELVE_DATA_KEY', 'COINGECKO_KEY',
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
            case 'alpaca': {
                const messages = [];
                // Test data API with live keys
                if (process.env.ALPACA_API_KEY && process.env.ALPACA_API_SECRET) {
                    // Use a US stock snapshot — available on all account tiers, no subscription needed
                    const dr = await fetch('https://data.alpaca.markets/v2/stocks/AAPL/snapshot', {
                        headers: { 'APCA-API-KEY-ID': process.env.ALPACA_API_KEY, 'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET },
                    });
                    if (dr.ok) {
                        const snap = await dr.json();
                        const price = snap?.latestTrade?.p;
                        messages.push(price ? `Data API OK — AAPL $${price}` : 'Data API OK');
                    }
                    else {
                        messages.push(`Data API HTTP ${dr.status}`);
                    }
                }
                // Test trading API (paper or live)
                const paper = process.env.ALPACA_PAPER !== 'false';
                const tradingBase = paper ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';
                const key = paper ? process.env.ALPACA_PAPER_KEY : process.env.ALPACA_API_KEY;
                const secret = paper ? process.env.ALPACA_PAPER_SECRET : process.env.ALPACA_API_SECRET;
                if (key && secret) {
                    const tr = await fetch(`${tradingBase}/v2/account`, {
                        headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret },
                    });
                    messages.push(tr.ok ? (paper ? 'Paper trading OK' : 'Live trading OK') : `Trading API HTTP ${tr.status}`);
                }
                if (messages.length === 0)
                    return { ok: false, message: 'No Alpaca keys set' };
                const allOk = messages.every(m => m.includes('OK'));
                return { ok: allOk, message: messages.join(' | ') };
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
            case 'finnhub': {
                const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${process.env.FINNHUB_KEY ?? ''}`);
                return r.ok ? { ok: true, message: 'Connected' } : { ok: false, message: `HTTP ${r.status}` };
            }
            case 'twelvedata': {
                const r = await fetch(`https://api.twelvedata.com/price?symbol=AAPL&apikey=${process.env.TWELVE_DATA_KEY ?? ''}`);
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
            agents: Object.values(agents),
            recentEvents,
            risk: getRiskState(),
            maxDailyLossUsd: MAX_DAILY_LOSS_USD,
        };
    });
    // ── Agents ──────────────────────────────────────────────────────────────────
    app.get('/api/agents', async () => {
        return Object.values(getState().agents);
    });
    app.post('/api/agents', async (req) => {
        const body = req.body;
        const key = `${body.market}:${body.symbol}`;
        if (getAgent(key))
            return { ok: false, message: 'Agent already exists' };
        upsertAgent(defaultAgentState(body));
        return { ok: true, key };
    });
    app.delete('/api/agents/:key', async (req) => {
        const { key } = req.params;
        stopAgentSchedule(key);
        removeAgent(key);
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
        runAgentCycle(agent.config).catch(err => log.error({ err, key }, 'manual trigger error'));
        return { ok: true };
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
    // ── Market Data (read-only snapshot, no agent/Claude involved) ───────────────
    app.get('/api/market/:market/:symbol', async (req, reply) => {
        const { market, symbol } = req.params;
        if (market !== 'crypto' && market !== 'forex' && market !== 'mt5') {
            return reply.status(400).send({ error: 'market must be crypto, forex, or mt5' });
        }
        try {
            const adapter = getAdapter(market);
            const snapshot = await adapter.getSnapshot(symbol, getRiskState());
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
        return { crypto: summary('crypto'), forex: summary('forex'), mt5: summary('mt5') };
    });
    app.get('/api/reports/trades', async (req) => {
        const { market } = req.query;
        return dbGetCycleResults(market);
    });
    async function fetchAlpacaEntry(paper) {
        const id = paper ? 'alpaca-paper' : 'alpaca-live';
        const mode = paper ? 'PAPER' : 'LIVE';
        const keyId = paper ? (process.env.ALPACA_PAPER_KEY ?? '') : (process.env.ALPACA_API_KEY ?? '');
        const secret = paper ? (process.env.ALPACA_PAPER_SECRET ?? '') : (process.env.ALPACA_API_SECRET ?? '');
        if (!keyId)
            throw new Error('Keys not configured');
        const base = paper ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';
        const h = { 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secret };
        const [acct, pos, acts] = await Promise.all([
            fetch(`${base}/v2/account`, { headers: h }).then(r => { if (!r.ok)
                throw new Error(`account HTTP ${r.status}`); return r.json(); }),
            fetch(`${base}/v2/positions`, { headers: h }).then(r => { if (!r.ok)
                return []; return r.json(); }),
            fetch(`${base}/v2/account/activities/FILL?page_size=30`, { headers: h }).then(r => { if (!r.ok)
                return []; return r.json(); }),
        ]);
        return {
            id, exchange: 'alpaca', mode, connected: true,
            summary: {
                equity: parseFloat(acct.equity ?? '0'),
                cash: parseFloat(acct.cash ?? '0'),
                buyingPower: parseFloat(acct.buying_power ?? '0'),
                portfolioValue: parseFloat(acct.portfolio_value ?? '0'),
                unrealizedPl: parseFloat(acct.unrealized_pl ?? '0'),
                dayPl: parseFloat(acct.pl ?? '0'),
                status: acct.status ?? 'UNKNOWN',
            },
            positions: pos.map(p => ({
                symbol: p.symbol,
                side: p.side === 'long' ? 'BUY' : 'SELL',
                qty: Math.abs(parseFloat(p.qty ?? '0')),
                avgEntry: parseFloat(p.avg_entry_price ?? '0'),
                currentPrice: parseFloat(p.current_price ?? '0'),
                marketValue: parseFloat(p.market_value ?? '0'),
                unrealizedPl: parseFloat(p.unrealized_pl ?? '0'),
                unrealizedPlPct: parseFloat(p.unrealized_plpc ?? '0') * 100,
                costBasis: parseFloat(p.cost_basis ?? '0'),
            })),
            recentFills: acts.map(a => ({
                symbol: a.symbol,
                side: a.side === 'buy' ? 'BUY' : 'SELL',
                qty: parseFloat(a.qty ?? '0'),
                price: parseFloat(a.price ?? '0'),
                time: a.transaction_time,
            })),
        };
    }
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
        // Get registered accounts list
        const accountsRes = await fetch(`${base}/accounts`);
        if (!accountsRes.ok)
            throw new Error(`MT5 bridge HTTP ${accountsRes.status}`);
        const accountsData = await accountsRes.json();
        if (accountsData.accounts.length === 0) {
            // No registered accounts — fall back to currently active account
            const health = await fetch(`${base}/health`).then(r => r.json());
            const fullAcct = await fetch(`${base}/account`).then(r => r.json()).catch(() => null);
            const positions = await fetch(`${base}/positions`).then(r => r.json()).catch(() => []);
            const mode = fullAcct?.trade_mode === 2 ? 'LIVE' : 'DEMO';
            return [{
                    id: `mt5-${health.account?.login ?? 'unknown'}`,
                    exchange: 'mt5', mode, connected: health.connected,
                    summary: fullAcct ? { balance: fullAcct.balance, equity: fullAcct.equity, margin: fullAcct.margin, freeMargin: fullAcct.free_margin, profit: fullAcct.profit, leverage: fullAcct.leverage, login: fullAcct.login, server: fullAcct.server } : undefined,
                    positions,
                }];
        }
        return Promise.all(accountsData.accounts.map(async (acc) => {
            try {
                const [acctData, positions] = await Promise.all([
                    fetch(`${base}/account?accountId=${acc.login}`).then(r => { if (!r.ok)
                        throw new Error(`HTTP ${r.status}`); return r.json(); }),
                    fetch(`${base}/positions?accountId=${acc.login}`).then(r => r.ok ? r.json() : []).catch(() => []),
                ]);
                const mode = acctData.trade_mode === 2 ? 'LIVE' : 'DEMO';
                return {
                    id: `mt5-${acc.login}`,
                    exchange: 'mt5', mode, connected: true,
                    summary: { balance: acctData.balance, equity: acctData.equity, margin: acctData.margin, freeMargin: acctData.free_margin, profit: acctData.profit, leverage: acctData.leverage, login: acctData.login, server: acctData.server },
                    positions,
                };
            }
            catch (e) {
                return { id: `mt5-${acc.login}`, exchange: 'mt5', mode: 'DEMO', connected: false, error: e instanceof Error ? e.message : `Failed to fetch account ${acc.login}` };
            }
        }));
    }
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
    app.get('/api/mt5-accounts', async (_req, reply) => {
        const base = `http://127.0.0.1:${process.env.MT5_BRIDGE_PORT ?? '8000'}`;
        try {
            const accountsRes = await fetch(`${base}/accounts`);
            if (!accountsRes.ok)
                return reply.status(502).send({ error: 'MT5 bridge unavailable' });
            const data = await accountsRes.json();
            const enriched = await Promise.all(data.accounts.map(async (acc) => {
                const acctData = await fetch(`${base}/account?accountId=${acc.login}`)
                    .then(r => r.ok ? r.json() : null)
                    .catch(() => null);
                return {
                    login: acc.login,
                    name: acc.name ?? `Account ${acc.login}`,
                    server: acc.server ?? '',
                    balance: acctData?.balance ?? null,
                    equity: acctData?.equity ?? null,
                    currency: acctData?.currency ?? 'USD',
                    mode: (acctData?.trade_mode === 2 ? 'LIVE' : 'DEMO'),
                };
            }));
            return reply.send(enriched);
        }
        catch (e) {
            return reply.status(502).send({ error: e instanceof Error ? e.message : 'Bridge error' });
        }
    });
    app.get('/api/accounts', async (_req, reply) => {
        const jobs = [];
        if (process.env.ALPACA_PAPER_KEY)
            jobs.push(fetchAlpacaEntry(true).catch(err => ({ id: 'alpaca-paper', exchange: 'alpaca', mode: 'PAPER', connected: false, error: String(err) })));
        if (process.env.ALPACA_API_KEY)
            jobs.push(fetchAlpacaEntry(false).catch(err => ({ id: 'alpaca-live', exchange: 'alpaca', mode: 'LIVE', connected: false, error: String(err) })));
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
            const adapter = getAdapter(agent.config.market);
            const orders = await adapter.getOpenOrders(agent.config.symbol);
            return orders.map(o => ({
                ...o,
                agentKey: `${agent.config.market}:${agent.config.symbol}`,
                market: agent.config.market,
                paper: agent.config.paper,
            }));
        }));
        const positions = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
        return reply.send(positions);
    });
    app.get('/api/trades', async (_req, reply) => {
        const agents = Object.values(getState().agents);
        if (agents.length === 0)
            return [];
        const results = await Promise.allSettled(agents.map(async (agent) => {
            const adapter = getAdapter(agent.config.market);
            const fills = await adapter.getTradeHistory(agent.config.symbol, 50);
            return fills.map(f => ({
                ...f,
                agentKey: `${agent.config.market}:${agent.config.symbol}`,
                market: agent.config.market,
                paper: agent.config.paper,
            }));
        }));
        const trades = results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
            .sort((a, b) => b.time - a.time);
        return reply.send(trades);
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
    // ── Startup connectivity checks ──────────────────────────────────────────────
    const services = ['anthropic', 'alpaca', 'binance', 'finnhub', 'twelvedata', 'coingecko'];
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