import { useState } from 'react'
import type { SetupCandidate, SetupTier } from '../types/index.ts'

const TIER_META: Record<SetupTier, { label: string; color: string; bg: string; border: string }> = {
  valid:       { label: 'Valid',       color: 'text-green',    bg: 'bg-green/10',    border: 'border-green/30' },
  watchlist:   { label: 'Watchlist',   color: 'text-yellow',   bg: 'bg-yellow-dim',  border: 'border-yellow/30' },
  low_quality: { label: 'Low Quality', color: 'text-muted',    bg: 'bg-surface2',    border: 'border-border' },
  rejected:    { label: 'Rejected',    color: 'text-muted2',   bg: 'bg-bg',          border: 'border-border/50' },
}

const DETECTOR_LABELS: Record<string, string> = {
  trendPullback:    'Trend Pullback',
  breakoutRetest:   'Breakout Retest',
  liquiditySweep:   'Liquidity Sweep',
  openingRange:     'Opening Range',
  rangeFade:        'Range Fade',
  sessionReversal:  'Session Reversal',
}

function scoreColor(score: number) {
  if (score >= 65) return 'bg-green'
  if (score >= 45) return 'bg-yellow'
  return 'bg-red'
}
function scoreText(score: number) {
  if (score >= 65) return 'text-green'
  if (score >= 45) return 'text-yellow'
  return 'text-red'
}

