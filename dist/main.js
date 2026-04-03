// Wolf-Fin — entry point
import 'dotenv/config';
import pino from 'pino';
import { initDb, dbGetAllSymbols } from './db/index.js';
import { startServer } from './server/index.js';
import { syncSchedule } from './scheduler/index.js';
const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
initDb();
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
log.info('Wolf-Fin started — add symbols to your watchlist from the dashboard.');
//# sourceMappingURL=main.js.map