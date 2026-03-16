// Wolf-Fin Scheduler — per-agent cron task management
import cron from 'node-cron';
import pino from 'pino';
import { runAgentCycle } from '../agent/index.js';
import { isForexSessionOpen } from '../adapters/session.js';
import { setAgentStatus } from '../server/state.js';
const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
// Map of "market:symbol" → active cron task
const tasks = new Map();
function agentKey(config) {
    return `${config.market}:${config.symbol}`;
}
function toSchedule(minutes) {
    if (minutes < 60)
        return `*/${minutes} * * * *`;
    const hours = Math.floor(minutes / 60);
    return `0 */${hours} * * *`;
}
export function startAgentSchedule(config) {
    const key = agentKey(config);
    // Stop any existing task first (idempotent)
    const existing = tasks.get(key);
    if (existing) {
        existing.stop();
        tasks.delete(key);
    }
    // In manual mode just mark running — user triggers cycles via button
    if (config.fetchMode === 'manual') {
        setAgentStatus(key, 'running');
        log.info({ key }, 'agent registered in manual mode');
        return;
    }
    const schedule = toSchedule(config.scheduleIntervalMinutes);
    const task = cron.schedule(schedule, async () => {
        // Autonomous mode: skip if forex market is closed
        if (config.fetchMode === 'autonomous' && config.market === 'forex' && !isForexSessionOpen()) {
            log.debug({ key }, 'autonomous — forex market closed, skipping');
            return;
        }
        try {
            await runAgentCycle(config);
        }
        catch (err) {
            log.error({ key, err }, 'agent cycle error');
        }
    });
    tasks.set(key, task);
    setAgentStatus(key, 'running');
    log.info({ key, schedule, mode: config.fetchMode }, 'agent schedule started');
}
export function pauseAgentSchedule(key) {
    const task = tasks.get(key);
    if (task) {
        task.stop();
        tasks.delete(key);
    }
    setAgentStatus(key, 'paused');
    log.info({ key }, 'agent schedule paused');
}
export function stopAgentSchedule(key) {
    const task = tasks.get(key);
    if (task) {
        task.stop();
        tasks.delete(key);
    }
    setAgentStatus(key, 'idle');
    log.info({ key }, 'agent schedule stopped');
}
export function resumeAgentSchedule(config) {
    startAgentSchedule(config);
}
export function stopAllSchedules() {
    for (const [key, task] of tasks) {
        task.stop();
        setAgentStatus(key, 'idle');
    }
    tasks.clear();
    log.info('all agent schedules stopped');
}
//# sourceMappingURL=index.js.map