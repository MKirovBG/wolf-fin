// Wolf-Fin — shared in-memory state
import { dbLogEvent, dbGetLogs, dbGetMaxLogId } from '../db/index.js';
// ── Log buffer ────────────────────────────────────────────────────────────────
// Lazy-init from DB max ID to prevent duplicate IDs on restart
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
const analysisSubscribers = new Set();
export function subscribeToAnalyses(cb) {
    analysisSubscribers.add(cb);
    return () => analysisSubscribers.delete(cb);
}
export function broadcastAnalysisUpdate(symbolKey, analysisId) {
    const event = { type: 'analysis_update', symbolKey, analysisId };
    for (const sub of analysisSubscribers) {
        try {
            sub(event);
        }
        catch { /* ignore */ }
    }
}
// ── Log events ────────────────────────────────────────────────────────────────
export function logEvent(symbolKey, level, event, message, data) {
    const entry = {
        id: nextLogId(),
        time: new Date().toISOString(),
        symbolKey,
        level,
        event,
        message,
        data,
    };
    logBuffer.unshift(entry);
    if (logBuffer.length > 500)
        logBuffer.length = 500;
    dbLogEvent(entry);
    for (const sub of logSubscribers) {
        try {
            sub(entry);
        }
        catch { /* ignore */ }
    }
}
export function getLogs(sinceId, symbolKey, limit = 200) {
    return dbGetLogs(sinceId, symbolKey, limit);
}
//# sourceMappingURL=state.js.map