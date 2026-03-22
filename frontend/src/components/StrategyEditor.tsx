// Wolf-Fin StrategyEditor — view and edit the agent's trading strategy document

import { useState, useEffect, useCallback } from 'react'
import { getAgentStrategy, saveAgentStrategy, deleteAgentStrategy } from '../api/client.ts'
import type { StrategyDoc } from '../types/index.ts'

const STYLES = ['scalping', 'swing', 'trend', 'mean_reversion', 'custom'] as const
const STYLE_META: Record<string, { label: string; hint: string }> = {
  scalping:       { label: 'Scalping',        hint: 'Very short-term — seconds to minutes. High frequency, tight stops, small targets. Requires fast intervals (5–30s) and liquid markets.' },
  swing:          { label: 'Swing',           hint: 'Hours to days. Captures multi-session moves. Larger stops, higher R:R targets. Works well on H1–H4 with 15–60 min intervals.' },
  trend:          { label: 'Trend Following', hint: 'Rides established momentum in one direction. Trades only with the H4/D1 trend. Fewer signals but higher win rate on strong trending pairs.' },
  mean_reversion: { label: 'Mean Reversion',  hint: 'Fades overextended moves back to the mean (VWAP, EMA). Works in ranging markets — avoid during strong trends. Requires RSI extremes as confirmation.' },
  custom:         { label: 'Custom',          hint: 'Fully custom approach. Describe your complete logic in the entry and exit rules sections.' },
}

const EMPTY: Omit<StrategyDoc, 'agentKey' | 'createdAt' | 'updatedAt'> = {
  name: '', style: 'trend', bias: '', timeframe: '',
  entryRules: '', exitRules: '', filters: '', maxPositions: 1, notes: '',
}

// ── Primitives ────────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold uppercase tracking-wider text-muted block">{label}</label>
      {hint && <p className="text-xs text-muted2 leading-relaxed">{hint}</p>}
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-surface2 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</span>
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </div>
  )
}

const TA = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    {...props}
    rows={props.rows ?? 4}
    className={`w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm text-primary resize-y focus:outline-none focus:border-green ${props.className ?? ''}`}
  />
)

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className={`w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm text-primary focus:outline-none focus:border-green ${props.className ?? ''}`}
  />
)

// ── Main component ────────────────────────────────────────────────────────────

