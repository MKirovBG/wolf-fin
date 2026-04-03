import { useState } from 'react'
import { exportData } from '../api/client.ts'
import { useToast } from '../components/Toast.tsx'
import { Download, Database, FileText, Brain, TrendingUp } from 'lucide-react'

interface ExportQuery {
  key: string
  label: string
  description: string
  icon: React.ElementType
  type: string
  filters: Array<{ key: string; label: string; type: 'text' | 'date' | 'select'; options?: string[] }>
}

const QUERIES: ExportQuery[] = [
  {
    key: 'analyses',
    label: 'Analysis History',
    description: 'All LLM analyses with bias, proposals, indicators, and reasoning',
    icon: FileText,
    type: 'analyses',
    filters: [
      { key: 'symbolKey', label: 'Symbol', type: 'text' },
      { key: 'from', label: 'From Date', type: 'date' },
      { key: 'to', label: 'To Date', type: 'date' },
      { key: 'limit', label: 'Limit', type: 'text' },
    ],
  },
  {
    key: 'outcomes',
    label: 'Trade Outcomes',
    description: 'Proposal outcomes with entry, SL, TP levels, P&L in pips',
    icon: TrendingUp,
    type: 'outcomes',
    filters: [
      { key: 'symbolKey', label: 'Symbol', type: 'text' },
      { key: 'from', label: 'From Date', type: 'date' },
      { key: 'to', label: 'To Date', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: ['', 'pending', 'entered', 'hit_tp1', 'hit_tp2', 'hit_sl', 'expired', 'invalidated'] },
    ],
  },
  {
    key: 'memories',
    label: 'Agent Memories',
    description: 'Agent memory bank — patterns, lessons, preferences, market context',
    icon: Brain,
    type: 'memories',
    filters: [
      { key: 'category', label: 'Category', type: 'select', options: ['', 'pattern', 'lesson', 'preference', 'market_context'] },
      { key: 'active', label: 'Active Only', type: 'select', options: ['', '1', '0'] },
    ],
  },
  {
    key: 'snapshots',
    label: 'Account Snapshots',
    description: 'Historical balance, equity, margin snapshots over time',
    icon: Database,
    type: 'snapshots',
    filters: [
      { key: 'login', label: 'Account Login', type: 'text' },
      { key: 'from', label: 'From Date', type: 'date' },
      { key: 'to', label: 'To Date', type: 'date' },
    ],
  },
]

