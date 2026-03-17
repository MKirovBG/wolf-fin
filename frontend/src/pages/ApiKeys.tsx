import { useEffect, useState } from 'react'
import { getKeys, setKey, testKey } from '../api/client.ts'
import type { KeysResponse } from '../types/index.ts'
import { Card } from '../components/Card.tsx'

interface ServiceRow {
  label: string
  envKey: string
  service: string
  description: string
  required: boolean
  placeholder: string
}

const SERVICES: ServiceRow[] = [
  { label: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', service: 'anthropic', description: 'Claude AI — required when using Anthropic as LLM provider', required: false, placeholder: 'sk-ant-api03-...' },
  { label: 'Claude Model', envKey: 'CLAUDE_MODEL', service: '', description: 'Leave blank to use default (claude-opus-4-5-20251101)', required: false, placeholder: 'claude-haiku-4-5-20251001' },
  { label: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', service: 'openrouter', description: 'OpenRouter — access 100+ models (GPT-4o, Gemini, Llama, etc.) as LLM provider', required: false, placeholder: 'sk-or-v1-...' },
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
      <h1 className="text-xl font-bold text-text mb-2">Integrations</h1>
      <p className="text-muted text-sm mb-6">API keys and provider credentials — saved to your .env file and applied immediately. Values are never shown after saving.</p>

      <Card title="Service Credentials">
        <div className="space-y-5">
          {SERVICES.map(s => {
            const isSet = keys[s.envKey]
            const isSaving = saving === s.envKey
            const isTesting = testing === s.envKey
            const result = results[s.envKey]
            return (
              <div key={s.envKey} className="grid grid-cols-[200px_1fr_auto] gap-4 items-start pb-5 border-b border-border last:border-0 last:pb-0">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm font-semibold text-text">{s.label}</span>
                    {s.required && <span className="text-xs text-red uppercase font-bold">required</span>}
                  </div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${isSet ? 'bg-green' : 'bg-muted2'}`} />
                    <span className={`text-sm ${isSet ? 'text-green' : 'text-muted'}`}>{isSet ? 'Set' : 'Not set'}</span>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">{s.description}</p>
                </div>
                <div>
                  <input
                    type="password"
                    placeholder={isSet ? '••••••••••••' : s.placeholder}
                    value={values[s.envKey] || ''}
                    onChange={e => setValues(prev => ({ ...prev, [s.envKey]: e.target.value }))}
                  />
                  {result && (
                    <p className={`text-sm mt-2 ${result.ok ? 'text-green' : 'text-red'}`}>
                      {result.ok ? '✓' : '✗'} {result.message}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 pt-0.5">
                  <button
                    disabled={!values[s.envKey]?.trim() || isSaving}
                    onClick={() => save(s.envKey)}
                    className="px-4 py-2 text-sm border border-green text-green rounded-lg hover:bg-green-dim disabled:opacity-25 disabled:cursor-default transition-colors whitespace-nowrap font-medium"
                  >
                    {isSaving ? 'Saving...' : 'Save'}
                  </button>
                  {s.service && (
                    <button
                      disabled={!isSet || isTesting}
                      onClick={() => test(s.service, s.envKey)}
                      className="px-4 py-2 text-sm border border-border text-muted rounded-lg hover:border-muted2 hover:text-text disabled:opacity-25 disabled:cursor-default transition-colors whitespace-nowrap"
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
