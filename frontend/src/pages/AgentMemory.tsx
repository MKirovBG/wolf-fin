import { useEffect, useState, useCallback } from 'react'
import { getAgentMemories, createAgentMemory, updateAgentMemory, deleteAgentMemory, triggerDigest } from '../api/client.ts'
import type { AgentMemory as AgentMemoryType } from '../types/index.ts'
import { useToast } from '../components/Toast.tsx'
import { Info, Zap, Clock, Brain, RefreshCw } from 'lucide-react'

const CATEGORIES = ['pattern', 'lesson', 'preference', 'market_context'] as const

const CATEGORY_COLORS: Record<string, string> = {
  pattern:        'text-purple bg-purple/10 border-purple/30',
  lesson:         'text-yellow bg-yellow-dim border-yellow/30',
  preference:     'text-brand bg-brand/10 border-brand/30',
  market_context: 'text-blue bg-blue/10 border-blue/30',
}

function rel(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000)    return `${Math.floor(d / 1000)}s ago`
  if (d < 3600000)  return `${Math.floor(d / 60000)}m ago`
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`
  return `${Math.floor(d / 86400000)}d ago`
}

export function AgentMemory() {
  const [memories, setMemories]     = useState<AgentMemoryType[]>([])
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState<string | null>(null)
  const [showNew, setShowNew]       = useState(false)
  const [newCat, setNewCat]         = useState<string>('pattern')
  const [newContent, setNewContent] = useState('')
  const [newSymbol, setNewSymbol]   = useState('')
  const [digestRunning, setDigestRunning] = useState(false)
  const [showInfo, setShowInfo]     = useState(true)
  const toast = useToast()

  const load = useCallback(async () => {
    try {
      const data = await getAgentMemories(filter ? { category: filter } : undefined)
      setMemories(data)
    } catch (e) {
      toast.error(String(e))
    } finally {
      setLoading(false)
    }
  }, [filter, toast])

  useEffect(() => { load() }, [load])

  const handleDigest = async () => {
    setDigestRunning(true)
    try {
      const result = await triggerDigest()
      toast.success(`Digest complete — ${result.memories} memories created, ${result.purged} expired purged`)
      await load()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setDigestRunning(false)
    }
  }

  const handleCreate = async () => {
    if (!newContent.trim()) return
    try {
      await createAgentMemory({ category: newCat, content: newContent.trim(), symbol: newSymbol.trim() || undefined })
      toast.success('Memory saved')
      setShowNew(false)
      setNewContent('')
      setNewSymbol('')
      await load()
    } catch (e) {
      toast.error(String(e))
    }
  }

  const handleToggle = async (id: number, active: boolean) => {
    try {
      await updateAgentMemory(id, { active })
      setMemories(prev => prev.map(m => m.id === id ? { ...m, active } : m))
    } catch (e) {
      toast.error(String(e))
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteAgentMemory(id)
      setMemories(prev => prev.filter(m => m.id !== id))
    } catch (e) {
      toast.error(String(e))
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted text-sm">Loading...</div>
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-text">Agent Memory</h1>
          <p className="text-xs text-muted mt-0.5">
            Patterns, lessons, and preferences the agent remembers across analyses. Active memories are injected into the LLM prompt.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDigest}
            disabled={digestRunning}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand/10 text-brand text-xs font-medium rounded border border-brand/30 hover:bg-brand/20 disabled:opacity-40 transition-colors"
          >
            <RefreshCw size={12} className={digestRunning ? 'animate-spin' : ''} />
            {digestRunning ? 'Running…' : 'Run Digest'}
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="px-4 py-1.5 bg-green/10 text-green text-xs font-medium rounded border border-green/30 hover:bg-green/20 transition-colors"
          >
            + Add Memory
          </button>
        </div>
      </div>

      {/* Info banner */}
      {showInfo && (
        <div className="bg-blue/5 border border-blue/20 rounded-xl p-4 relative">
          <button
            onClick={() => setShowInfo(false)}
            className="absolute top-2 right-3 text-muted2 hover:text-text text-xs"
          >✕</button>
          <div className="flex items-start gap-3">
            <Info size={16} className="text-blue mt-0.5 flex-shrink-0" />
            <div className="space-y-2 text-xs text-muted leading-relaxed">
              <p className="text-text font-medium text-sm">How Agent Memory Works</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
                <div className="flex items-start gap-2">
                  <Zap size={13} className="text-yellow mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="text-text font-medium">Auto-Extract</span>
                    <p className="mt-0.5">After each analysis, 1-2 key observations are automatically saved — market context (48h) and trade setups (72h). No extra LLM call.</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Clock size={13} className="text-brand mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="text-text font-medium">Daily Digest</span>
                    <p className="mt-0.5">Once per day, all analyses are summarized into per-symbol (7-day) and global (14-day) memories via a single LLM call. Expired memories are purged.</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Brain size={13} className="text-purple mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="text-text font-medium">Context Injection</span>
                    <p className="mt-0.5">Active memories are injected into the LLM system prompt before each analysis, giving the agent persistent context across sessions.</p>
                  </div>
                </div>
              </div>
              <p className="text-muted2 mt-1">You can also add memories manually for custom instructions or observations the agent should consider.</p>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setFilter(null)}
          className={`text-[10px] px-2.5 py-1 rounded border font-medium transition-colors ${
            filter === null ? 'bg-brand/10 text-brand border-brand/30' : 'bg-surface2 text-muted border-border hover:text-text'
          }`}
        >
          All ({memories.length})
        </button>
        {CATEGORIES.map(cat => {
          const count = memories.filter(m => m.category === cat).length
          return (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`text-[10px] px-2.5 py-1 rounded border font-medium transition-colors ${
                filter === cat ? 'bg-brand/10 text-brand border-brand/30' : 'bg-surface2 text-muted border-border hover:text-text'
              }`}
            >
              {cat.replace('_', ' ')} ({count})
            </button>
          )
        })}
      </div>

      {/* New memory form */}
      {showNew && (
        <div className="bg-surface border border-border rounded-xl p-5 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">New Memory</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-muted font-semibold">Category</label>
              <select value={newCat} onChange={e => setNewCat(e.target.value)} className="text-sm">
                {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-muted font-semibold">Symbol (optional)</label>
              <input value={newSymbol} onChange={e => setNewSymbol(e.target.value)} placeholder="e.g. XAUUSD" className="text-sm" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-muted font-semibold">Content</label>
            <textarea value={newContent} onChange={e => setNewContent(e.target.value)} rows={3} placeholder="What should the agent remember?" className="text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleCreate} disabled={!newContent.trim()} className="px-4 py-1.5 bg-green/10 text-green text-xs font-medium rounded border border-green/30 hover:bg-green/20 disabled:opacity-40 transition-colors">
              Save
            </button>
            <button onClick={() => setShowNew(false)} className="px-4 py-1.5 text-xs text-muted border border-border rounded hover:text-text transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Memory cards */}
      <div className="space-y-2">
        {memories
          .filter(m => !filter || m.category === filter)
          .map(mem => (
          <div
            key={mem.id}
            className={`bg-surface border border-border rounded-lg px-4 py-3 flex items-start gap-3 group transition-colors ${
              !mem.active ? 'opacity-50' : ''
            }`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${CATEGORY_COLORS[mem.category] ?? 'text-muted bg-surface2 border-border'}`}>
                  {mem.category.replace('_', ' ')}
                </span>
                {mem.symbol && (
                  <span className="text-[10px] font-mono text-muted bg-bg border border-border rounded px-1.5 py-0.5">
                    {mem.symbol}
                  </span>
                )}
                <span className="text-[10px] text-muted2">{rel(mem.createdAt)}</span>
              </div>
              <p className="text-sm text-text leading-relaxed">{mem.content}</p>
              <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted2">
                <span>Confidence: {(mem.confidence * 100).toFixed(0)}%</span>
                {mem.sourceAnalysisId && <span>Source: #{mem.sourceAnalysisId}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => handleToggle(mem.id, !mem.active)}
                className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                  mem.active ? 'text-yellow border-yellow/30 hover:bg-yellow-dim' : 'text-green border-green/30 hover:bg-green/10'
                }`}
              >
                {mem.active ? 'Deactivate' : 'Activate'}
              </button>
              <button
                onClick={() => handleDelete(mem.id)}
                className="text-[10px] px-2 py-1 rounded border border-border text-muted hover:text-red hover:border-red/30 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        ))}

        {memories.filter(m => !filter || m.category === filter).length === 0 && (
          <div className="bg-surface border border-border rounded-xl p-8 text-center text-sm text-muted">
            No memories yet. The agent will learn from analyses, or you can add them manually.
          </div>
        )}
      </div>
    </div>
  )
}
