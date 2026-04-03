import { useEffect, useState, useCallback } from 'react'
import { getStrategies, createStrategy, updateStrategy, deleteStrategy, getAllSymbolStrategies } from '../api/client.ts'
import type { Strategy, SymbolStrategy } from '../types/index.ts'
import { useToast } from '../components/Toast.tsx'

// ── Blank form ────────────────────────────────────────────────────────────────

interface StrategyFormData {
  key:          string
  name:         string
  description:  string
  instructions: string
}

const EMPTY_FORM: StrategyFormData = { key: '', name: '', description: '', instructions: '' }

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

// ── Form panel (create / edit) ────────────────────────────────────────────────

function StrategyForm({
  initial,
  isBuiltin,
  isNew,
  onSave,
  onCancel,
}: {
  initial: StrategyFormData
  isBuiltin?: boolean
  isNew: boolean
  onSave: (form: StrategyFormData) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm]     = useState<StrategyFormData>(initial)
  const [saving, setSaving] = useState(false)

  const set = (field: keyof StrategyFormData, val: string) =>
    setForm(p => ({ ...p, [field]: val }))

  const handleSave = async () => {
    if (!form.name.trim() || !form.instructions.trim()) return
    setSaving(true)
    try { await onSave(form) } finally { setSaving(false) }
  }

  // Auto-slug key from name when creating
  const handleNameChange = (v: string) => {
    set('name', v)
    if (isNew) set('key', slugify(v))
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5 space-y-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted">
        {isNew ? 'New Strategy' : `Editing: ${form.name}`}
        {isBuiltin && <span className="ml-2 text-[10px] text-yellow bg-yellow-dim border border-yellow/30 rounded px-1.5 py-0.5">built-in</span>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-muted font-semibold">Display Name *</label>
          <input
            value={form.name}
            onChange={e => handleNameChange(e.target.value)}
            placeholder="e.g. My Custom Strategy"
            className="w-full text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-muted font-semibold">
            Key {isNew ? '(auto)' : '(read-only)'}
          </label>
          <input
            value={form.key}
            onChange={e => isNew && set('key', slugify(e.target.value))}
            readOnly={!isNew}
            placeholder="e.g. my_custom_strategy"
            className={`w-full text-sm font-mono ${!isNew ? 'opacity-50 cursor-not-allowed' : ''}`}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-[10px] uppercase tracking-wider text-muted font-semibold">Short Description</label>
        <input
          value={form.description}
          onChange={e => set('description', e.target.value)}
          placeholder="One-line description shown in the strategy picker"
          className="w-full text-sm"
        />
      </div>

      <div className="space-y-1">
        <label className="text-[10px] uppercase tracking-wider text-muted font-semibold">
          Instructions * <span className="normal-case font-normal text-muted2">— injected into the system prompt</span>
        </label>
        <textarea
          value={form.instructions}
          onChange={e => set('instructions', e.target.value)}
          rows={6}
          placeholder="Describe the analysis methodology the LLM should apply…"
          className="w-full text-sm font-mono resize-y"
        />
        <div className="text-[10px] text-muted2">{form.instructions.length} chars</div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSave}
          disabled={saving || !form.name.trim() || !form.instructions.trim()}
          className="px-4 py-1.5 bg-green/10 text-green text-xs font-medium rounded border border-green/30 hover:bg-green/20 disabled:opacity-40 transition-colors"
        >
          {saving ? 'Saving…' : isNew ? 'Create Strategy' : 'Save Changes'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-1.5 text-xs text-muted border border-border rounded hover:text-text hover:bg-surface2 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function Strategies() {
  const [strategies, setStrategies]       = useState<Strategy[]>([])
  const [assignments, setAssignments]     = useState<SymbolStrategy[]>([])
  const [loading, setLoading]             = useState(true)
  const [editingKey, setEditingKey]       = useState<string | null>(null)
  const [showNew, setShowNew]             = useState(false)
  const [deleting, setDeleting]           = useState<string | null>(null)
  const toast = useToast()

  const load = useCallback(async () => {
    try {
      const [data, assigns] = await Promise.all([
        getStrategies(),
        getAllSymbolStrategies().catch(() => [] as SymbolStrategy[]),
      ])
      setStrategies(data)
      setAssignments(assigns)
    } catch (e) {
      toast.error(String(e))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const handleCreate = async (form: StrategyFormData) => {
    try {
      await createStrategy({ key: form.key, name: form.name, description: form.description || undefined, instructions: form.instructions })
      toast.success('Strategy created')
      setShowNew(false)
      await load()
    } catch (e) {
      toast.error(String(e))
    }
  }

  const handleUpdate = async (key: string, form: StrategyFormData) => {
    try {
      await updateStrategy(key, { name: form.name, description: form.description || undefined, instructions: form.instructions })
      toast.success('Strategy saved')
      setEditingKey(null)
      await load()
    } catch (e) {
      toast.error(String(e))
    }
  }

  const handleDelete = async (key: string) => {
    setDeleting(key)
    try {
      await deleteStrategy(key)
      toast.success('Strategy deleted')
      await load()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setDeleting(null)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted text-sm">Loading…</div>
  }

  const builtins = strategies.filter(s => s.isBuiltin)
  const custom   = strategies.filter(s => !s.isBuiltin)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-text">Strategies</h1>
          <p className="text-xs text-muted mt-0.5">
            Define analysis strategies. Each strategy's instructions are injected into the LLM system prompt when selected on a symbol.
          </p>
        </div>
        <button
          onClick={() => { setShowNew(true); setEditingKey(null) }}
          className="px-4 py-1.5 bg-green/10 text-green text-xs font-medium rounded border border-green/30 hover:bg-green/20 transition-colors"
        >
          + New Strategy
        </button>
      </div>

      {/* New strategy form */}
      {showNew && (
        <StrategyForm
          initial={EMPTY_FORM}
          isNew
          onSave={handleCreate}
          onCancel={() => setShowNew(false)}
        />
      )}

      {/* Custom strategies */}
      {custom.length > 0 && (
        <section>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-3">Custom</div>
          <div className="bg-surface border border-border rounded-xl overflow-hidden divide-y divide-border">
            {custom.map(s => (
              <StrategyRow
                key={s.key}
                strategy={s}
                editing={editingKey === s.key}
                deleting={deleting === s.key}
                usedBySymbols={assignments.filter(a => a.strategyKey === s.key).map(a => a.symbolKey)}
                onEdit={() => { setEditingKey(s.key); setShowNew(false) }}
                onSave={form => handleUpdate(s.key, form)}
                onCancelEdit={() => setEditingKey(null)}
                onDelete={() => handleDelete(s.key)}
              />
            ))}
          </div>
        </section>
      )}

      {custom.length === 0 && !showNew && (
        <div className="bg-surface border border-border rounded-xl p-6 text-center text-sm text-muted">
          No custom strategies yet. Click <span className="text-green">+ New Strategy</span> to create one.
        </div>
      )}

      {/* Built-in strategies */}
      <section>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-3">Built-in</div>
        <div className="bg-surface border border-border rounded-xl overflow-hidden divide-y divide-border">
          {builtins.map(s => (
            <StrategyRow
              key={s.key}
              strategy={s}
              editing={editingKey === s.key}
              deleting={false}
              usedBySymbols={assignments.filter(a => a.strategyKey === s.key).map(a => a.symbolKey)}
              onEdit={() => { setEditingKey(s.key); setShowNew(false) }}
              onSave={form => handleUpdate(s.key, form)}
              onCancelEdit={() => setEditingKey(null)}
              onDelete={() => {}}
            />
          ))}
        </div>
      </section>

    </div>
  )
}

// ── Strategy row ──────────────────────────────────────────────────────────────

function StrategyRow({
  strategy, editing, deleting, usedBySymbols,
  onEdit, onSave, onCancelEdit, onDelete,
}: {
  strategy:       Strategy
  editing:        boolean
  deleting:       boolean
  usedBySymbols:  string[]
  onEdit:         () => void
  onSave:         (form: StrategyFormData) => Promise<void>
  onCancelEdit:   () => void
  onDelete:       () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (editing) {
    return (
      <div className="p-4">
        <StrategyForm
          initial={{
            key:          strategy.key,
            name:         strategy.name,
            description:  strategy.description ?? '',
            instructions: strategy.instructions,
          }}
          isBuiltin={strategy.isBuiltin}
          isNew={false}
          onSave={onSave}
          onCancel={onCancelEdit}
        />
      </div>
    )
  }

  return (
    <div className="flex items-start gap-4 px-5 py-4 hover:bg-surface2 transition-colors group">
      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-text">{strategy.name}</span>
          <span className="font-mono text-[10px] text-muted2 bg-bg border border-border rounded px-1.5 py-0.5">{strategy.key}</span>
          {strategy.isBuiltin && (
            <span className="text-[10px] text-yellow bg-yellow-dim border border-yellow/30 rounded px-1.5 py-0.5">built-in</span>
          )}
        </div>
        {strategy.description && (
          <p className="text-xs text-muted leading-relaxed">{strategy.description}</p>
        )}
        <p className="text-[11px] text-muted2 mt-1 line-clamp-2 font-mono leading-relaxed">
          {strategy.instructions}
        </p>
        {usedBySymbols.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className="text-[10px] text-muted2">Used by:</span>
            {usedBySymbols.map(sk => (
              <span key={sk} className="text-[10px] font-mono bg-brand/10 text-brand border border-brand/20 rounded px-1.5 py-0.5">
                {sk.replace(/^mt5:/, '')}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onEdit}
          className="text-[11px] px-2.5 py-1 border border-border rounded text-muted hover:text-text hover:bg-surface transition-colors"
        >
          ✎ Edit
        </button>
        {!strategy.isBuiltin && (
          confirmDelete ? (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-red">Delete?</span>
              <button
                onClick={() => { onDelete(); setConfirmDelete(false) }}
                disabled={deleting}
                className="text-[11px] px-2 py-1 border border-red/30 rounded text-red hover:bg-red/10 transition-colors disabled:opacity-40"
              >
                {deleting ? '…' : 'Yes'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-[11px] px-2 py-1 border border-border rounded text-muted hover:text-text transition-colors"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-[11px] px-2.5 py-1 border border-border rounded text-muted hover:text-red hover:border-red/30 transition-colors"
            >
              ✕
            </button>
          )
        )}
      </div>
    </div>
  )
}
