// Wolf-Fin Scheduler — per-agent interval task management
// Uses setInterval so any granularity is supported (2s → 4h).
// If a cycle is still running when the next tick fires, the tick is
// skipped — the cycle-lock in runAgentCycle handles this automatically.
//
// Fetch modes:
//   manual     — Start marks agent as running; each Trigger fires one tick.
//   autonomous — Start begins setInterval; ticks fire on cadence (session-gated for MT5).
//   scheduled  — Start begins setInterval; ticks fire on cadence (no session gate).
//
// Trigger always fires one immediate tick regardless of mode.
import pino from 'pino';
import { runAgentTick } from '../agent/index.js';
import { isForexSessionOpen } from '../adapters/session.js';
import { setAgentStatus } from '../server/state.js';
import { logEvent } from '../server/state.js';
import { makeAgentKey } from '../db/index.js';
const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
// Map of agentKey → active interval handle
const tasks = new Map();
function agentKey(config) {
    return makeAgentKey(config.market, config.symbol, config.mt5AccountId, config.name);
}
/** Backwards-compat: old DB records stored scheduleIntervalMinutes (number in minutes).
 *  New records store scheduleIntervalSeconds. */
function resolveIntervalMs(config) {
    const cfg = config;
    if (cfg.scheduleIntervalSeconds != null)
        return cfg.scheduleIntervalSeconds * 1000;
    if (cfg.scheduleIntervalMinutes != null)
        return cfg.scheduleIntervalMinutes * 60 * 1000;
    return 60_000; // fallback: 1 minute
}
export function startAgentSchedule(config) {
    const key = agentKey(config);
    // Stop any existing task first (idempotent)
    const existing = tasks.get(key);
    if (existing) {
        clearInterval(existing);
        tasks.delete(key);
    }
    setAgentStatus(key, 'running');
    // Manual mode: just mark as running — each Trigger button press fires one tick
    if (config.fetchMode === 'manual') {
        log.info({ key }, 'agent registered in manual mode — awaiting Trigger');
        return;
    }
    const intervalMs = resolveIntervalMs(config);
    const runTick = async () => {
        // Autonomous mode: skip if MT5 market is closed, but log it visibly
        if (config.fetchMode === 'autonomous' && config.market === 'mt5' && !isForexSessionOpen()) {
            log.debug({ key }, 'autonomous — market closed, skipping');
            logEvent(key, 'info', 'tick_skip', 'Market session closed — tick skipped (waiting for Tokyo / London / New York)');
            return;
        }
        try {
            await runAgentTick(config);
        }
        catch (err) {
            log.error({ key, err }, 'agent cycle error');
        }
    };
    // Begin interval — first tick fires after the first interval elapses.
    // Use the Trigger button for an immediate out-of-schedule tick.
    const handle = setInterval(runTick, intervalMs);
    tasks.set(key, handle);
    log.info({ key, intervalMs, mode: config.fetchMode }, 'agent schedule started');
}
export function pauseAgentSchedule(key) {
    const handle = tasks.get(key);
    if (handle) {
        clearInterval(handle);
        tasks.delete(key);
    }
    setAgentStatus(key, 'paused');
    log.info({ key }, 'agent schedule paused');
}
export function stopAgentSchedule(key) {
    const handle = tasks.get(key);
    if (handle) {
        clearInterval(handle);
        tasks.delete(key);
    }
    setAgentStatus(key, 'idle');
    log.info({ key }, 'agent schedule stopped');
}
export function resumeAgentSchedule(config) {
    startAgentSchedule(config);
}
export function stopAllSchedules() {
    for (const [key, handle] of tasks) {
        clearInterval(handle);
        setAgentStatus(key, 'idle');
    }
    tasks.clear();
    log.info('all agent schedules stopped');
}
//# sourceMappingURL=index.js.map