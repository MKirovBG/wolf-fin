// Wolf-Fin — Guardrails configuration editor

import type { GuardrailsConfig } from '../types/index.ts'

interface Props {
  value?: Partial<GuardrailsConfig>
  onChange: (v: Partial<GuardrailsConfig>) => void
  market: 'crypto' | 'mt5'
}

interface GuardrailItem {
  key: keyof GuardrailsConfig
  label: string
  description: string
  mt5Only?: boolean
}

const GUARDRAILS: GuardrailItem[] = [
  {
    key: 'sessionOpenCheck',
    label: 'Session Open Check',
    description: 'Only trade during market hours. Block orders when session is closed.',
  },
  {
    key: 'extremeSpreadCheck',
    label: 'Extreme Spread Check',
    description: 'Block orders with abnormally wide spread ($500+/lot — likely a data issue or market closed).',
  },
  {
    key: 'stopPipsRequired',
    label: 'Stop Pips Required',
    description: 'Require SL distance on every MT5 order (stopPips field).',
    mt5Only: true,
  },
]

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${
        checked ? 'bg-green' : 'bg-border'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

export function GuardrailsEditor({ value = {}, onChange, market }: Props) {
  // Defaults: all on
  const defaults: GuardrailsConfig = {
    sessionOpenCheck: true,
    extremeSpreadCheck: true,
    stopPipsRequired: true,
  }

  const current: GuardrailsConfig = { ...defaults, ...value }

  const toggle = (key: keyof GuardrailsConfig, on: boolean) => {
    onChange({ ...value, [key]: on })
  }

  const visibleGuardrails = GUARDRAILS.filter(g => !g.mt5Only || market === 'mt5')

  return (
    <div className="space-y-3">
      {visibleGuardrails.map(g => (
        <div key={g.key} className="flex items-start justify-between gap-4 py-2.5 border-b border-border last:border-0">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-text font-medium">{g.label}</div>
            <div className="text-xs text-muted mt-0.5 leading-relaxed">{g.description}</div>
          </div>
          <div className="shrink-0 pt-0.5">
            <Toggle
              checked={current[g.key]}
              onChange={v => toggle(g.key, v)}
            />
          </div>
        </div>
      ))}
      {visibleGuardrails.length === 0 && (
        <p className="text-xs text-muted py-2">No guardrails available for this market type.</p>
      )}
    </div>
  )
}
