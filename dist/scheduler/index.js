// Wolf-Fin Scheduler — per-agent continuous loop task management
//
// Fetch modes:
//   manual     — Start marks agent as running; each Trigger fires one single tick.
//   autonomous — Start begins a continuous loop: tick → await completion → tick → …
//   scheduled  — Same as autonomous; scheduled time defines the active window.
//                If scheduledStartUtc / scheduledEndUtc are set the loop sleeps
//                outside that window and resumes when it opens.
//
// The loop runs tick-to-tick with no fixed interval between ticks.
// Trigger always fires one immediate out-of-schedule tick regardless of mode.
import pino from 'pino';
import { runAgentTick } from '../agent/index.js';
import { setAgentStatus, getAgent } from '../server/state.js';
import { makeAgentKey } from '../db/index.js';
const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
// Map of agentKey → abort signal for the running loop
const tasks = new Map();
function agentKey(config) {
    return makeAgentKey(config.market, config.symbol, config.mt5AccountId, config.name);
}
// ── Scheduled time-window helpers ─────────────────────────────────────────────
/** Returns milliseconds until the scheduled window opens (0 if currently inside). */
function msUntilWindowOpen(startUtc, endUtc) {
    const [sh, sm] = startUtc.split(':').map(Number);
    const [eh, em] = endUtc.split(':').map(Number);
    const now = new Date();
    const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
    const startMin = (sh ?? 0) * 60 + (sm ?? 0);
    const endMin = (eh ?? 0) * 60 + (em ?? 0);
    // Window spans midnight (e.g. 22:00 → 06:00) when end ≤ start
    const spansMidnight = endMin <= startMin;
    const inWindow = spansMidnight
        ? (nowMin >= startMin || nowMin < endMin)
        : (nowMin >= startMin && nowMin < endMin);
    if (inWindow)
        return 0;
    // Minutes until next window open
    let minsUntil;
    if (spansMidnight) {
        minsUntil = nowMin < startMin ? startMin - nowMin : 24 * 60 - nowMin + startMin;
    }
    else {
        minsUntil = nowMin < startMin ? startMin - nowMin : 24 * 60 - nowMin + startMin;
    }
    return minsUntil * 60 * 1000;
}
/** Sleep in short chunks so signal.cancelled can stop the wait early. */
async function sleepCancellable(ms, signal) {
    const chunk = 30_000;
    let remaining = ms;
    while (remaining > 0 && !signal.cancelled) {
        await new Promise(resolve => setTimeout(resolve, Math.min(remaining, chunk)));
        remaining -= chunk;
    }
}
// ── Scheduler ─────────────────────────────────────────────────────────────────
export function startAgentSchedule(config) {
    const key = agentKey(config);
    // Cancel any existing loop first (idempotent restart)
    const existing = tasks.get(key);
    if (existing) {
        existing.cancelled = true;
        tasks.delete(key);
    }
    setAgentStatus(key, 'running');
    // Manual mode: just mark as running — each Trigger button press fires one tick
    if (config.fetchMode === 'manual') {
        log.info({ key }, 'agent registered in manual mode — awaiting Trigger');
        return;
    }
    const signal = { cancelled: false };
    tasks.set(key, signal);
    (async () => {
        log.info({ key, mode: config.fetchMode }, 'agent continuous loop started');
        while (!signal.cancelled) {
            // ── Scheduled window gate ────────────────────────────────────────────
            if (config.scheduledStartUtc && config.scheduledEndUtc) {
                const delayMs = msUntilWindowOpen(config.scheduledStartUtc, config.scheduledEndUtc);
                if (delayMs > 0) {
                    const mins = Math.round(delayMs / 60_000);
                    log.info({ key, delayMs }, `outside scheduled window — sleeping ${mins}m`);
                    await sleepCancellable(delayMs, signal);
                    continue;
                }
            }
            try {
                await runAgentTick(config);
            }
            catch (err) {
                log.error({ key, err }, 'agent cycle error');
            }
            // ── Guardrail auto-pause detection ───────────────────────────────────
            // If a guardrail (daily loss, drawdown) paused the agent from inside a tick,
            // honour it by stopping the loop — without needing a circular import.
            if (!signal.cancelled) {
                const state = getAgent(key);
                if (state?.status === 'paused') {
                    signal.cancelled = true;
                    tasks.delete(key);
                    log.info({ key }, 'loop stopped — agent was paused by a guardrail');
                }
            }
        }
        log.info({ key }, 'agent loop stopped');
    })();
}
export function pauseAgentSchedule(key) {
    const signal = tasks.get(key);
    if (signal) {
        signal.cancelled = true;
        tasks.delete(key);
    }
    setAgentStatus(key, 'paused');
    log.info({ key }, 'agent schedule paused');
}
export function stopAgentSchedule(key) {
    const signal = tasks.get(key);
    if (signal) {
        signal.cancelled = true;
        tasks.delete(key);
    }
    setAgentStatus(key, 'idle');
    log.info({ key }, 'agent schedule stopped');
}
export function resumeAgentSchedule(config) {
    startAgentSchedule(config);
}
export function stopAllSchedules() {
    for (const [key, signal] of tasks) {
        signal.cancelled = true;
        setAgentStatus(key, 'idle');
    }
    tasks.clear();
    log.info('all agent schedules stopped');
}
//# sourceMappingURL=index.js.map