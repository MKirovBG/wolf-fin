// Wolf-Fin — Prompt Template Editor with pill insertion

import { useRef } from 'react'
import type { GuardrailsConfig } from '../types/index.ts'

interface Props {
  value: string
  onChange: (v: string) => void
  market: 'crypto' | 'mt5'
}

interface Pill {
  key: string
  label: string
  icon: string
  mt5Only?: boolean
  description: string
}

const PILLS: Pill[] = [
  { key: 'market_rules',     label: 'Market Rules',    icon: '📋', mt5Only: true,  description: 'MT5 session and position management rules' },
  { key: 'strategy',         label: 'Strategy',        icon: '📊', description: 'Trading strategy from DB (entry/exit rules)' },
  { key: 'memory',           label: 'Memory',          icon: '🧠', description: 'Persistent memory entries for this agent' },
  { key: 'plan',             label: 'Plan',            icon: '📅', description: "Today's session plan and bias" },
  { key: 'session_history',  label: 'Session History', icon: '📜', description: 'Compressed summary of earlier ticks today' },
  { key: 'risk_rules',       label: 'Risk Rules',      icon: '⚠️', description: 'Base risk rules (1% NAV stops, no pyramiding)' },
  { key: 'output_format',    label: 'Output Format',   icon: '📤', description: 'DECISION/REASON output format instructions' },
  { key: 'leverage',         label: 'Leverage',        icon: '📡', description: 'Account leverage info (if configured)' },
]

export function PromptEditor({ value, onChange, market }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const insertPill = (key: string) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const token = `{{${key}}}`
    const newValue = value.slice(0, start) + token + value.slice(end)
    onChange(newValue)
    // Restore cursor after the inserted token
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const visiblePills = PILLS.filter(p => !p.mt5Only || market === 'mt5')

  return (
    <div className="space-y-3">
      {/* Pill buttons */}
      <div className="bg-surface2 border border-border rounded-lg p-3">
        <div className="text-xs font-medium text-muted uppercase tracking-wider mb-2">Available Data Pills</div>
        <div className="flex flex-wrap gap-1.5">
          {visiblePills.map(pill => (
            <button
              key={pill.key}
              type="button"
              title={pill.description}
              onClick={() => insertPill(pill.key)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-border text-muted bg-surface hover:border-green hover:text-green transition-colors font-mono"
            >
              <span>{pill.icon}</span>
              <span>{pill.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={`Write your system prompt here.\nUse {{pill}} tokens to insert dynamic content.\nExample:\n\nYou are Wolf-Fin, trading {{symbol}} on {{market}}.\n\n{{market_rules}}\n\n{{strategy}}\n\n{{output_format}}`}
        rows={12}
        className="w-full font-mono text-xs bg-bg border border-border rounded-lg p-3 text-text placeholder:text-muted resize-y focus:outline-none focus:border-green transition-colors"
        style={{ minHeight: 300 }}
        spellCheck={false}
      />

      <p className="text-xs text-muted leading-relaxed">
        Click a pill to insert it at cursor. Snapshot, positions, and account balance are automatically injected into each tick message — you don't need to include them in the template.
        {value && (
          <span className="ml-2 text-muted2">
            {value.length} chars
          </span>
        )}
      </p>
    </div>
  )
}

// Re-export GuardrailsConfig for convenience
export type { GuardrailsConfig }
