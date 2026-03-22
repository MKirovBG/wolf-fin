// Wolf-Fin — Prompt Template Editor

import { useState } from 'react'
import type { GuardrailsConfig } from '../types/index.ts'

interface Props {
  value: string
  onChange: (v: string) => void
  market: 'crypto' | 'mt5'
}

interface Component {
  key: string
  label: string
  icon: string
  mt5Only?: boolean
  optional?: boolean
  description: string
  detail: string
}

const COMPONENTS: Component[] = [
  {
    key: 'memory',
    label: 'Memory',
    icon: '🧠',
    description: 'Persistent agent memory',
    detail: 'Recalled observations from past sessions — patterns the agent has noticed, mistakes to avoid, and learned behaviours accumulated over time. Gives the agent continuity across restarts and multi-day runs.',
  },
  {
    key: 'session_history',
    label: 'Session History',
    icon: '📜',
    description: 'Earlier ticks this session',
    detail: 'A compressed summary of what happened earlier in the current session — decisions made, rationale, outcomes, and the current open position context. Prevents the agent repeating itself or ignoring recent action.',
  },
  {
    key: 'risk_rules',
    label: 'Risk Rules',
    icon: '⚠️',
    description: 'Capital protection rules',
    detail: 'Non-negotiable trading rules injected every tick:\n• Position sizing — the agent must use the exact lot size computed from your daily target, equity, leverage, and ATR stop distance. Orders above 2× the suggested size are rejected.\n• Stop loss — must be placed at a structural level (swing high/low, support/resistance). Arbitrary pip distances are not allowed. If no clean structural level exists within acceptable risk, the agent must skip the trade.\n• Take profit — must be at the next structural level with at least 1.5:1 reward-to-risk. Trades with R:R below 1.5 are skipped.\n• Breakeven — once a position moves 1× ATR in profit, the stop is moved to entry price.\n• Trailing — stop is trailed behind structural levels as price extends; not so tight that normal retracements cause premature exits.\n• Adding to winners — allowed only in the same direction with RSI confirmation, total lots capped at 2× the suggested size.\n• No stop widening — losers are closed at the stop, never given more room.',
  },
  {
    key: 'output_format',
    label: 'Output Format',
    icon: '📤',
    description: 'Structured response format',
    detail: 'Instructions that enforce the agent\'s DECISION / REASON output structure. Without this, responses may be unparseable. Always required unless your custom template defines its own output format explicitly.',
  },
  {
    key: 'leverage',
    label: 'Leverage',
    icon: '📡',
    description: 'Account leverage context',
    detail: 'Injects the configured account leverage ratio so the agent can calculate correct lot sizes, margin requirements, and pip values. Critical for accurate position sizing on leveraged accounts.',
  },
  {
    key: 'market_rules',
    label: 'Market Rules',
    icon: '📋',
    mt5Only: true,
    description: 'MT5 session & position rules',
    detail: 'MT5-specific trading guidelines: session open/close awareness, spread thresholds, position management constraints, and swap considerations. Prevents the agent from placing orders outside valid market hours or with abnormal costs.',
  },
  {
    key: 'strategy',
    label: 'Strategy',
    icon: '📊',
    optional: true,
    description: 'Your agent\'s trading rulebook',
    detail: 'A persistent structured document you define in the Strategy tab — entry and exit rules, directional bias, filters, and max positions. Injected every tick so the agent follows your specific edge rather than improvising. Enable once you\'ve defined a strategy.',
  },
  {
    key: 'plan',
    label: 'Session Plan',
    icon: '📅',
    optional: true,
    description: 'Today\'s session bias & key levels',
    detail: 'A tactical plan generated at session start by the agent\'s planning cycle: market bias, key support/resistance levels, and session-specific notes. Helps the agent trade with directional conviction rather than reacting tick-by-tick without context.',
  },
]

function buildTemplate(market: 'crypto' | 'mt5', includeStrategy: boolean, includePlan: boolean): string {
  const tokens = COMPONENTS
    .filter(c => !c.optional)
    .filter(c => !c.mt5Only || market === 'mt5')
    .map(c => `{{${c.key}}}`)
  if (includeStrategy) tokens.push('{{strategy}}')
  if (includePlan) tokens.push('{{plan}}')
  return tokens.join('\n\n')
}

