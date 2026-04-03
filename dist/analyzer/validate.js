// Wolf-Fin — Proposal validation
// Scores a trade proposal against computed key levels, indicators, and structure.
// Returns a 0–100 score, a list of explanatory flags, and a boolean validity verdict.
// ── Helpers ───────────────────────────────────────────────────────────────────
function distanceTo(price, level) {
    return Math.abs(price - level.price);
}
function nearestLevel(price, levels) {
    if (levels.length === 0)
        return null;
    return levels.reduce((best, l) => distanceTo(price, l) < distanceTo(price, best) ? l : best);
}
// ── Validator ─────────────────────────────────────────────────────────────────
export function validateProposal(input) {
    const { proposal, keyLevels, atr, bias, mtfScore } = input;
    if (!proposal.direction) {
        return { score: 0, flags: ['No trade direction — nothing to validate'], valid: false };
    }
    let score = 0;
    const flags = [];
    const entryMid = (proposal.entryZone.low + proposal.entryZone.high) / 2;
    const isBuy = proposal.direction === 'BUY';
    // ── 1. Entry zone near a key level (+25 pts) ──────────────────────────────
    const nearest = nearestLevel(entryMid, keyLevels);
    if (nearest && atr > 0) {
        const dist = distanceTo(entryMid, nearest);
        if (dist <= atr * 0.5) {
            score += 25;
            flags.push(`Entry zone near ${nearest.label} (${nearest.type}) — structural confluence`);
        }
        else if (dist <= atr) {
            score += 12;
            flags.push(`Entry zone within 1× ATR of ${nearest.label}`);
        }
        else {
            flags.push(`Entry zone is ${(dist / atr).toFixed(1)}× ATR from nearest key level — weak structure`);
        }
    }
    // ── 2. Entry zone width <= 1× ATR (+10 pts) ──────────────────────────────
    const entryWidth = proposal.entryZone.high - proposal.entryZone.low;
    if (atr > 0 && entryWidth <= atr) {
        score += 10;
        flags.push('Tight entry zone (≤ 1× ATR)');
    }
    else if (atr > 0) {
        flags.push(`Wide entry zone (${(entryWidth / atr).toFixed(1)}× ATR) — reduces precision`);
    }
    // ── 3. SL placed beyond a key level (+20 pts) ─────────────────────────────
    const slLevels = keyLevels.filter(l => isBuy ? l.price < entryMid : l.price > entryMid);
    if (slLevels.length > 0 && atr > 0) {
        const nearSL = nearestLevel(proposal.stopLoss, slLevels);
        if (nearSL) {
            const slDist = distanceTo(proposal.stopLoss, nearSL);
            // SL should be just beyond the level (within 0.5× ATR of it)
            if (slDist <= atr * 0.5) {
                score += 20;
                flags.push(`SL anchored beyond ${nearSL.label} — valid structural invalidation`);
            }
            else if (slDist <= atr) {
                score += 10;
                flags.push(`SL near ${nearSL.label} (within 1× ATR)`);
            }
            else {
                flags.push('SL not anchored to a key level — arbitrary placement');
            }
        }
    }
    else {
        flags.push('No key level found on SL side to validate placement');
    }
    // ── 4. TP1 near a key level (+15 pts) ────────────────────────────────────
    if (proposal.takeProfits.length > 0 && atr > 0) {
        const tp1 = proposal.takeProfits[0];
        const tpLevels = keyLevels.filter(l => isBuy ? l.price > entryMid : l.price < entryMid);
        const nearTP = nearestLevel(tp1, tpLevels);
        if (nearTP) {
            const tpDist = distanceTo(tp1, nearTP);
            if (tpDist <= atr) {
                score += 15;
                flags.push(`TP1 near ${nearTP.label} — logical target`);
            }
            else {
                flags.push('TP1 not aligned with a key level');
            }
        }
    }
    // ── 5. R:R >= 1.5 (+15 pts), >= 2.5 (+5 bonus) ───────────────────────────
    if (proposal.riskReward >= 2.5) {
        score += 20;
        flags.push(`Strong R:R ${proposal.riskReward.toFixed(2)} (≥ 2.5)`);
    }
    else if (proposal.riskReward >= 1.5) {
        score += 15;
        flags.push(`Acceptable R:R ${proposal.riskReward.toFixed(2)} (≥ 1.5)`);
    }
    else {
        flags.push(`Low R:R ${proposal.riskReward.toFixed(2)} (< 1.5) — unfavorable risk`);
    }
    // ── 6. Bias + direction alignment (+10 pts) ───────────────────────────────
    const biasAligned = (isBuy && bias === 'bullish') ||
        (!isBuy && bias === 'bearish');
    if (biasAligned) {
        score += 10;
        flags.push('Trade direction aligns with overall bias');
    }
    else if (bias !== 'neutral') {
        score -= 10;
        flags.push('Trade direction CONTRADICTS the overall bias — counter-trend risk');
    }
    // ── 7. MTF confluence alignment (+5 pts) ─────────────────────────────────
    if (mtfScore != null) {
        const mtfAligned = (isBuy && mtfScore > 0) || (!isBuy && mtfScore < 0);
        if (mtfAligned) {
            score += 5;
            flags.push(`MTF confluence supports direction (score: ${mtfScore > 0 ? '+' : ''}${mtfScore})`);
        }
        else if (mtfScore !== 0) {
            flags.push(`MTF confluence opposes direction (score: ${mtfScore > 0 ? '+' : ''}${mtfScore})`);
        }
    }
    // ── 8. Confidence penalty ─────────────────────────────────────────────────
    if (proposal.confidence === 'low') {
        score -= 10;
        flags.push('Low confidence — LLM flagged uncertainty');
    }
    // Clamp to 0–100
    score = Math.max(0, Math.min(100, score));
    return {
        score,
        flags,
        valid: score >= 50,
    };
}
//# sourceMappingURL=validate.js.map