function downloadJson(data: unknown[], filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function downloadCsv(data: Record<string, unknown>[], filename: string) {
  if (data.length === 0) return
  const headers = Object.keys(data[0])
  const rows = data.map(row =>
    headers.map(h => {
      const v = row[h]
      const s = v == null ? '' : String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
    }).join(',')
  )
  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function DataExport() {
  const [filters, setFilters] = useState<Record<string, Record<string, string>>>({})
  const [loading, setLoading] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ key: string; data: Record<string, unknown>[] } | null>(null)
  const toast = useToast()

  const updateFilter = (queryKey: string, filterKey: string, value: string) => {
    setFilters(prev => ({
      ...prev,
      [queryKey]: { ...prev[queryKey], [filterKey]: value },
    }))
  }

  const handleExport = async (query: ExportQuery, format: 'json' | 'csv') => {
    setLoading(query.key)
    try {
      const params: Record<string, string> = {}
      const f = filters[query.key] ?? {}
      for (const [k, v] of Object.entries(f)) {
        if (v) params[k] = v
      }
      const data = await exportData(query.type, params)
      const ts = new Date().toISOString().slice(0, 10)
      const filename = `wolf-fin_${query.type}_${ts}.${format}`

      if (format === 'csv') {
        downloadCsv(data, filename)
      } else {
        downloadJson(data, filename)
      }
      toast.success(`Exported ${data.length} records`)
    } catch (e) {
      toast.error(String(e))
    } finally {
      setLoading(null)
    }
  }

  const handlePreview = async (query: ExportQuery) => {
    setLoading(query.key)
    try {
      const params: Record<string, string> = {}
      const f = filters[query.key] ?? {}
      for (const [k, v] of Object.entries(f)) {
        if (v) params[k] = v
      }
      params['limit'] = params['limit'] || '10'
      const data = await exportData(query.type, params)
      setPreview({ key: query.key, data })
    } catch (e) {
      toast.error(String(e))
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-lg font-bold text-text">Data Export</h1>
        <p className="text-xs text-muted mt-0.5">Export your trading data as JSON or CSV. Apply filters to narrow results.</p>
      </div>

      <div className="space-y-4">
        {QUERIES.map(q => {
          const Icon = q.icon
          const isLoading = loading === q.key
          return (
            <div key={q.key} className="bg-surface border border-border rounded-lg overflow-hidden">
              <div className="px-5 py-4">
                <div className="flex items-center gap-3 mb-2">
                  <Icon size={16} className="text-brand" />
                  <div>
                    <div className="text-sm font-bold text-text">{q.label}</div>
                    <div className="text-[11px] text-muted">{q.description}</div>
                  </div>
                </div>

                {/* Filters */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                  {q.filters.map(f => (
                    <div key={f.key}>
                      <label className="text-[10px] text-muted uppercase block mb-1">{f.label}</label>
                      {f.type === 'select' ? (
                        <select
                          value={filters[q.key]?.[f.key] ?? ''}
                          onChange={e => updateFilter(q.key, f.key, e.target.value)}
                          className="w-full text-xs bg-bg border border-border rounded px-2 py-1.5 text-text"
                        >
                          {f.options?.map(o => <option key={o} value={o}>{o || 'All'}</option>)}
                        </select>
                      ) : (
                        <input
                          type={f.type}
                          value={filters[q.key]?.[f.key] ?? ''}
                          onChange={e => updateFilter(q.key, f.key, e.target.value)}
                          placeholder={f.type === 'text' ? `e.g. ${f.key === 'limit' ? '100' : 'XAUUSD'}` : ''}
                          className="w-full text-xs bg-bg border border-border rounded px-2 py-1.5 text-text"
                        />
                      )}
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 mt-3">
                  <button onClick={() => handlePreview(q)} disabled={isLoading}
                    className="px-3 py-1.5 text-xs border border-border text-muted rounded hover:text-text hover:border-muted2 transition-colors disabled:opacity-50">
                    Preview
                  </button>
                  <button onClick={() => handleExport(q, 'json')} disabled={isLoading}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-brand/10 text-brand border border-brand/30 rounded hover:bg-brand/20 transition-colors disabled:opacity-50">
                    <Download size={11} /> JSON
                  </button>
                  <button onClick={() => handleExport(q, 'csv')} disabled={isLoading}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-green/10 text-green border border-green/30 rounded hover:bg-green/20 transition-colors disabled:opacity-50">
                    <Download size={11} /> CSV
                  </button>
                  {isLoading && <span className="text-[10px] text-muted2">Loading…</span>}
                </div>
              </div>

              {/* Preview panel */}
              {preview?.key === q.key && preview.data.length > 0 && (
                <div className="border-t border-border px-5 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] uppercase text-muted font-semibold">
                      Preview ({preview.data.length} records)
                    </span>
                    <button onClick={() => setPreview(null)} className="text-[10px] text-muted2 hover:text-text">Close</button>
                  </div>
                  <div className="overflow-x-auto max-h-60">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-border">
                          {Object.keys(preview.data[0]).slice(0, 8).map(k => (
                            <th key={k} className="px-2 py-1 text-left text-[9px] uppercase text-muted font-medium whitespace-nowrap">{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.data.map((row, i) => (
                          <tr key={i} className="border-b border-border/30 hover:bg-surface2">
                            {Object.values(row).slice(0, 8).map((v, j) => (
                              <td key={j} className="px-2 py-1 font-mono text-text whitespace-nowrap max-w-[200px] truncate">
                                {v == null ? '—' : String(v).slice(0, 60)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
