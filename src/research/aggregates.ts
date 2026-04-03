// Wolf-Fin — Research aggregates and leaderboard (Phase 5)

import type { SetupCandidate } from '../types/setup.js'

export interface PerformanceSlice {
  key: string
  trades: number
  wins: number
  losses: number
  winRate: number
  avgScore: number
  avgRR: number
}

/** Aggregate setup candidate outcomes by a grouping key. */
export function aggregateByKey(
  candidates: Array<SetupCandidate & { outcome?: string; rMultiple?: number }>,
  getKey: (c: SetupCandidate) => string,
): PerformanceSlice[] {
  const map: Record<string, { trades: number; wins: number; losses: number; scores: number[]; rMultiples: number[] }> = {}

  for (const c of candidates) {
    const key = getKey(c)
    if (!map[key]) map[key] = { trades: 0, wins: 0, losses: 0, scores: [], rMultiples: [] }
    const g = map[key]
    g.trades++
    g.scores.push(c.score)
    if (c.outcome === 'won_tp1' || c.outcome === 'won_tp2') {
      g.wins++
      if (c.rMultiple != null) g.rMultiples.push(c.rMultiple)
    } else if (c.outcome === 'lost_sl') {
      g.losses++
      if (c.rMultiple != null) g.rMultiples.push(c.rMultiple)
    }
  }

  return Object.entries(map).map(([key, g]) => ({
    key,
    trades:   g.trades,
    wins:     g.wins,
    losses:   g.losses,
    winRate:  g.trades > 0 ? +(g.wins / g.trades * 100).toFixed(1) : 0,
    avgScore: g.scores.length > 0 ? +(g.scores.reduce((a, b) => a + b, 0) / g.scores.length).toFixed(1) : 0,
    avgRR:    g.rMultiples.length > 0
      ? +(g.rMultiples.reduce((a, b) => a + b, 0) / g.rMultiples.length).toFixed(2)
      : 0,
  })).sort((a, b) => b.winRate - a.winRate || b.trades - a.trades)
}

export function leaderboardByDetector(candidates: Array<SetupCandidate & { outcome?: string; rMultiple?: number }>): PerformanceSlice[] {
  return aggregateByKey(candidates, c => c.detector)
}

export function leaderboardBySession(candidates: Array<SetupCandidate & { outcome?: string; rMultiple?: number }>): PerformanceSlice[] {
  return aggregateByKey(candidates, c => {
    return c.tags.find(t => ['London', 'NY', 'London-NY', 'Tokyo'].some(s => t.includes(s))) ?? 'other'
  })
}

export function leaderboardByRegime(candidates: Array<SetupCandidate & { outcome?: string; rMultiple?: number }>): PerformanceSlice[] {
  return aggregateByKey(candidates, c => {
    return c.tags.find(t => ['trend', 'range', 'breakout', 'reversal', 'compressed', 'volatile'].includes(t)) ?? 'unknown'
  })
}