export function StrategyEditor({ agentKey, disabled }: { agentKey: string; disabled?: boolean }) {
  const [strategy, setStrategy] = useState<Omit<StrategyDoc, 'agentKey' | 'createdAt' | 'updatedAt'>>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [exists, setExists] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const doc = await getAgentStrategy(agentKey)
      setStrategy({
        name: doc.name, style: doc.style ?? 'trend', bias: doc.bias ?? '',
        timeframe: doc.timeframe ?? '', entryRules: doc.entryRules,
        exitRules: doc.exitRules, filters: doc.filters ?? '',
        maxPositions: doc.maxPositions, notes: doc.notes ?? '',
      })
      setExists(true)
    } catch {
      setExists(false); setStrategy(EMPTY)
    } finally { setLoading(false) }
  }, [agentKey])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    if (!strategy.name.trim()) { setError('Strategy name is required'); return }
    if (!strategy.entryRules.trim()) { setError('Entry rules are required'); return }
    if (!strategy.exitRules.trim()) { setError('Exit rules are required'); return }
    setSaving(true); setError(null)
    try {
      await saveAgentStrategy(agentKey, strategy)
      setExists(true); setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!confirm('Remove the strategy for this agent? The agent will fall back to its system prompt instructions.')) return
    setDeleting(true)
    try {
      await deleteAgentStrategy(agentKey)
      setExists(false); setStrategy(EMPTY)
    } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed') }
    finally { setDeleting(false) }
  }

  const set = <K extends keyof typeof strategy>(k: K, v: typeof strategy[K]) =>
    setStrategy(s => ({ ...s, [k]: v }))

  if (loading) return <div className="text-sm text-muted py-8 text-center">Loading strategy…</div>

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-primary">Trading Strategy</h3>
          <p className="text-xs text-muted mt-1 leading-relaxed max-w-lg">
            When saved, the strategy is automatically included in every tick — no custom prompt or pill setup needed.
            {!exists && ' No strategy defined yet.'}
          </p>
        </div>
        {exists && !disabled && (
          <button onClick={handleDelete} disabled={deleting}
            className="text-xs text-red hover:underline disabled:opacity-50 shrink-0">
            {deleting ? 'Removing…' : 'Remove'}
          </button>
        )}
      </div>

      {error && <div className="text-xs text-red bg-red/10 border border-red/20 rounded-lg px-3 py-2">{error}</div>}

      {disabled && (
        <div className="text-xs text-yellow border border-yellow/30 bg-yellow-dim rounded-lg px-3 py-2.5">
          Stop or pause the agent before editing the strategy.
        </div>
      )}

      {/* ── Identity ── */}
      <Section title="Identity">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Strategy name" hint="Used in logs and memory summaries to identify which ruleset was active. E.g. 'XAUUSD London Breakout' or 'BTC Trend Rider H1'.">
            <Input value={strategy.name} onChange={e => set('name', e.target.value)}
              placeholder="e.g. XAUUSD London Breakout" disabled={disabled} />
          </Field>
          <Field label="Style" hint={STYLE_META[strategy.style]?.hint ?? ''}>
            <select value={strategy.style} onChange={e => set('style', e.target.value as typeof strategy.style)}
              disabled={disabled}
              className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm text-primary focus:outline-none focus:border-green">
              {STYLES.map(s => <option key={s} value={s}>{STYLE_META[s].label}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Directional bias" hint="Tells the agent whether to prefer long, short, or stay neutral. Can be conditional on structure, e.g. 'long-only above EMA50 on H4'.">
            <Input value={strategy.bias ?? ''} onChange={e => set('bias', e.target.value)}
              placeholder="e.g. long-only above EMA50" disabled={disabled} />
          </Field>
          <Field label="Primary timeframe" hint="Anchors analysis to a specific chart — match this to the candles your entry rules reference, e.g. H1, M15, H4.">
            <Input value={strategy.timeframe ?? ''} onChange={e => set('timeframe', e.target.value)}
              placeholder="e.g. H1 / M15 / H4" disabled={disabled} />
          </Field>
          <Field label="Max positions" hint="Caps open trade exposure. Use 1 for most strategies; 2–3 only for partial position management.">
            <Input type="number" min={1} max={10} value={strategy.maxPositions}
              onChange={e => set('maxPositions', parseInt(e.target.value) || 1)}
              disabled={disabled} />
          </Field>
        </div>
      </Section>

      {/* ── Rules ── */}
      <Section title="Rules">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Entry rules" hint="All conditions that must be true before opening a trade. List one per line with '-'. Reference specific indicator values, timeframes, and price levels — the more specific, the better.">
            <TA rows={8} value={strategy.entryRules} onChange={e => set('entryRules', e.target.value)}
              placeholder={'- EMA20 above EMA50 on H1 (trend confirmed)\n- Price pulls back within 10 pips of EMA20\n- RSI between 40–60 (not overextended)\n- ATR > 15 pips (enough volatility to reach TP)\n- Enter BUY on next M5 close above pullback high'}
              disabled={disabled} />
          </Field>
          <Field label="Exit rules" hint="When to take profit, cut losses, or close early. Specify TP in ATR multiples or pips, SL placement, trailing logic, and any time-based or indicator-based early exits.">
            <TA rows={8} value={strategy.exitRules} onChange={e => set('exitRules', e.target.value)}
              placeholder={'- Take profit: 1.5× ATR above entry (min 25 pips)\n- Stop loss: 1× ATR below entry (hard stop)\n- Trail stop to breakeven once 1× ATR in profit\n- Close early if RSI > 70 on H1 (overextended)\n- Close all positions at 17:00 UTC'}
              disabled={disabled} />
          </Field>
        </div>
        <Field label="Filters — do not trade if…" hint="Conditions that veto an otherwise valid setup. Include news events, low volatility, wide spreads, and time windows where your strategy underperforms.">
          <TA rows={4} value={strategy.filters ?? ''} onChange={e => set('filters', e.target.value)}
            placeholder={'- Skip if high-impact news in next 30 minutes\n- Skip if spread > 3 pips (illiquid)\n- Skip if ATR < 10 pips (consolidation — no momentum)\n- No new entries after 16:00 UTC\n- Skip if daily drawdown already > 1%'}
            disabled={disabled} />
        </Field>
      </Section>

      {/* ── Notes ── */}
      <Section title="Notes">
        <Field label="Agent notes" hint="Free-form context — edge cases, session-specific behaviour, known weaknesses, back-test observations. Write as if briefing a trader taking over.">
          <TA rows={4} value={strategy.notes ?? ''} onChange={e => set('notes', e.target.value)}
            placeholder={'e.g.\n- Best performance during London open (07:00–10:00 UTC)\n- XAUUSD spikes 20–40 pips on US data releases — use filters\n- Avoid Monday Asia session — thin liquidity causes false signals'}
            disabled={disabled} />
        </Field>
      </Section>

      {!disabled && (
        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 bg-green-dim border border-green text-green text-sm rounded-lg hover:bg-green/20 disabled:opacity-50 transition-colors font-medium">
            {saving ? 'Saving…' : exists ? 'Update strategy' : 'Save strategy'}
          </button>
          {saved && <span className="text-xs text-green">Saved</span>}
        </div>
      )}
    </div>
  )
}
