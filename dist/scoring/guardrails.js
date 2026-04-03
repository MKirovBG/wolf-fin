// Wolf-Fin — Hard disqualifiers (Phase 2)
// Returns disqualifier strings. Any non-empty result means the setup is invalid
// regardless of numeric score.
export function checkHardDisqualifiers(candidate, features, marketState) {
    const fails = [];
    // Already has disqualifiers from detector
    if (candidate.disqualifiers.length > 0) {
        return candidate.disqualifiers;
    }
    // Spread too wide
    if (features.execution.spreadStatus === 'abnormal') {
        fails.push('Abnormal spread — execution risk unacceptable');
    }
    // High-impact news imminent (< 10 min)
    if (features.context.nextHighImpactMinutes !== null &&
        features.context.nextHighImpactMinutes >= 0 &&
        features.context.nextHighImpactMinutes < 10) {
        fails.push(`High-impact news in ${features.context.nextHighImpactMinutes} minutes — news lockout`);
    }
    // Avoid-level risk
    if (marketState.contextRisk === 'avoid') {
        fails.push('Context risk: avoid — do not trade');
    }
    // Invalid stop geometry: stop distance < 0.3 ATR (too tight) or > 3 ATR (too wide)
    if (candidate.entryZone && candidate.stopLoss !== null) {
        const entryMid = (candidate.entryZone.low + candidate.entryZone.high) / 2;
        const stopDist = Math.abs(entryMid - candidate.stopLoss);
        const atr = features.volatility.atrAbsolute;
        if (atr > 0) {
            if (stopDist < atr * 0.25)
                fails.push(`Stop too tight: ${(stopDist / atr).toFixed(2)} ATR (minimum 0.25)`);
            if (stopDist > atr * 3.5)
                fails.push(`Stop too wide: ${(stopDist / atr).toFixed(2)} ATR (maximum 3.5)`);
        }
    }
    // No valid direction
    if (!candidate.direction)
        fails.push('No trade direction — candidate incomplete');
    // Minimum R:R below 1:1
    if (candidate.riskReward > 0 && candidate.riskReward < 1.0) {
        fails.push(`R:R ${candidate.riskReward.toFixed(2)} below minimum 1:1`);
    }
    return fails;
}
//# sourceMappingURL=guardrails.js.map