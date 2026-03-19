// Wolf-Fin — shared in-memory state (with SQLite persistence)
import { dbUpsertAgent, dbRemoveAgent, dbUpdateAgentStatus, dbRecordCycle, dbLogEvent, dbGetLogs, dbGetMaxLogId, makeAgentKey, } from '../db/index.js';
// ── Cycle in-flight lock — prevents concurrent runs for the same agent ────────
const cyclesInFlight = new Set();
export function tryAcquireCycleLock(agentKey) {
    if (cyclesInFlight.has(agentKey))
        return false;
    cyclesInFlight.add(agentKey);
    return true;
}
export function releaseCycleLock(agentKey) {
    cyclesInFlight.delete(agentKey);
}
// ── Queued planning requests — allows Plan button to work while agent is running ──
const pendingPlanRequests = new Set();
export function queuePlanRequest(agentKey) {
    pendingPlanRequests.add(agentKey);
}
export function consumePlanRequest(agentKey) {
    if (pendingPlanRequests.has(agentKey)) {
        pendingPlanRequests.delete(agentKey);
        return true;
    }
    return false;
}
// ── Log buffer ────────────────────────────────────────────────────────────────
// Initialized lazily on first use so it reads from DB after initDb() has run
let logSeq = -1;
function nextLogId() {
    if (logSeq === -1)
        logSeq = dbGetMaxLogId();
    return ++logSeq;
}
const logBuffer = [];
const logSubscribers = new Set();
export function subscribeToLogs(cb) {
    logSubscribers.add(cb);
    return () => logSubscribers.delete(cb);
}
const agentStatusSubscribers = new Set();
export function subscribeToAgentStatus(cb) {
    agentStatusSubscribers.add(cb);
    return () => agentStatusSubscribers.delete(cb);
}
function broadcastAgentUpdate(key) {
    const agent = state.agents[key];
    if (!agent)
        return;
    const event = { type: 'agent_update', agentKey: key, agent };
    for (const sub of agentStatusSubscribers) {
        try {
            sub(event);
        }
        catch { /* ignore */ }
    }
}
export function logEvent(agentKey, level, event, message, data) {
    const entry = { id: nextLogId(), time: new Date().toISOString(), agentKey, level, event, message, data };
    logBuffer.unshift(entry);
    if (logBuffer.length > 500)
        logBuffer.length = 500;
    dbLogEvent(entry);
    // Broadcast to SSE subscribers
    for (const sub of logSubscribers) {
        try {
            sub(entry);
        }
        catch { /* ignore subscriber errors */ }
    }
}
export function getLogs(sinceId, agentKey, limit = 200) {
    return dbGetLogs(sinceId, agentKey, limit);
}
const state = {
    agents: {},
    recentEvents: [],
};
export function getState() {
    return state;
}
export function getAgent(key) {
    return state.agents[key];
}
export function upsertAgent(agent) {
    const key = makeAgentKey(agent.config.market, agent.config.symbol, agent.config.mt5AccountId, agent.config.name);
    state.agents[key] = agent;
    dbUpsertAgent(agent);
}
export function removeAgent(key) {
    delete state.agents[key];
    dbRemoveAgent(key);
}
export function setAgentStatus(key, status) {
    const agent = state.agents[key];
    if (agent) {
        agent.status = status;
        if (status === 'running' && !agent.startedAt) {
            agent.startedAt = new Date().toISOString();
        }
        if (status === 'idle') {
            agent.startedAt = null;
        }
        dbUpdateAgentStatus(key, agent.status, agent.startedAt);
        broadcastAgentUpdate(key);
    }
}
export function recordCycle(key, result) {
    const isExternalClose = result.decision === 'EXTERNAL_CLOSE';
    const agent = state.agents[key];
    if (agent) {
        // Don't overwrite lastCycle for EXTERNAL_CLOSE — it's a pre-tick detection event,
        // not the agent's actual decision. The real decision comes when the tick finishes.
        if (!isExternalClose) {
            agent.lastCycle = result;
        }
        agent.cycleCount++;
        dbUpsertAgent(agent);
        broadcastAgentUpdate(key);
    }
    state.recentEvents.unshift(result);
    if (state.recentEvents.length > 100)
        state.recentEvents.length = 100;
    dbRecordCycle(key, result);
}
//# sourceMappingURL=state.js.map