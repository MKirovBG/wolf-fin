import { useEffect, useState } from 'react'
import { getSystemPrompt } from '../api/client.ts'

interface Props {
  agentKey: string
  customPrompt: string
  onChange: (v: string) => void
}

type State = 'new-agent' | 'loading' | 'loaded-locked' | 'editing'

export function SystemPromptEditor({ agentKey, customPrompt, onChange }: Props) {
  const [state, setState] = useState<State>(!agentKey ? 'new-agent' : 'loading')
  const [fullPrompt, setFullPrompt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedBase, setExpandedBase] = useState(false)

  useEffect(() => {
    if (!agentKey) { setState('new-agent'); return }
    // Don't reset to loading if already editing — preserve editing state across re-renders
    setState(s => s === 'editing' ? s : 'loading')
    setError(null)
    getSystemPrompt(agentKey)
      .then(res => {
        setFullPrompt(res.prompt)
        setState(s => s === 'editing' ? s : 'loaded-locked')
      })
      .catch(() => {
        setError('Could not load system prompt — agent may not be saved yet.')
        setState(s => s === 'editing' ? s : 'loaded-locked')
      })
  }, [agentKey])

  // Split full prompt into base part and custom part
  const basePrompt = fullPrompt
    ? (fullPrompt.includes('ADDITIONAL INSTRUCTIONS')
        ? fullPrompt.split('ADDITIONAL INSTRUCTIONS')[0].trim()
        : fullPrompt)
    : null

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text">System Prompt</h3>
          <p className="text-xs text-muted mt-0.5">The full prompt sent to the LLM each cycle</p>
        </div>
        {state === 'loaded-locked' && (
          <button
            type="button"
            onClick={() => setState('editing')}
            className="px-3 py-1.5 text-xs border border-border text-muted rounded-lg hover:border-yellow hover:text-yellow transition-colors"
          >
            Edit Custom Instructions
          </button>
        )}
        {state === 'editing' && (
          <button
            type="button"
            onClick={() => setState('loaded-locked')}
            className="px-3 py-1.5 text-xs border border-green/40 text-green rounded-lg hover:border-green transition-colors"
          >
            ✓ Done
          </button>
        )}
      </div>

      {/* New agent message */}
      {state === 'new-agent' && (
        <div className="bg-surface2 border border-border rounded-lg p-4">
          <p className="text-sm text-muted">Save the agent first to preview the full system prompt.</p>
          <div className="mt-3">
            <label className="text-xs font-medium text-muted uppercase tracking-wider block mb-2">
              Custom Instructions (optional)
            </label>
            <textarea
              value={customPrompt}
              onChange={e => onChange(e.target.value)}
              placeholder="Additional instructions appended to the system prompt..."
              rows={4}
              className="font-mono text-xs"
            />
          </div>
        </div>
      )}

      {/* Loading */}
      {state === 'loading' && (
        <div className="bg-surface2 border border-border rounded-lg p-4 text-sm text-muted">
          Loading system prompt...
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-xs text-yellow bg-yellow-dim border border-yellow/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Loaded — locked or editing */}
      {(state === 'loaded-locked' || state === 'editing') && (
        <div className="space-y-3">

          {/* Base prompt section */}
          {basePrompt && (
            <div className="border border-border rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedBase(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 bg-surface2 hover:bg-surface3 transition-colors text-left"
              >
                <span className="text-xs font-semibold text-muted uppercase tracking-wider">Base Prompt</span>
                <span className="text-muted text-xs">{expandedBase ? '▲ collapse' : '▼ expand'}</span>
              </button>
              {expandedBase && (
                <pre className="bg-bg text-muted text-xs font-mono leading-relaxed p-4 overflow-auto max-h-80 whitespace-pre-wrap break-words">
                  {basePrompt}
                </pre>
              )}
            </div>
          )}

          {/* Editing notice */}
          {state === 'editing' && (
            <div className="bg-yellow-dim border border-yellow/30 rounded-lg px-3 py-2">
              <p className="text-xs text-yellow/80">
                ⚠ Editing mode — changes are auto-saved as you type. Click Done when finished.
              </p>
            </div>
          )}

          {/* Custom instructions section */}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2.5 bg-surface2 border-b border-border">
              <span className="text-xs font-semibold text-yellow uppercase tracking-wider">Additional Instructions</span>
              {state === 'loaded-locked' && (
                <span className="text-xs text-muted2">Read-only — click Edit to modify</span>
              )}
            </div>
            {state === 'editing' ? (
              <textarea
                value={customPrompt}
                onChange={e => onChange(e.target.value)}
                placeholder="Additional instructions appended to the base prompt..."
                rows={6}
                className="font-mono text-xs rounded-none border-0"
                style={{ borderRadius: 0 }}
                autoFocus
              />
            ) : (
              <pre className="bg-bg text-xs font-mono leading-relaxed p-4 whitespace-pre-wrap break-words text-muted min-h-[80px]">
                {customPrompt || <span className="italic text-muted2">No custom instructions</span>}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
