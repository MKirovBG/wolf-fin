import { useEffect, useState, useRef } from 'react'
import { getSystemPrompt, updateAgentConfig } from '../api/client.ts'

interface Props {
  agentKey: string
  promptTemplate?: string   // full override if set
  customPrompt: string      // additional instructions only
  onSaved: () => void       // called after a save so parent can reload config
}

type State = 'loading' | 'locked' | 'editing'

export function SystemPromptEditor({ agentKey, promptTemplate, customPrompt, onSaved }: Props) {
  const [state, setState]           = useState<State>('loading')
  const [compiledPrompt, setCompiled] = useState('')   // full compiled prompt from server
  const [editText, setEditText]     = useState('')     // what's in the textarea
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [isOverride, setIsOverride] = useState(false)  // true when promptTemplate is in use
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Load the compiled full prompt from the server
  useEffect(() => {
    if (!agentKey) return
    setState(s => s === 'editing' ? s : 'loading')
    getSystemPrompt(agentKey)
      .then(res => {
        setCompiled(res.prompt)
        setIsOverride(!!(promptTemplate && promptTemplate.trim().length > 0))
        setState(s => s === 'editing' ? s : 'locked')
      })
      .catch(() => {
        setError('Could not load system prompt.')
        setState(s => s === 'editing' ? s : 'locked')
      })
  }, [agentKey, promptTemplate])

  const startEditing = () => {
    // Populate textarea with the current compiled prompt for full editing
    setEditText(compiledPrompt)
    setState('editing')
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await updateAgentConfig(agentKey, { promptTemplate: editText.trim() || undefined })
      onSaved()
      setState('locked')
    } catch {
      setError('Failed to save — please try again.')
    } finally {
      setSaving(false)
    }
  }

  const resetToDefault = async () => {
    if (!confirm('Reset to the default Wolf-Fin system prompt?\n\nYour custom prompt override will be deleted.')) return
    setSaving(true)
    try {
      await updateAgentConfig(agentKey, { promptTemplate: '' })
      onSaved()
      setState('loading') // will reload
    } catch {
      setError('Failed to reset.')
    } finally {
      setSaving(false)
    }
  }

  const cancel = () => {
    setState('locked')
  }

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text">System Prompt</h3>
          <p className="text-xs text-muted mt-0.5">
            {isOverride
              ? <span className="text-yellow">Custom override active — default prompt is replaced</span>
              : 'Default Wolf-Fin prompt · click Edit to customise'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {state === 'locked' && (
            <>
              {isOverride && (
                <button
                  type="button"
                  onClick={resetToDefault}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs border border-red/30 text-red rounded-lg hover:bg-red/10 disabled:opacity-40 transition-colors"
                >
                  Reset to default
                </button>
              )}
              <button
                type="button"
                onClick={startEditing}
                className="px-3 py-1.5 text-xs border border-border text-muted rounded-lg hover:border-yellow hover:text-yellow transition-colors"
              >
                Edit Prompt
              </button>
            </>
          )}

          {state === 'editing' && (
            <>
              <button
                type="button"
                onClick={cancel}
                disabled={saving}
                className="px-3 py-1.5 text-xs border border-border text-muted rounded-lg hover:border-muted2 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="px-3 py-1.5 text-xs border border-green/50 text-green bg-green-dim rounded-lg hover:bg-green/10 disabled:opacity-40 transition-colors font-medium"
              >
                {saving ? 'Saving…' : 'Save Prompt'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-xs text-red bg-red-dim border border-red/30 rounded-lg px-3 py-2">{error}</div>
      )}

      {/* Loading */}
      {state === 'loading' && (
        <div className="bg-surface2 border border-border rounded-lg p-4 text-sm text-muted">
          Loading system prompt…
        </div>
      )}

      {/* Locked — read-only view */}
      {state === 'locked' && compiledPrompt && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-surface2 border-b border-border">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">
              {isOverride ? 'Custom Prompt (override)' : 'Compiled Prompt (read-only)'}
            </span>
            <span className="text-xs text-muted2">{compiledPrompt.length.toLocaleString()} chars</span>
          </div>
          <pre className="bg-bg text-muted text-xs font-mono leading-relaxed p-4 overflow-auto max-h-72 whitespace-pre-wrap break-words">
            {compiledPrompt}
          </pre>
        </div>
      )}

      {/* Editing — full textarea */}
      {state === 'editing' && (
        <div className="border border-yellow/40 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-yellow-dim border-b border-yellow/30">
            <span className="text-xs font-semibold text-yellow uppercase tracking-wider">Editing Full Prompt</span>
            <span className="text-xs text-yellow/70">
              This will override the default prompt entirely · use {'{{'} symbol {'}}'},  {'{{'} strategy {'}}'}  etc. for dynamic values
            </span>
          </div>
          <textarea
            ref={textareaRef}
            value={editText}
            onChange={e => setEditText(e.target.value)}
            rows={28}
            className="font-mono text-xs rounded-none border-0 w-full"
            style={{ borderRadius: 0 }}
            spellCheck={false}
          />
        </div>
      )}

      {/* Additional instructions note */}
      {state === 'locked' && !isOverride && customPrompt && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-surface2 border-b border-border">
            <span className="text-xs font-semibold text-yellow uppercase tracking-wider">Additional Instructions</span>
          </div>
          <pre className="bg-bg text-xs font-mono leading-relaxed p-4 whitespace-pre-wrap break-words text-muted min-h-[60px]">
            {customPrompt}
          </pre>
        </div>
      )}
    </div>
  )
}
