// Wolf-Fin Backtest — Snapshot recorder
// Hooks into adapter getSnapshot and dumps each result to a JSONL file.
import { appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const RECORDING_DIR = join(__dirname, '../../data/recordings');
export function createRecordingAdapter(inner, symbol) {
    mkdirSync(RECORDING_DIR, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const file = join(RECORDING_DIR, `${symbol}_${date}.jsonl`);
    return new Proxy(inner, {
        get(target, prop, receiver) {
            if (prop === 'getSnapshot') {
                return async (sym, risk) => {
                    const snap = await target.getSnapshot(sym, risk);
                    try {
                        appendFileSync(file, JSON.stringify(snap) + '\n');
                    }
                    catch (err) {
                        console.warn('[recorder] Failed to write snapshot:', err);
                    }
                    return snap;
                };
            }
            return Reflect.get(target, prop, receiver);
        },
    });
}
//# sourceMappingURL=recorder.js.map