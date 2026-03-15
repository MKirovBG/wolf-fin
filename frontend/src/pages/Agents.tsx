import { useEffect, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { getStatus, addAgent, deleteAgent, triggerAgent } from '../api/client.ts'
import type { StatusResponse, AgentConfig } from '../types/index.ts'
import { Card } from '../components/Card.tsx'
import { Badge, decisionVariant } from '../components/Badge.tsx'

function rel(iso: string) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000) return `${Math.floor(d / 1000)}s ago`
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`
  return `${Math.floor(d / 3600000)}h ago`
}

export function Agents() {
  const [data, setData] = useState<StatusResponse | null>(null)
  const [triggering, setTriggering] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const { register, handleSubmit, reset } = useForm<AgentConfig & { paperStr: string }>()

  const load = useCallback(async () => {
    try { setData(await getStatus()) } catch { /* ignore */ }
  }, [])

  useEffect(() => { load(); const id = setInterval(load, 10000); return () => clearInterval(id) }, [load])

  const onAdd = handleSubmit(async (vals) => {
    await addAgent({ symbol: vals.symbol.toUpperCase(), market: vals.market, paper: vals.paperStr !== 'false' })
    reset()
    await load()
  })

  const onDelete = async (key: string) => {
    setDeleting(key)
    await deleteAgent(key)
    setDeleting(null)
    await load()
  }

  const onTrigger = async (key: string) => {
    setTriggering(key)
    await triggerAgent(key)
    setTriggering(null)
    await load()
  }

  if (!data) return <div className="p-6 text-muted text-sm">Loading...</div>

  return (
    <div className="p-6">
      <h1 className="text-sm font-bold tracking-widest text-white uppercase mb-6">Agents</h1>

      <Card title="Active Agents" className="mb-4">
        {data.configs.length === 0
          ? <p className="text-muted text-xs">No agents configured. Add one below.</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    {['Symbol', 'Market', 'Mode', 'Last Decision', 'Reason', 'Last Run', 'Actions'].map(h => (
                      <th key={h} className="text-left text-[10px] uppercase tracking-wide text-muted pb-2 pr-4 border-b border-border">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.configs.map(c => {
                    const key = `${c.market}:${c.symbol}`
                    const last = data.lastCycleByKey[key]
                    const isTrig = triggering === key
                    const isDel = deleting === key
                    return (
                      <tr key={key} className="hover:bg-surface2 border-b border-[#1a1a1a]">
                        <td className="py-2.5 pr-4 font-bold text-white">{c.symbol}</td>
                        <td className="py-2.5 pr-4"><Badge label={c.market.toUpperCase()} variant={c.market} /></td>
                        <td className="py-2.5 pr-4"><Badge label={c.paper !== false ? 'PAPER' : 'LIVE'} variant={c.paper !== false ? 'paper' : 'live'} /></td>
                        <td className="py-2.5 pr-4">{last ? <Badge label={last.decision} variant={decisionVariant(last.decision)} /> : <span className="text-muted">—</span>}</td>
                        <td className="py-2.5 pr-4 text-muted max-w-[200px] truncate">{last?.reason || '—'}</td>
                        <td className="py-2.5 pr-4 text-muted whitespace-nowrap">{last ? rel(last.time) : '—'}</td>
                        <td className="py-2.5">
                          <div className="flex gap-2">
                            <button
                              disabled={isTrig}
                              onClick={() => onTrigger(key)}
                              className="px-2.5 py-1 text-[11px] border border-blue-500/50 text-blue-400 rounded hover:bg-blue-900/20 disabled:opacity-40 transition-colors"
                            >
                              {isTrig ? 'Running...' : 'Trigger'}
                            </button>
                            <button
                              disabled={isDel}
                              onClick={() => onDelete(key)}
                              className="px-2.5 py-1 text-[11px] border border-red-border text-red rounded hover:bg-red-dim disabled:opacity-40 transition-colors"
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      </Card>

      <Card title="Add Agent">
        <form onSubmit={onAdd} className="flex gap-3 items-end flex-wrap">
          <div>
            <label className="block text-[10px] text-muted uppercase tracking-wide mb-1.5">Symbol</label>
            <input {...register('symbol', { required: true })} placeholder="BTCUSDT" className="w-32" />
          </div>
          <div>
            <label className="block text-[10px] text-muted uppercase tracking-wide mb-1.5">Market</label>
            <select {...register('market')} className="w-28">
              <option value="crypto">Crypto</option>
              <option value="forex">Forex</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-muted uppercase tracking-wide mb-1.5">Mode</label>
            <select {...register('paperStr')} className="w-24">
              <option value="true">Paper</option>
              <option value="false">Live</option>
            </select>
          </div>
          <button
            type="submit"
            className="px-4 py-1.5 text-xs border border-green text-green rounded hover:bg-green-dim transition-colors"
          >
            Add Agent
          </button>
        </form>
      </Card>
    </div>
  )
}
