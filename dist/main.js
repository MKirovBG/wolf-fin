// Wolf-Fin — entry point
import 'dotenv/config';
import pino from 'pino';
import { initDb, dbGetAllAgents, dbGetTodayRealizedPnl } from './db/index.js';
import { upsertAgent } from './server/state.js';
import { hydrateRiskStateFromDb } from './guardrails/riskStateStore.js';
import { startServer } from './server/index.js';
const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
initDb();
// Restore today's realized P&L so the daily loss limit survives server restarts
const today = new Date().toISOString().slice(0, 10);
hydrateRiskStateFromDb('crypto', dbGetTodayRealizedPnl('crypto', today));
hydrateRiskStateFromDb('mt5', dbGetTodayRealizedPnl('mt5', today));
const savedAgents = dbGetAllAgents();
for (const agent of savedAgents) {
    // Reset runtime state: running → idle, clear startedAt
    upsertAgent({ ...agent, status: 'idle', startedAt: null });
}
if (savedAgents.length > 0) {
    log.info({ count: savedAgents.length }, 'Restored agents from database');
}
await startServer();
log.info('Wolf-Fin server started — configure and start agents from the dashboard.');
//# sourceMappingURL=main.js.map