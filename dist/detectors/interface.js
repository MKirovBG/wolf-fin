// Wolf-Fin — Detector contract (Phase 2)
// ── Geometry helpers ──────────────────────────────────────────────────────────
export function emptyCandidate(symbolKey, detector, setupType, reasons = [], disqualifiers = []) {
    return {
        symbolKey,
        capturedAt: new Date().toISOString(),
        detector,
        found: false,
        setupType,
        direction: null,
        entryZone: null,
        stopLoss: null,
        targets: [],
        riskReward: 0,
        invalidationRule: null,
        score: 0,
        tier: 'rejected',
        scoreBreakdown: zeroBreakdown(),
        reasons,
        disqualifiers,
        tags: [],
    };
}
export function zeroBreakdown() {
    return {
        trendAlignment: 0, structureQuality: 0, entryPrecision: 0,
        stopQuality: 0, targetQuality: 0, sessionTiming: 0,
        volatilitySuitability: 0, executionQuality: 0, strategyFit: 0,
        contextPenalty: 0, overextensionPenalty: 0, counterTrendPenalty: 0,
        totalPositive: 0, totalPenalty: 0, finalScore: 0, reasons: [],
    };
}
export function computeRR(entry, stop, target) {
    const stopDist = Math.abs(entry - stop);
    const targetDist = Math.abs(target - entry);
    return stopDist > 0 ? +(targetDist / stopDist).toFixed(2) : 0;
}
//# sourceMappingURL=interface.js.map