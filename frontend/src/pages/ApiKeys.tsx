import { useEffect, useState } from 'react'
import { getKeys, setKey, testKey } from '../api/client.ts'
import type { KeysResponse } from '../types/index.ts'
import { Card } from '../components/Card.tsx'

interface ServiceRow {
  label: string
  envKey: keyof KeysResponse
  service: string
  description: string
  required: boolean
  placeholder: string
}

const SERVICES: ServiceRow[] = [
  { label: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', service: 'anthropic', description: 'Claude AI — required for all trading decisions', required: true, placeholder: 'sk-ant-api03-...' },
  { label: 'Claude Model', envKey: 'CLAUDE_MODEL', service: '', description: 'Leave blank to use default (claude-opus-4-6)', required: false, placeholder: 'claude-haiku-4-5-20251001' },
  { label: 'OANDA API Key', envKey: 'OANDA_API_KEY', service: 'oanda', description: 'Forex broker — required for forex trading', required: false, placeholder: 'Your OANDA token' },
  { label: 'OANDA Account ID', envKey: 'OANDA_ACCOUNT_ID', service: '', description: 'Format: XXX-XXX-XXXXXXX-XXX', required: false, placeholder: '001-001-1234567-001' },
  { label: 'Binance API Key', envKey: 'BINANCE_API_KEY', service: 'binance', description: 'Crypto exchange — required for crypto trading', required: true, placeholder: 'Your Binance key' },
  { label: 'Binance Secret', envKey: 'BINANCE_API_SECRET', service: '', description: 'Shown only once at creation', required: true, placeholder: 'Your Binance secret' },
  { label: 'Finnhub', envKey: 'FINNHUB_KEY', service: 'finnhub', description: 'Economic calendar — optional enrichment', required: false, placeholder: 'Your Finnhub key' },
  { label: 'Twelve Data', envKey: 'TWELVE_DATA_KEY', service: 'twelvedata', description: 'Forex candle fallback — optional', required: false, placeholder: 'Your Twelve Data key' },
  { label: 'CoinGecko', envKey: 'COINGECKO_KEY', service: 'coingecko', description: 'Crypto market data — leave blank for free tier', required: false, placeholder: 'Optional pro key' },
]

export function ApiKeys() {
  const [keys, setKeys] = useState<KeysResponse | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({})

  useEffect(() => {
    getKeys().then(setKeys).catch(() => { /* ignore */ })
  }, [])

  const save = async (envKey: string) => {
    const val = values[envKey]
    if (!val?.trim()) return
    setSaving(envKey)
    try {
      await setKey(envKey, val.trim())
      setKeys(prev => prev ? { ...prev, [envKey]: true } : prev)
      setValues(prev => ({ ...prev, [envKey]: '' }))
    } finally {
      setSaving(null)
    }
  }

  const test = async (service: string, envKey: string) => {
    if (!service) return
    setTesting(envKey)
    try {
      const result = await testKey(service)
      setResults(prev => ({ ...prev, [envKey]: result }))
      setTimeout(() => setResults(prev => { const n = { ...prev }; delete n[envKey]; return n }), 6000)
    } finally {
      setTesting(null)
    }
  }

  if (!keys) return <div className="p-6 text-muted text-sm">Loading...</div>

  return (
    <div className="p-6">
      <h1 className="text-sm font-bold tracking-widest text-white uppercase mb-2">API Keys</h1>
      <p className="text-muted text-xs mb-6">Keys are saved to your .env file and applied immediately. Values you type are never shown after saving.</p>

      <Card title="Service Credentials">
        <div className="space-y-5">
          {SERVICES.map(s => {
            const isSet = keys[s.envKey]
            const isSaving = saving === s.envKey
            const isTesting = testing === s.envKey
            const result = results[s.envKey]
            return (
              <div key={s.envKey} className="grid grid-cols-[200px_1fr_auto] gap-3 items-start pb-5 border-b border-border last:border-0 last:pb-0">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-white">{s.label}</span>
                    {s.required && <span className="text-[9px] text-red uppercase">required</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${isSet ? 'bg-green shadow-[0_0_4px_#00e676]' : 'bg-muted2'}`} />
                    <span className={`text-[11px] ${isSet ? 'text-green' : 'text-muted'}`}>{isSet ? 'Set' : 'Not set'}</span>
                  </div>
                  <p className="text-[10px] text-muted mt-1 leading-relaxed">{s.description}</p>
                </div>
                <div>
                  <input
                    type="password"
                    placeholder={isSet ? '••••••••••••' : s.placeholder}
                    value={values[s.envKey] || ''}
                    onChange={e => setValues(prev => ({ ...prev, [s.envKey]: e.target.value }))}
                  />
                  {result && (
                    <p className={`text-[11px] mt-1.5 ${result.ok ? 'text-green' : 'text-red'}`}>
                      {result.ok ? '✓' : '✗'} {result.message}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 pt-0.5">
                  <button
                    disabled={!values[s.envKey]?.trim() || isSaving}
                    onClick={() => save(s.envKey)}
                    className="px-3 py-1.5 text-[11px] border border-green text-green rounded hover:bg-green-dim disabled:opacity-25 disabled:cursor-default transition-colors whitespace-nowrap"
                  >
                    {isSaving ? 'Saving...' : 'Save'}
                  </button>
                  {s.service && (
                    <button
                      disabled={!isSet || isTesting}
                      onClick={() => test(s.service, s.envKey)}
                      className="px-3 py-1.5 text-[11px] border border-border text-muted rounded hover:border-white hover:text-white disabled:opacity-25 disabled:cursor-default transition-colors whitespace-nowrap"
                    >
                      {isTesting ? '...' : 'Test'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
