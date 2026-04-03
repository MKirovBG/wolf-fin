import { useEffect, useState, useCallback } from 'react'
import { getAgentRules, createAgentRule, updateAgentRule, deleteAgentRule } from '../api/client.ts'
import type { AgentRule } from '../types/index.ts'
import { useToast } from '../components/Toast.tsx'

export function AgentRules() {
  const [rules, setRules]       = useState<AgentRule[]>([])
  const [loading, setLoading]   = useState(true)
  const [showNew, setShowNew]   = useState(false)
  const [newText, setNewText]   = useState('')
  const [newScope, setNewScope] = useState<'global' | 'symbol'>('global')
  const [newScopeVal, setNewScopeVal] = useState('')
  const [editingId, setEditingId]     = useState<number | null>(null)
  const [editText, setEditText]       = useState('')
  const toast = useToast()

  const load = useCallback(async () => {
    try {
      setRules(await getAgentRules())
    } catch (e) {
      toast.error(String(e))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!newText.trim()) return
    try {
      await createAgentRule({ ruleText: newText.trim(), scope: newScope, scopeValue: newScope === 'symbol' ? newScopeVal.trim() || undefined : undefined })
      toast.success('Rule created')
      setShowNew(false)
      setNewText('')
      setNewScopeVal('')
      await load()
    } catch (e) {
      toast.error(String(e))
    }
  }

  const handleToggle = async (id: number, enabled: boolean) => {
    try {
      await updateAgentRule(id, { enabled })
      setRules(prev => prev.map(r => r.id === id ? { ...r, enabled } : r))
    } catch (e) {
      toast.error(String(e))
    }
  }

  const handleSaveEdit = async (id: number) => {
    if (!editText.trim()) return
    try {
      await updateAgentRule(id, { ruleText: editText.trim() })
      setEditingId(null)
      await load()
    } catch (e) {
      toast.error(String(e))
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteAgentRule(id)
      setRules(prev => prev.filter(r => r.id !== id))
    } catch (e) {
      toast.error(String(e))
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted text-sm">Loading...</div>
  }

  const globalRules = rules.filter(r => r.scope === 'global')
  const symbolRules = rules.filter(r => r.scope === 'symbol')

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-text">Agent Rules</h1>
          <p className="text-xs text-muted mt-0.5">
            Rules the AI must follow during analysis. Active rules are injected into every LLM prompt.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="px-4 py-1.5 bg-green/10 text-green text-xs font-medium rounded border border-green/30 hover:bg-green/20 transition-colors"
        >
          + Add Rule
        </button>
      </div>

      {/* New rule form */}
      {showNew && (
        <div className="bg-surface border border-border rounded-xl p-5 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">New Rule</div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-muted font-semibold">Rule Text</label>
            <textarea value={newText} onChange={e => setNewText(e.target.value)} rows={2} placeholder="e.g. Never trade against the weekly trend" className="text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-muted font-semibold">Scope</label>
              <select value={newScope} onChange={e => setNewScope(e.target.value as 'global' | 'symbol')} className="text-sm">
                <option value="global">Global (all symbols)</option>
                <option value="symbol">Symbol-specific</option>
              </select>
            </div>
            {newScope === 'symbol' && (
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-muted font-semibold">Symbol</label>
                <input value={newScopeVal} onChange={e => setNewScopeVal(e.target.value)} placeholder="e.g. XAUUSD" className="text-sm" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleCreate} disabled={!newText.trim()} className="px-4 py-1.5 bg-green/10 text-green text-xs font-medium rounded border border-green/30 hover:bg-green/20 disabled:opacity-40 transition-colors">
              Create
            </button>
            <button onClick={() => setShowNew(false)} className="px-4 py-1.5 text-xs text-muted border border-border rounded hover:text-text transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Global rules */}
      <section>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-3">
          Global Rules ({globalRules.length})
        </div>
        <div className="bg-surface border border-border rounded-xl overflow-hidden divide-y divide-border">
          {globalRules.length === 0 && (
            <div className="px-5 py-6 text-center text-sm text-muted">No global rules yet</div>
          )}
          {globalRules.map(rule => (
            <RuleRow
              key={rule.id}
              rule={rule}
              editing={editingId === rule.id}
              editText={editText}
              onStartEdit={() => { setEditingId(rule.id); setEditText(rule.ruleText) }}
              onEditChange={setEditText}
              onSaveEdit={() => handleSaveEdit(rule.id)}
              onCancelEdit={() => setEditingId(null)}
              onToggle={() => handleToggle(rule.id, !rule.enabled)}
              onDelete={() => handleDelete(rule.id)}
            />
          ))}
        </div>
      </section>

      {/* Symbol-specific rules */}
      {symbolRules.length > 0 && (
        <section>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-3">
            Symbol-Specific Rules ({symbolRules.length})
          </div>
          <div className="bg-surface border border-border rounded-xl overflow-hidden divide-y divide-border">
            {symbolRules.map(rule => (
              <RuleRow
                key={rule.id}
                rule={rule}
                editing={editingId === rule.id}
                editText={editText}
                onStartEdit={() => { setEditingId(rule.id); setEditText(rule.ruleText) }}
                onEditChange={setEditText}
                onSaveEdit={() => handleSaveEdit(rule.id)}
                onCancelEdit={() => setEditingId(null)}
                onToggle={() => handleToggle(rule.id, !rule.enabled)}
                onDelete={() => handleDelete(rule.id)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function RuleRow({
  rule, editing, editText,
  onStartEdit, onEditChange, onSaveEdit, onCancelEdit, onToggle, onDelete,
}: {
  rule: AgentRule
  editing: boolean
  editText: string
  onStartEdit: () => void
  onEditChange: (v: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  return (
    <div className={`px-5 py-3 flex items-start gap-3 group transition-colors hover:bg-surface2 ${!rule.enabled ? 'opacity-50' : ''}`}>
      <button
        onClick={onToggle}
        className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
          rule.enabled ? 'bg-brand/20 border-brand/40 text-brand' : 'border-border text-transparent hover:border-muted'
        }`}
      >
        {rule.enabled && <span className="text-[10px]">&#10003;</span>}
      </button>
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="space-y-2">
            <textarea value={editText} onChange={e => onEditChange(e.target.value)} rows={2} className="text-sm w-full" />
            <div className="flex gap-2">
              <button onClick={onSaveEdit} className="text-[10px] px-2.5 py-1 bg-green/10 text-green rounded border border-green/30">Save</button>
              <button onClick={onCancelEdit} className="text-[10px] px-2.5 py-1 text-muted rounded border border-border">Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-text leading-relaxed">{rule.ruleText}</p>
            {rule.scopeValue && (
              <span className="text-[10px] font-mono text-brand bg-brand/10 border border-brand/20 rounded px-1.5 py-0.5 mt-1 inline-block">
                {rule.scopeValue}
              </span>
            )}
          </>
        )}
      </div>
      {!editing && (
        <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onStartEdit} className="text-[10px] px-2 py-1 rounded border border-border text-muted hover:text-text transition-colors">Edit</button>
          <button onClick={onDelete} className="text-[10px] px-2 py-1 rounded border border-border text-muted hover:text-red hover:border-red/30 transition-colors">Delete</button>
        </div>
      )}
    </div>
  )
}
