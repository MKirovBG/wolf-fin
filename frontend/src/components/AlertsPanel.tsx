import { useState } from 'react'
import type { AlertRule, AlertFiring, AlertConditionType } from '../types/index.ts'
import { createAlert, toggleAlert, deleteAlert, acknowledgeAlert } from '../api/client.ts'
import { useToast } from './Toast.tsx'

const CONDITION_LABELS: Record<AlertConditionType, string> = {
  setup_score_gte:  'Setup score ≥',
  regime_change:    'Regime changes to',
  direction_change: 'Direction changes to',
  context_risk_gte: 'Context risk ≥',
}

const CONDITION_PLACEHOLDERS: Record<AlertConditionType, string> = {
  setup_score_gte:  '65',
  regime_change:    'trend',
  direction_change: 'bullish',
  context_risk_gte: 'elevated',
}

function rel(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000)    return `${Math.floor(d / 1000)}s ago`
  if (d < 3600000)  return `${Math.floor(d / 60000)}m ago`
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`
  return `${Math.floor(d / 86400000)}d ago`
}

interface Props {
  symbolKey: string
  rules: AlertRule[]
  firings: AlertFiring[]
  onRefresh: () => void
}

export function AlertsPanel({ symbolKey, rules, firings, onRefresh }: Props) {
  const toast = useToast()
  const [showForm, setShowForm]           = useState(false)
  const [formName, setFormName]           = useState('')
  const [formType, setFormType]           = useState<AlertConditionType>('setup_score_gte')
  const [formValue, setFormValue]         = useState('')
  const [creating, setCreating]           = useState(false)
  const [togglingId, setTogglingId]       = useState<number | null>(null)
  const [deletingId, setDeletingId]       = useState<number | null>(null)
  const [ackingId, setAckingId]           = useState<number | null>(null)

  const unacked = firings.filter(f => !f.acknowledged)

  async function handleCreate() {
    if (!formName.trim() || !formValue.trim()) return
    setCreating(true)
    try {
      await createAlert({ symbolKey, name: formName.trim(), conditionType: formType, conditionValue: formValue.trim() })
      setFormName(''); setFormValue(''); setShowForm(false)
      onRefresh()
      toast.success('Alert rule created')
    } catch (e) {
      toast.error(String(e))
    } finally {
      setCreating(false)
    }
  }

  async function handleToggle(id: number, enabled: boolean) {
    setTogglingId(id)
    try {
      await toggleAlert(id, enabled)
      onRefresh()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setTogglingId(null)
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id)
    try {
      await deleteAlert(id)
      onRefresh()
      toast.info('Alert rule deleted')
    } catch (e) {
      toast.error(String(e))
    } finally {
      setDeletingId(null)
    }
  }

  async function handleAck(id: number) {
    setAckingId(id)
    try {
      await acknowledgeAlert(id)
      onRefresh()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setAckingId(null)
    }
  }

  return (
    <div className="space-y-4">

      {/* Unacknowledged firings banner */}
      {unacked.length > 0 && (
        <div className="bg-yellow-dim border border-yellow/30 rounded-lg p-3">
          <div className="text-xs font-semibold text-yellow uppercase tracking-wider mb-2">
            {unacked.length} Unacknowledged Alert{unacked.length !== 1 ? 's' : ''}
          </div>
          <div className="space-y-2">
            {unacked.map(f => (
              <div key={f.id} className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[11px] text-text/80 leading-snug">{f.message}</div>
                  <div className="text-[10px] text-muted2 mt-0.5">{rel(f.firedAt)}</div>
                </div>
                <button
                  onClick={() => handleAck(f.id)}
                  disabled={ackingId === f.id}
                  className="flex-shrink-0 text-[10px] px-2 py-0.5 rounded border border-yellow/30 text-yellow hover:bg-yellow/10 disabled:opacity-40 transition-colors"
                >
                  {ackingId === f.id ? '…' : 'Ack'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rules section */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            Alert Rules ({rules.length})
          </span>
          <button
            onClick={() => setShowForm(s => !s)}
            className="text-[10px] px-2.5 py-1 rounded border border-border text-muted hover:text-text hover:bg-surface2 transition-colors"
          >
            {showForm ? '✕ Cancel' : '+ Add Rule'}
          </button>
        </div>

        {/* Create form */}
        {showForm && (
          <div className="px-4 py-3 border-b border-border bg-surface2/40 space-y-2">
            <input
              className="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-xs text-text placeholder-muted2 focus:outline-none focus:border-green/40"
              placeholder="Rule name…"
              value={formName}
              onChange={e => setFormName(e.target.value)}
            />
            <div className="flex gap-2">
              <select
                className="flex-1 bg-bg border border-border rounded px-2 py-1.5 text-xs text-text focus:outline-none focus:border-green/40"
                value={formType}
                onChange={e => { setFormType(e.target.value as AlertConditionType); setFormValue('') }}
              >
                {(Object.keys(CONDITION_LABELS) as AlertConditionType[]).map(t => (
                  <option key={t} value={t}>{CONDITION_LABELS[t]}</option>
                ))}
              </select>
              <input
                className="w-24 bg-bg border border-border rounded px-2.5 py-1.5 text-xs text-text placeholder-muted2 font-mono focus:outline-none focus:border-green/40"
                placeholder={CONDITION_PLACEHOLDERS[formType]}
                value={formValue}
                onChange={e => setFormValue(e.target.value)}
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={creating || !formName.trim() || !formValue.trim()}
              className="w-full py-1.5 text-xs font-medium rounded border border-green/30 text-green bg-green/10 hover:bg-green/20 disabled:opacity-40 transition-colors"
            >
              {creating ? 'Creating…' : 'Create Alert Rule'}
            </button>
          </div>
        )}

        {/* Rules list */}
        {rules.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted">
            No alert rules yet — add one above
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rules.map(rule => (
              <div key={rule.id} className="flex items-center justify-between px-4 py-2.5 gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-text truncate">{rule.name}</div>
                  <div className="text-[10px] text-muted2 mt-0.5">
                    {CONDITION_LABELS[rule.conditionType]} <span className="font-mono text-muted">{rule.conditionValue}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => handleToggle(rule.id, !rule.enabled)}
                    disabled={togglingId === rule.id}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors disabled:opacity-40 ${
                      rule.enabled
                        ? 'text-green border-green/30 bg-green/10 hover:bg-green/20'
                        : 'text-muted border-border hover:text-text'
                    }`}
                  >
                    {togglingId === rule.id ? '…' : rule.enabled ? 'ON' : 'OFF'}
                  </button>
                  <button
                    onClick={() => handleDelete(rule.id)}
                    disabled={deletingId === rule.id}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted2 hover:text-red hover:border-red/30 transition-colors disabled:opacity-40"
                  >
                    {deletingId === rule.id ? '…' : '✕'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Firing history */}
      {firings.length > 0 && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">
              Recent Firings ({firings.length})
            </span>
          </div>
          <div className="divide-y divide-border max-h-64 overflow-y-auto">
            {firings.map(f => (
              <div key={f.id} className={`px-4 py-2.5 flex items-start gap-2 ${f.acknowledged ? 'opacity-50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-text/80 leading-snug">{f.message}</div>
                  <div className="text-[10px] text-muted2 mt-0.5">{rel(f.firedAt)}</div>
                </div>
                {!f.acknowledged && (
                  <button
                    onClick={() => handleAck(f.id)}
                    disabled={ackingId === f.id}
                    className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-border text-muted2 hover:text-green hover:border-green/30 transition-colors disabled:opacity-40"
                  >
                    {ackingId === f.id ? '…' : 'Ack'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
