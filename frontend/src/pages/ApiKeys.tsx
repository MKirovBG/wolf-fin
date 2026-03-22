import { useEffect, useState, useMemo } from 'react'
import { getKeys, setKey, testKey, getPlatformLLM, setPlatformLLM, getAnthropicModels, getOpenRouterModels, getOllamaModels } from '../api/client.ts'
import type { KeysResponse, PlatformLLMConfig, AnthropicModel, OpenRouterModel, OllamaModel } from '../types/index.ts'
import { Card } from '../components/Card.tsx'

interface ServiceRow {
  label: string
  envKey: string
  service: string
  description: string
  required: boolean
  placeholder: string
  secret: boolean
}

const SERVICES: ServiceRow[] = [
  { label: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', service: 'anthropic', description: 'Claude AI — required when using Anthropic as LLM provider', required: false, placeholder: 'sk-ant-api03-...', secret: true },
  { label: 'Claude Model', envKey: 'CLAUDE_MODEL', service: '', description: 'Leave blank to use default (claude-opus-4-5-20251101)', required: false, placeholder: 'claude-haiku-4-5-20251001', secret: false },
  { label: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', service: 'openrouter', description: 'OpenRouter — access 100+ models (GPT-4o, Gemini, Llama, etc.) as LLM provider', required: false, placeholder: 'sk-or-v1-...', secret: true },
  { label: 'Ollama URL', envKey: 'OLLAMA_URL', service: 'ollama', description: 'Local LLM server — default http://localhost:11434', required: false, placeholder: 'http://localhost:11434', secret: false },
  { label: 'Binance API Key', envKey: 'BINANCE_API_KEY', service: 'binance', description: 'Crypto exchange — required for crypto trading', required: true, placeholder: 'Your Binance key', secret: true },
  { label: 'Binance Secret', envKey: 'BINANCE_API_SECRET', service: '', description: 'Shown only once at creation', required: true, placeholder: 'Your Binance secret', secret: true },
  { label: 'Finnhub', envKey: 'FINNHUB_KEY', service: 'finnhub', description: 'Economic calendar — optional enrichment', required: false, placeholder: 'Your Finnhub key', secret: true },
  { label: 'Twelve Data', envKey: 'TWELVE_DATA_KEY', service: 'twelvedata', description: 'Forex candle fallback — optional', required: false, placeholder: 'Your Twelve Data key', secret: true },
  { label: 'CoinGecko', envKey: 'COINGECKO_KEY', service: 'coingecko', description: 'Crypto market data — leave blank for free tier', required: false, placeholder: 'Optional pro key', secret: true },
]

export function ApiKeys() {
  const [keys, setKeys] = useState<KeysResponse | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({})

  const [platformLLM, setPlatformLLMState] = useState<PlatformLLMConfig>({ provider: 'anthropic', model: '' })
  const [platformSaving, setPlatformSaving] = useState(false)
  const [platformSaved, setPlatformSaved] = useState(false)
  const [modelSearch, setModelSearch] = useState('')
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [anthropicModels, setAnthropicModels] = useState<AnthropicModel[]>([])
  const [orModels, setOrModels] = useState<OpenRouterModel[]>([])
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([])

  useEffect(() => {
    getKeys().then(setKeys).catch(() => { /* ignore */ })
    getPlatformLLM().then(setPlatformLLMState).catch(() => { /* ignore */ })
  }, [])

  useEffect(() => {
    setModelSearch('')
    setModelPickerOpen(false)
    if (platformLLM.provider === 'anthropic') {
      getAnthropicModels().then(setAnthropicModels).catch(() => setAnthropicModels([]))
    } else if (platformLLM.provider === 'openrouter') {
      getOpenRouterModels().then(setOrModels).catch(() => setOrModels([]))
    } else if (platformLLM.provider === 'ollama') {
      getOllamaModels().then(setOllamaModels).catch(() => setOllamaModels([]))
    }
  }, [platformLLM.provider])

  const filteredAnthropicModels = useMemo(() =>
    anthropicModels.filter(m =>
      !modelSearch || m.name.toLowerCase().includes(modelSearch.toLowerCase()) || m.id.toLowerCase().includes(modelSearch.toLowerCase())
    ), [anthropicModels, modelSearch])

  const filteredOrModels = useMemo(() =>
    orModels.filter(m =>
      !modelSearch || m.name.toLowerCase().includes(modelSearch.toLowerCase()) || m.id.toLowerCase().includes(modelSearch.toLowerCase())
    ), [orModels, modelSearch])

  const savePlatformLLM = async () => {
    setPlatformSaving(true)
    try {
      await setPlatformLLM(platformLLM)
      setPlatformSaved(true)
      setTimeout(() => setPlatformSaved(false), 3000)
    } finally {
      setPlatformSaving(false)
    }
  }

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

      <Card title="Platform LLM">
        <p className="text-xs text-muted mb-6 leading-relaxed">The LLM provider and model used for platform-level AI features (separate from per-agent settings).</p>
        <div className="space-y-6">
          <div className="grid grid-cols-[200px_1fr] gap-4 items-start">
            <div>
              <div className="text-sm font-semibold text-text mb-1">Provider</div>
              <p className="text-xs text-muted leading-relaxed">Which LLM service to use</p>
            </div>
            <div className="flex gap-2">
              {(['anthropic', 'openrouter', 'ollama'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPlatformLLMState(prev => ({ ...prev, provider: p, model: '' }))}
                  className={`px-4 py-2 text-sm rounded-lg border transition-colors capitalize ${
                    platformLLM.provider === p
                      ? 'border-accent text-accent bg-accent-dim'
                      : 'border-border text-muted hover:border-muted2 hover:text-text'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[200px_1fr] gap-4 items-start">
            <div>
              <div className="text-sm font-semibold text-text mb-1">Model</div>
              <p className="text-xs text-muted leading-relaxed">
                {platformLLM.provider === 'anthropic' && 'Select a Claude model'}
                {platformLLM.provider === 'openrouter' && 'Search and select a model'}
                {platformLLM.provider === 'ollama' && 'Select a locally available model'}
              </p>
            </div>
            <div className="space-y-2">

              {/* ── Selected state ── show pill + Change button when a model is picked and picker is closed */}
              {platformLLM.model && !modelPickerOpen ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-accent bg-accent-dim flex-1 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
                    <span className="text-sm text-accent font-medium font-mono truncate">{platformLLM.model}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setModelPickerOpen(true); setModelSearch('') }}
                    className="px-3 py-2 text-sm border border-border text-muted rounded-lg hover:border-muted2 hover:text-text transition-colors flex-shrink-0"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  {/* Search input for anthropic / openrouter */}
                  {((platformLLM.provider === 'anthropic' && anthropicModels.length > 0) ||
                    (platformLLM.provider === 'openrouter' && orModels.length > 0)) && (
                    <input
                      autoFocus={modelPickerOpen}
                      type="text"
                      placeholder="Search models..."
                      value={modelSearch}
                      onChange={e => setModelSearch(e.target.value)}
                    />
                  )}

                  {/* Anthropic list */}
                  {platformLLM.provider === 'anthropic' && anthropicModels.length > 0 && (
                    <select
                      value={platformLLM.model}
                      onChange={e => { setPlatformLLMState(prev => ({ ...prev, model: e.target.value })); setModelPickerOpen(false) }}
                      className="w-full"
                      size={Math.min(filteredAnthropicModels.length + 1, 6)}
                    >
                      <option value="">-- use default --</option>
                      {filteredAnthropicModels.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  )}

                  {/* OpenRouter list */}
                  {platformLLM.provider === 'openrouter' && orModels.length > 0 && (
                    <select
                      value={platformLLM.model}
                      onChange={e => { setPlatformLLMState(prev => ({ ...prev, model: e.target.value })); setModelPickerOpen(false) }}
                      className="w-full"
                      size={Math.min(filteredOrModels.length + 1, 8)}
                    >
                      <option value="">-- select model --</option>
                      {filteredOrModels.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  )}

                  {/* Ollama list */}
                  {platformLLM.provider === 'ollama' && ollamaModels.length > 0 && (
                    <select
                      value={platformLLM.model}
                      onChange={e => { setPlatformLLMState(prev => ({ ...prev, model: e.target.value })); setModelPickerOpen(false) }}
                      className="w-full"
                    >
                      <option value="">-- select model --</option>
                      {ollamaModels.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  )}

                  {/* Fallback text input when models can't be loaded */}
                  {((platformLLM.provider === 'anthropic' && anthropicModels.length === 0) ||
                    (platformLLM.provider === 'openrouter' && orModels.length === 0) ||
                    (platformLLM.provider === 'ollama' && ollamaModels.length === 0)) && (
                    <input
                      type="text"
                      placeholder={
                        platformLLM.provider === 'anthropic' ? 'claude-opus-4-5-20251101 (default)' :
                        platformLLM.provider === 'openrouter' ? 'anthropic/claude-opus-4-5' :
                        'llama3.1'
                      }
                      value={platformLLM.model}
                      onChange={e => setPlatformLLMState(prev => ({ ...prev, model: e.target.value }))}
                    />
                  )}

                  {/* Cancel button when re-picking and a model was already set */}
                  {modelPickerOpen && platformLLM.model && (
                    <button
                      type="button"
                      onClick={() => setModelPickerOpen(false)}
                      className="text-xs text-muted hover:text-text transition-colors"
                    >
                      ✕ Cancel
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={savePlatformLLM}
              disabled={platformSaving}
              className="px-4 py-2 text-sm border border-green text-green rounded-lg hover:bg-green-dim disabled:opacity-25 disabled:cursor-default transition-colors font-medium"
            >
              {platformSaving ? 'Saving...' : 'Save'}
            </button>
            {platformSaved && <span className="text-sm text-green">Saved</span>}
          </div>
        </div>
      </Card>

      <div className="mt-8" />

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
                    type={s.secret ? 'password' : 'text'}
                    placeholder={isSet && s.secret ? '••••••••••••' : s.placeholder}
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