function CandidateCard({ candidate, hero = false }: { candidate: SetupCandidate; hero?: boolean }) {
  const [showBreakdown, setShowBreakdown] = useState(false)
  const tier = TIER_META[candidate.tier] ?? TIER_META.rejected
  const dirColor = candidate.direction === 'BUY' ? 'text-green' : candidate.direction === 'SELL' ? 'text-red' : 'text-muted'
  const breakdown = candidate.scoreBreakdown

  return (
    <div className={`border rounded-lg overflow-hidden ${hero ? `${tier.border} ${tier.bg}` : 'border-border bg-surface'}`}>
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text">
            {DETECTOR_LABELS[candidate.detector] ?? candidate.detector}
          </span>
          {candidate.found && candidate.direction && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
              candidate.direction === 'BUY'
                ? 'text-green border-green/30 bg-green/10'
                : 'text-red border-red/30 bg-red/10'
            }`}>{candidate.direction}</span>
          )}
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${tier.color} ${tier.bg} ${tier.border}`}>
            {tier.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 bg-bg rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${scoreColor(candidate.score)}`} style={{ width: `${candidate.score}%` }} />
          </div>
          <span className={`text-xs font-bold font-mono ${scoreText(candidate.score)}`}>{candidate.score}</span>
        </div>
      </div>

      {/* Entry/SL/TP grid — only if found */}
      {candidate.found && candidate.entryZone && (
        <div className="px-4 pb-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
            <div className="bg-bg/40 rounded p-2">
              <div className="text-[10px] text-muted uppercase tracking-wider mb-1">Entry Zone</div>
              <div className="font-mono text-[11px] text-text leading-snug">
                {candidate.entryZone.low.toFixed(5)}<br />
                {candidate.entryZone.high.toFixed(5)}
              </div>
            </div>
            {candidate.stopLoss != null && (
              <div className="bg-bg/40 rounded p-2">
                <div className="text-[10px] text-muted uppercase tracking-wider mb-1">Stop Loss</div>
                <div className="font-mono text-[11px] text-red">{candidate.stopLoss.toFixed(5)}</div>
              </div>
            )}
            {candidate.targets.map((tp, i) => (
              <div key={i} className="bg-bg/40 rounded p-2">
                <div className="text-[10px] text-muted uppercase tracking-wider mb-1">TP{i + 1}</div>
                <div className="font-mono text-[11px] text-green">{tp.toFixed(5)}</div>
              </div>
            ))}
          </div>
          {candidate.riskReward > 0 && (
            <div className="text-[11px] text-muted">
              R:R <span className="font-mono font-semibold text-text">{candidate.riskReward.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      {/* Tags */}
      {candidate.tags.length > 0 && (
        <div className="px-4 pb-2 flex flex-wrap gap-1">
          {candidate.tags.map((tag, i) => (
            <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-surface2 border border-border text-muted2 font-mono">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Reasons */}
      {candidate.reasons.length > 0 && (
        <div className="px-4 pb-2 space-y-0.5">
          {candidate.reasons.map((r, i) => (
            <div key={i} className="text-[11px] text-text/60 flex items-start gap-1.5">
              <span className="text-green/50 flex-shrink-0 mt-0.5">+</span>{r}
            </div>
          ))}
        </div>
      )}

      {/* Disqualifiers */}
      {candidate.disqualifiers.length > 0 && (
        <div className="px-4 pb-2 space-y-0.5">
          {candidate.disqualifiers.map((d, i) => (
            <div key={i} className="text-[11px] text-red/70 flex items-start gap-1.5">
              <span className="text-red/50 flex-shrink-0 mt-0.5">✕</span>{d}
            </div>
          ))}
        </div>
      )}

      {/* Score breakdown toggle */}
      {candidate.found && breakdown && (
        <div className="border-t border-border/40">
          <button
            onClick={() => setShowBreakdown(s => !s)}
            className="w-full flex items-center justify-between px-4 py-2 text-[10px] text-muted hover:text-text hover:bg-surface2 transition-colors"
          >
            <span className="uppercase tracking-wider font-semibold">Score Breakdown</span>
            <span>{showBreakdown ? '▲' : '▼'}</span>
          </button>
          {showBreakdown && (
            <div className="px-4 pb-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-2">
                {[
                  ['Trend Align',    breakdown.trendAlignment],
                  ['Structure',      breakdown.structureQuality],
                  ['Volatility Fit', breakdown.volatilityFit],
                  ['Session',        breakdown.sessionQuality],
                  ['Risk:Reward',    breakdown.riskReward],
                  ['Entry Precision',breakdown.entryPrecision],
                  ['Confirmations',  breakdown.confirmations],
                  ['Context',        breakdown.contextClarity],
                  ['Pattern',        breakdown.patternQuality],
                ].map(([label, val]) => (
                  <div key={label as string} className="flex items-center justify-between text-[10px]">
                    <span className="text-muted">{label as string}</span>
                    <span className="font-mono text-text">{(val as number).toFixed(0)}</span>
                  </div>
                ))}
              </div>
              {(breakdown.spreadPenalty !== 0 || breakdown.newsPenalty !== 0 || breakdown.contextRiskPenalty !== 0) && (
                <div className="border-t border-border/40 pt-2 space-y-0.5">
                  {breakdown.spreadPenalty !== 0 && (
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-red/70">Spread penalty</span>
                      <span className="font-mono text-red">{breakdown.spreadPenalty.toFixed(0)}</span>
                    </div>
                  )}
                  {breakdown.newsPenalty !== 0 && (
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-red/70">News penalty</span>
                      <span className="font-mono text-red">{breakdown.newsPenalty.toFixed(0)}</span>
                    </div>
                  )}
                  {breakdown.contextRiskPenalty !== 0 && (
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-red/70">Context risk penalty</span>
                      <span className="font-mono text-red">{breakdown.contextRiskPenalty.toFixed(0)}</span>
                    </div>
                  )}
                </div>
              )}
              <div className="border-t border-border/40 pt-2 flex items-center justify-between text-[11px] font-semibold">
                <span className="text-muted uppercase tracking-wider">Total</span>
                <span className={`font-mono ${scoreText(breakdown.total)}`}>{breakdown.total.toFixed(0)} / 100</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function SetupCandidatesPanel({ candidates }: { candidates: SetupCandidate[] }) {
  const [showAll, setShowAll] = useState(false)

  const found  = candidates.filter(c => c.found).sort((a, b) => b.score - a.score)
  const missed = candidates.filter(c => !c.found)

  const topCandidate = found[0] ?? null
  const rest = found.slice(1)

  if (candidates.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-lg p-6 text-center text-sm text-muted">
        No setup candidates — run an analysis to generate detector results
      </div>
    )
  }

  return (
    <div className="space-y-3">

      {/* Top candidate — hero card */}
      {topCandidate ? (
        <CandidateCard candidate={topCandidate} hero />
      ) : (
        <div className="bg-surface border border-border rounded-lg p-4 text-center text-sm text-muted">
          No setups found in the latest analysis
        </div>
      )}

      {/* Secondary found candidates */}
      {rest.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted px-1">
            Other Setups ({rest.length})
          </div>
          {rest.map((c, i) => (
            <CandidateCard key={i} candidate={c} />
          ))}
        </div>
      )}

      {/* Missed detectors toggle */}
      {missed.length > 0 && (
        <div>
          <button
            onClick={() => setShowAll(s => !s)}
            className="w-full text-[10px] text-muted hover:text-text px-1 py-1.5 flex items-center gap-1 transition-colors"
          >
            <span>{showAll ? '▲' : '▼'}</span>
            <span>{showAll ? 'Hide' : 'Show'} {missed.length} inactive detector{missed.length !== 1 ? 's' : ''}</span>
          </button>
          {showAll && (
            <div className="space-y-1.5 mt-1">
              {missed.map((c, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 bg-surface border border-border/60 rounded-lg">
                  <span className="text-xs text-muted">{DETECTOR_LABELS[c.detector] ?? c.detector}</span>
                  <span className="text-[10px] text-muted2 font-mono">no setup</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
