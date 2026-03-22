#!/usr/bin/env node
// Wolf-Fin Backtest CLI
// Usage: pnpm backtest --recording <file> --strategy <name>
import { runBacktest } from './runner.js';
import { STRATEGIES } from './strategies.js';
const args = process.argv.slice(2);
function getArg(name) {
    const idx = args.indexOf(`--${name}`);
    return idx >= 0 ? args[idx + 1] : undefined;
}
const recording = getArg('recording');
const strategyName = getArg('strategy') ?? 'mc-follow';
if (!recording) {
    console.log(`Wolf-Fin Backtest Runner

Usage:
  pnpm backtest --recording <path> --strategy <name>

Options:
  --recording  Path to JSONL recording file (required)
  --strategy   Strategy name: ${Object.keys(STRATEGIES).join(', ')} (default: mc-follow)

Example:
  pnpm backtest --recording data/recordings/XAUUSD_2026-03-22.jsonl --strategy mc-follow
`);
    process.exit(0);
}
const strategy = STRATEGIES[strategyName];
if (!strategy) {
    console.error(`Unknown strategy: "${strategyName}". Available: ${Object.keys(STRATEGIES).join(', ')}`);
    process.exit(1);
}
console.log(`\nWolf-Fin Backtest`);
console.log(`Recording: ${recording}`);
console.log(`Strategy:  ${strategyName}`);
console.log(`${'─'.repeat(50)}`);
try {
    const result = runBacktest(recording, strategy);
    console.log(`\nResults:`);
    console.log(`  Ticks:        ${result.totalTicks}`);
    console.log(`  Trades:       ${result.trades.length}`);
    console.log(`  Wins:         ${result.wins}`);
    console.log(`  Losses:       ${result.losses}`);
    console.log(`  Win Rate:     ${result.winRate.toFixed(1)}%`);
    console.log(`  Total P&L:    $${result.totalPnl.toFixed(2)}`);
    console.log(`  Avg P&L:      $${result.avgPnl.toFixed(2)}`);
    console.log(`  Sharpe:       ${result.sharpe.toFixed(3)}`);
    console.log(`  Max Drawdown: $${result.maxDrawdown.toFixed(2)}`);
    if (result.trades.length > 0) {
        console.log(`\nTrade Log:`);
        for (const t of result.trades) {
            const dir = t.action === 'BUY' ? 'LONG' : 'SHORT';
            const pnlStr = t.pnl >= 0 ? `+$${t.pnl.toFixed(2)}` : `-$${Math.abs(t.pnl).toFixed(2)}`;
            console.log(`  [tick ${t.tick}→${t.exitTick}] ${dir} ${t.lots}L @ ${t.entry.toFixed(2)} → ${t.exitPrice.toFixed(2)} ${t.outcome} ${pnlStr} | ${t.reason}`);
        }
    }
}
catch (err) {
    console.error(`Backtest failed:`, err);
    process.exit(1);
}
//# sourceMappingURL=cli.js.map