// Toggle switch sub-component
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-green' : 'bg-border'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
    </button>
  )
}

export function PromptEditor({ value, onChange, market }: Props) {
  const [includeStrategy, setIncludeStrategy] = useState(false)
  const [includePlan, setIncludePlan] = useState(false)
  const [advanced, setAdvanced] = useState(!!value)

  const visible = COMPONENTS.filter(c => !c.mt5Only || market === 'mt5')
  const defaults = visible.filter(c => !c.optional)
  const optionals = visible.filter(c => c.optional)

  const handleToggle = (key: string, enabled: boolean) => {
    const newStrategy = key === 'strategy' ? enabled : includeStrategy
    const newPlan = key === 'plan' ? enabled : includePlan
    if (key === 'strategy') setIncludeStrategy(enabled)
    if (key === 'plan') setIncludePlan(enabled)
    if (!advanced) {
      const hasAny = newStrategy || newPlan
      onChange(hasAny ? buildTemplate(market, newStrategy, newPlan) : '')
    }
  }

  return (
    <div className="space-y-4">

      {/* Default components */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">Always Included</div>
        <div className="grid grid-cols-1 gap-2">
          {defaults.map(c => (
            <div key={c.key} className="flex items-start gap-3 bg-surface2 border border-border/60 rounded-lg px-3 py-2.5">
              <span className="text-base mt-0.5 shrink-0">{c.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-semibold text-primary">{c.label}</span>
                  <span className="ml-auto text-[10px] font-semibold text-green uppercase tracking-wider">Default</span>
                </div>
                <div className="text-xs text-muted2 leading-relaxed space-y-0.5">
                  {c.detail.split('\n').map((line, i) => <p key={i}>{line}</p>)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Optional components */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">Optional</div>
        <div className="grid grid-cols-1 gap-2">
          {optionals.map(c => {
            const enabled = c.key === 'strategy' ? includeStrategy : includePlan
            return (
              <div key={c.key} className={`flex items-start gap-3 border rounded-lg px-3 py-2.5 transition-colors ${enabled ? 'bg-surface2 border-green/30' : 'bg-surface2 border-border/60 opacity-70'}`}>
                <span className="text-base mt-0.5 shrink-0">{c.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold text-primary">{c.label}</span>
                    <div className="ml-auto flex items-center gap-2">
                      <span className={`text-[10px] font-semibold uppercase tracking-wider ${enabled ? 'text-green' : 'text-muted'}`}>{enabled ? 'On' : 'Off'}</span>
                      <Toggle checked={enabled} onChange={v => handleToggle(c.key, v)} />
                    </div>
                  </div>
                  <p className="text-xs text-muted2 leading-relaxed">{c.detail}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Advanced / custom template */}
      <div className="border-t border-border/50 pt-3">
        <button
          type="button"
          onClick={() => setAdvanced(v => !v)}
          className="text-xs text-muted hover:text-text transition-colors flex items-center gap-1.5"
        >
          <span>{advanced ? '▾' : '▸'}</span>
          Custom template override
          {value && !advanced && <span className="text-muted2 ml-1">· {value.length} chars</span>}
        </button>
        {advanced && (
          <div className="mt-2 space-y-1.5">
            <p className="text-xs text-muted2 leading-relaxed">
              Write a full prompt template using <span className="font-mono text-muted">{'{{token}}'}</span> tokens. Leave empty to use the default Wolf-Fin prompt with the component toggles above.
            </p>
            <textarea
              value={value}
              onChange={e => onChange(e.target.value)}
              placeholder={`You are Wolf-Fin, trading {{symbol}} on {{market}}.\n\n{{memory}}\n{{session_history}}\n{{risk_rules}}\n{{strategy}}\n{{output_format}}`}
              rows={10}
              className="w-full font-mono text-xs bg-bg border border-border rounded-lg p-3 text-text placeholder:text-muted resize-y focus:outline-none focus:border-green transition-colors"
              spellCheck={false}
            />
            {value && <p className="text-[10px] text-muted">{value.length} chars</p>}
          </div>
        )}
      </div>

    </div>
  )
}

// Re-export GuardrailsConfig for convenience
export type { GuardrailsConfig }
