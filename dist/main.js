// Wolf-Fin — entry point
import 'dotenv/config';
import pino from 'pino';
import { initDb, dbGetAllSymbols, dbPruneLogs, dbCheckIntegrity, dbGetMigrationStatus } from './db/index.js';
import { startServer } from './server/index.js';
import { syncSchedule } from './scheduler/index.js';
import { startOutcomePoller } from './outcomes/poller.js';
const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
// ── Process-level error handlers ──────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
    log.error({ reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
    log.error({ err }, 'Uncaught exception — shutting down');
    process.exit(1);
});
// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown(signal) {
    log.info({ signal }, 'Shutting down gracefully');
    // better-sqlite3 closes DB on process exit; give in-flight requests 1 s
    setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
// ── Startup ───────────────────────────────────────────────────────────────────
initDb();
// Log applied migrations on startup
const migrations = dbGetMigrationStatus();
log.info({ count: migrations.length, latest: migrations.at(-1)?.name ?? 'none' }, 'DB migrations applied');
// Prune old log entries (keep last 10 000)
const pruned = dbPruneLogs(10_000);
if (pruned > 0)
    log.info({ pruned }, 'Pruned old log entries');
// Integrity check
const integrity = dbCheckIntegrity();
if (integrity[0] !== 'ok') {
    log.warn({ integrity }, 'DB integrity check returned issues');
}
else {
    log.debug('DB integrity check passed');
}
// Restore active schedules for all watch symbols
const symbols = dbGetAllSymbols();
let scheduledCount = 0;
for (const sym of symbols) {
    if (sym.scheduleEnabled && sym.scheduleIntervalMs) {
        syncSchedule(sym);
        scheduledCount++;
    }
}
if (symbols.length > 0) {
    log.info({ total: symbols.length, scheduled: scheduledCount }, 'Restored symbols from database');
}
await startServer();
startOutcomePoller();
log.info('Wolf-Fin started — add symbols to your watchlist from the dashboard.');
//# sourceMappingURL=main.js.map