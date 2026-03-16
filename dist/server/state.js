// Wolf-Fin — shared in-memory state (with SQLite persistence)
import { dbUpsertAgent, dbRemoveAgent, dbUpdateAgentStatus, dbRecordCycle, dbLogEvent, dbGetLogs, dbGetMaxLogId, } from '../db/index.js';
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
// ── Log buffer ────────────────────────────────────────────────────────────────
// Initialized lazily on first use so it reads from DB after initDb() has run
let logSeq = -1;
function nextLogId() {
    if (logSeq === -1)
        logSeq = dbGetMaxLogId();
    return ++logSeq;
}
const logBuffer = [];
export function logEvent(agentKey, level, event, message, data) {
    const entry = { id: nextLogId(), time: new Date().toISOString(), agentKey, level, event, message, data };
    logBuffer.unshift(entry);
    if (logBuffer.length > 500)
        logBuffer.length = 500;
    dbLogEvent(entry);
}
export function getLogs(sinceId, agentKey) {
    // Serve from DB for full history; fall back to buffer for low-latency polling
    return dbGetLogs(sinceId, agentKey, 200);
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
    const key = `${agent.config.market}:${agent.config.symbol}`;
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
    }
}
export function recordCycle(key, result) {
    const agent = state.agents[key];
    if (agent) {
        agent.lastCycle = result;
        agent.cycleCount++;
        dbUpsertAgent(agent);
    }
    state.recentEvents.unshift(result);
    if (state.recentEvents.length > 100)
        state.recentEvents.length = 100;
    dbRecordCycle(key, result);
}
//# sourceMappingURL=state.js.map