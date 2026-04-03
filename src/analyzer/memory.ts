/**
 * Wolf-Fin — Automatic Memory Pipeline
 *
 * Layer 1: Per-analysis extraction (no LLM call) — runs after each analysis
 * Layer 2: Daily digest (one LLM call) — summarizes the day's analyses
 * Layer 3: Cleanup — purges expired memories
 */

import pino from 'pino'
import {
  dbSaveMemory,
  dbPurgeExpiredMemories,
  dbGetAnalysesSince,
  dbCountActiveMemories,
} from '../db/index.js'
import { getPlatformLLMProvider, getPlatformLLMModel } from '../llm/index.js'
import type { AnalysisResult } from '../types.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })

// ── Layer 1: Per-Analysis Auto-Extract ───────────────────────────────────────

const MAX_MEMORIES_PER_SYMBOL = 20

function expiresIn(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

/**
 * Extracts 1-2 key observations from a completed analysis and saves them
 * as short-lived memories. No LLM call — purely deterministic extraction.
 */
export function extractAndSaveMemories(result: AnalysisResult): void {
  try {
    // Skip error results or empty analyses
    if (result.error || !result.summary) return

    // Cap per-symbol active memories to avoid flooding
    const activeCount = dbCountActiveMemories(result.symbol)
    if (activeCount >= MAX_MEMORIES_PER_SYMBOL) return

    const confidence = result.tradeProposal?.confidence === 'high' ? 0.8
      : result.tradeProposal?.confidence === 'medium' ? 0.6
      : result.tradeProposal?.confidence === 'low' ? 0.4
      : 0.5

    // Memory 1: Market context observation (expires 48h)
    const contextParts = [
      `[${result.bias.toUpperCase()}]`,
      result.summary.length > 200 ? result.summary.slice(0, 200) + '…' : result.summary,
    ]
    dbSaveMemory({
      symbol: result.symbol,
      category: 'market_context',
      content: contextParts.join(' '),
      confidence,
      sourceAnalysisId: result.id,
      expiresAt: expiresIn(48),
    })

    // Memory 2: Trade setup observation (expires 72h, only if proposal exists)
    if (result.tradeProposal?.direction) {
      const tp = result.tradeProposal
      const chainNote = result.reasoningChain?.[0]
        ? ` | ${result.reasoningChain[0].step}: ${result.reasoningChain[0].detail.slice(0, 120)}`
        : ''
      const setupContent = `Setup: ${tp.direction} ${result.symbol} (${tp.confidence} confidence, R:R ${tp.riskReward.toFixed(1)})${chainNote}`

      dbSaveMemory({
        symbol: result.symbol,
        category: 'pattern',
        content: setupContent,
        confidence,
        sourceAnalysisId: result.id,
        expiresAt: expiresIn(72),
      })
    }

    log.debug({ symbol: result.symbol, analysisId: result.id }, 'auto-extracted memories from analysis')
  } catch (err) {
    log.warn({ err: String(err), symbol: result.symbol }, 'failed to extract memories from analysis')
  }
}

// ── Layer 2: Daily Digest ────────────────────────────────────────────────────

/**
 * Collects all analyses from today, sends a single LLM call to summarize
 * the day's session, and saves per-symbol + global daily memories.
 * Also purges expired memories (Layer 3).
 */
export async function runDailyDigest(): Promise<{ purged: number; memories: number; symbols: string[] }> {
  // Layer 3: cleanup expired memories first
  const purged = dbPurgeExpiredMemories()
  if (purged > 0) log.info({ purged }, 'purged expired memories')

  // Get today's analyses (from midnight UTC)
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const analyses = dbGetAnalysesSince(todayStart.toISOString())

  if (analyses.length === 0) {
    log.info('daily digest: no analyses today, skipping')
    return { purged, memories: 0, symbols: [] }
  }

  // Group by symbol
  const bySymbol = new Map<string, AnalysisResult[]>()
  for (const a of analyses) {
    const list = bySymbol.get(a.symbol) ?? []
    list.push(a)
    bySymbol.set(a.symbol, list)
  }

  // Build a compact summary for the LLM
  const symbolSummaries: string[] = []
  for (const [symbol, runs] of bySymbol) {
    const biases = { bullish: 0, bearish: 0, neutral: 0 }
    const trades: string[] = []
    for (const r of runs) {
      biases[r.bias]++
      if (r.tradeProposal?.direction) {
        trades.push(`${r.tradeProposal.direction} (${r.tradeProposal.confidence}, R:R ${r.tradeProposal.riskReward.toFixed(1)})`)
      }
    }
    const biasStr = Object.entries(biases).filter(([, v]) => v > 0).map(([k, v]) => `${v}x ${k}`).join(', ')
    symbolSummaries.push(
      `${symbol}: ${runs.length} analyses — Bias: ${biasStr}` +
      (trades.length ? ` — Setups: ${trades.join('; ')}` : ' — No setups') +
      ` — Last summary: "${runs[runs.length - 1].summary.slice(0, 150)}"`
    )
  }

  const symbols = Array.from(bySymbol.keys())

  // LLM call for digest
  try {
    const provider = getPlatformLLMProvider()
    const model = getPlatformLLMModel()

    const systemPrompt = `You are a trading session summarizer. Given today's analysis data, produce a concise daily digest. Respond with valid JSON only.`

    const userPrompt = `Summarize today's trading session. Here are all ${analyses.length} analyses performed across ${symbols.length} symbol(s):

${symbolSummaries.join('\n')}

Respond with this exact JSON format:
{
  "perSymbol": {
    "SYMBOL": "1-2 sentence summary of today's activity for this symbol"
  },
  "global": "2-3 sentence overall market overview for today"
}`

    const response = await provider.createMessage({
      model,
      max_tokens: 768,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const text = response.content.find(c => c.type === 'text')
    const rawText = text && 'text' in text ? text.text : ''

    // Extract JSON
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      log.warn('daily digest: no JSON in LLM response')
      return { purged, memories: 0, symbols }
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      perSymbol?: Record<string, string>
      global?: string
    }

    let memoriesCreated = 0

    // Save per-symbol daily memories (expire in 7 days)
    if (parsed.perSymbol) {
      for (const [symbol, summary] of Object.entries(parsed.perSymbol)) {
        if (!summary) continue
        const date = new Date().toISOString().slice(0, 10)
        dbSaveMemory({
          symbol,
          category: 'market_context',
          content: `[Daily ${date}] ${summary}`,
          confidence: 0.7,
          expiresAt: expiresIn(7 * 24), // 7 days
        })
        memoriesCreated++
      }
    }

    // Save global daily memory (expire in 14 days)
    if (parsed.global) {
      const date = new Date().toISOString().slice(0, 10)
      dbSaveMemory({
        category: 'market_context',
        content: `[Daily Overview ${date}] ${parsed.global}`,
        confidence: 0.7,
        expiresAt: expiresIn(14 * 24), // 14 days
      })
      memoriesCreated++
    }

    log.info({ memoriesCreated, symbols, analysesProcessed: analyses.length }, 'daily digest completed')
    return { purged, memories: memoriesCreated, symbols }
  } catch (err) {
    log.error({ err: String(err) }, 'daily digest LLM call failed')
    return { purged, memories: 0, symbols }
  }
}
