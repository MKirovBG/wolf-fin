import { useEffect, useState, useMemo } from 'react'
import { Card } from '../components/Card.tsx'
import {
  getKeys, saveKeys, testConn,
  getPlatformLLM, setPlatformLLM,
  getAnthropicModels, getOpenRouterModels, getOllamaModels,
  importClaudeCLI, startClaudeAuth, exchangeClaudeCode,
  startOpenAIAuth, exchangeOpenAICode, refreshOpenAIToken,
  getConfig, saveConfig,
} from '../api/client.ts'
import type { PlatformLLMConfig, AnthropicModel, OpenRouterModel, OllamaModel, AppConfig } from '../types/index.ts'

type Tab = 'llm' | 'credentials' | 'bridge' | 'general'

const TABS: { id: Tab; label: string }[] = [
  { id: 'llm',         label: 'LLM Provider'   },
  { id: 'credentials', label: 'API Keys'        },
  { id: 'bridge',      label: 'MT5 Bridge'      },
  { id: 'general',     label: 'General'         },
]

type KeysResponse = Record<string, boolean | string | null | undefined>

interface ServiceRow {
  label:       string
  envKey:      string
  service:     string
  description: string
  placeholder: string
  secret:      boolean
}

const SERVICES: ServiceRow[] = [
  { label: 'Anthropic API Key',     envKey: 'ANTHROPIC_API_KEY',  service: 'anthropic',  description: 'Required when using Anthropic (API Key) as LLM provider',              placeholder: 'sk-ant-api03-…',          secret: true  },
  { label: 'Claude Session Token',  envKey: 'CLAUDE_SESSION_TOKEN', service: 'anthropic-subscription', description: 'Required when using Anthropic (Subscription) as LLM provider', placeholder: 'sk-ant-oat01-…',          secret: true  },
  { label: 'OpenRouter API Key',    envKey: 'OPENROUTER_API_KEY', service: 'openrouter', description: 'Access 100+ models via OpenRouter',                                     placeholder: 'sk-or-v1-…',              secret: true  },
  { label: 'Finnhub API Key',       envKey: 'FINNHUB_KEY',        service: 'finnhub',    description: 'Economic calendar fallback — optional',                                  placeholder: 'd6rco0…',                  secret: true  },
  { label: 'Ollama URL',            envKey: 'OLLAMA_URL',         service: 'ollama',     description: 'Local LLM server — defaults to http://localhost:11434',                  placeholder: 'http://localhost:11434',   secret: false },
]

// ── Reusable save/feedback hook ───────────────────────────────────────────────
function useSaved(ms = 3000) {
  const [saved, setSaved] = useState(false)
  const show = () => { setSaved(true); setTimeout(() => setSaved(false), ms) }
  return [saved, show] as const
}

// ── LLM Tab ───────────────────────────────────────────────────────────────────
function LLMTab({ keys, onKeysChange }: { keys: KeysResponse; onKeysChange: (k: KeysResponse) => void }) {
  const [cfg, setCfg]               = useState<PlatformLLMConfig>({ provider: 'anthropic', model: '' })
  const [saving, setSaving]         = useState(false)
  const [saved, showSaved]          = useSaved()
  const [modelSearch, setModelSearch]         = useState('')
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [anthropicModels, setAnthropicModels] = useState<AnthropicModel[]>([])
  const [orModels, setOrModels]               = useState<OpenRouterModel[]>([])
  const [ollamaModels, setOllamaModels]       = useState<OllamaModel[]>([])

  // Claude subscription auth
  const [connectingClaude, setConnectingClaude]   = useState(false)
  const [claudeMsg, setClaudeMsg]                 = useState<{ ok: boolean; text: string } | null>(null)
  const [manualAuthState, setManualAuthState]     = useState<{ url: string; state: string } | null>(null)
  const [manualCode, setManualCode]               = useState('')
  const [exchanging, setExchanging]               = useState(false)

  // OpenAI subscription auth
  const [openaiMsg, setOpenaiMsg]                 = useState<{ ok: boolean; text: string } | null>(null)
  const [openaiAuthState, setOpenaiAuthState]     = useState<{ url: string; state: string } | null>(null)
  const [openaiCode, setOpenaiCode]               = useState('')
  const [openaiExchanging, setOpenaiExchanging]   = useState(false)
  const [openaiRefreshing, setOpenaiRefreshing]   = useState(false)

  useEffect(() => {
    getPlatformLLM().then(setCfg).catch(() => {})
  }, [])

  useEffect(() => {
    setModelSearch(''); setModelPickerOpen(false)
    if (cfg.provider === 'anthropic' || cfg.provider === 'anthropic-subscription') {
      getAnthropicModels().then(setAnthropicModels).catch(() => setAnthropicModels([]))
    } else if (cfg.provider === 'openrouter') {
      getOpenRouterModels().then(setOrModels).catch(() => setOrModels([]))
    } else if (cfg.provider === 'ollama') {
      getOllamaModels().then(setOllamaModels).catch(() => setOllamaModels([]))
    }
  }, [cfg.provider])

  const showClaudeMsg = (ok: boolean, text: string) => { setClaudeMsg({ ok, text }); setTimeout(() => setClaudeMsg(null), ok ? 5000 : 8000) }
  const showOpenaiMsg = (ok: boolean, text: string) => { setOpenaiMsg({ ok, text }); setTimeout(() => setOpenaiMsg(null), ok ? 5000 : 8000) }

  const connectClaude = async () => {
    setConnectingClaude(true); setClaudeMsg(null)
    try {
      const res = await importClaudeCLI()
      onKeysChange({ ...keys, CLAUDE_SESSION_TOKEN: true })
      showClaudeMsg(true, `Connected via Claude Code CLI${res.subscriptionType ? ` (${res.subscriptionType})` : ''}`)
    } catch (e) { showClaudeMsg(false, e instanceof Error ? e.message : 'Import failed') }
    finally { setConnectingClaude(false) }
  }

  const startManualAuth = async () => {
    setClaudeMsg(null)
    try { const res = await startClaudeAuth(); setManualAuthState(res); setManualCode(''); window.open(res.url, '_blank', 'noopener') }
    catch { showClaudeMsg(false, 'Failed to generate auth URL') }
  }

  const submitManualCode = async () => {
    if (!manualAuthState || !manualCode.trim()) return
    setExchanging(true)
    try {
      let code = manualCode.trim()
      try { code = new URL(code).searchParams.get('code') ?? code } catch { /* bare code */ }
      await exchangeClaudeCode(code, manualAuthState.state)
      onKeysChange({ ...keys, CLAUDE_SESSION_TOKEN: true })
      showClaudeMsg(true, 'Claude account connected')
      setManualAuthState(null); setManualCode('')
    } catch (e) { showClaudeMsg(false, e instanceof Error ? e.message : 'Code exchange failed') }
    finally { setExchanging(false) }
  }

  const openOpenAIAuth = async () => {
    setOpenaiMsg(null)
    try { const res = await startOpenAIAuth(); setOpenaiAuthState(res); setOpenaiCode(''); window.open(res.url, '_blank', 'noopener') }
    catch { showOpenaiMsg(false, 'Failed to generate auth URL') }
  }

  const submitOpenAICode = async () => {
    if (!openaiAuthState || !openaiCode.trim()) return
    setOpenaiExchanging(true)
    try {
      let code = openaiCode.trim()
      try { code = new URL(code).searchParams.get('code') ?? code } catch { /* bare code */ }
      await exchangeOpenAICode(code, openaiAuthState.state)
      onKeysChange({ ...keys, OPENAI_ACCESS_TOKEN: true })
      showOpenaiMsg(true, 'OpenAI account connected')
      setOpenaiAuthState(null); setOpenaiCode('')
    } catch (e) { showOpenaiMsg(false, e instanceof Error ? e.message : 'Code exchange failed') }
    finally { setOpenaiExchanging(false) }
  }

  const doRefreshOpenAI = async () => {
    setOpenaiRefreshing(true)
    try { await refreshOpenAIToken(); showOpenaiMsg(true, 'Token refreshed') }
    catch (e) { showOpenaiMsg(false, e instanceof Error ? e.message : 'Refresh failed') }
    finally { setOpenaiRefreshing(false) }
  }

  const filteredAnthropicModels = useMemo(() =>
    anthropicModels.filter(m => !modelSearch || m.name.toLowerCase().includes(modelSearch.toLowerCase()) || m.id.toLowerCase().includes(modelSearch.toLowerCase())),
    [anthropicModels, modelSearch])

  const filteredOrModels = useMemo(() =>
    orModels.filter(m => !modelSearch || m.name.toLowerCase().includes(modelSearch.toLowerCase()) || m.id.toLowerCase().includes(modelSearch.toLowerCase())),
    [orModels, modelSearch])

  const save = async () => {
    setSaving(true)
    try { await setPlatformLLM(cfg); showSaved() }
    finally { setSaving(false) }
  }

  const isAnthropicFamily = cfg.provider === 'anthropic' || cfg.provider === 'anthropic-subscription'

  return (
    <div className="space-y-8">
      {/* Provider */}
      <Card title="LLM Provider">
        <p className="text-xs text-muted mb-6">The provider and model used for all analysis. Per-symbol overrides take precedence.</p>

        <div className="space-y-6">
          {/* Provider buttons */}
          <Row label="Provider" hint="Which LLM service to use">
            <div className="flex flex-wrap gap-2">
              {([
                { value: 'anthropic',              label: 'Anthropic (API Key)'     },
                { value: 'anthropic-subscription', label: 'Anthropic (Subscription)'},
                { value: 'openai-subscription',    label: 'OpenAI (ChatGPT)'        },
                { value: 'openrouter',             label: 'OpenRouter'              },
                { value: 'ollama',                 label: 'Ollama'                  },
              ] as const).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setCfg(p => ({ ...p, provider: value, model: '' }))}
                  className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                    cfg.provider === value
                      ? 'border-accent text-accent bg-accent-dim'
                      : 'border-border text-muted hover:border-muted2 hover:text-text'
                  }`}
                >{label}</button>
              ))}
            </div>
          </Row>

          {/* Anthropic subscription auth */}
          {cfg.provider === 'anthropic-subscription' && (
            <Row label="Authentication" hint="Connect your Claude.ai subscription">
              <div className="space-y-3">
                {claudeMsg && (
                  <p className={`text-xs ${claudeMsg.ok ? 'text-green' : 'text-red'}`}>{claudeMsg.ok ? '✓' : '✗'} {claudeMsg.text}</p>
                )}
                <div className="flex items-center gap-3 flex-wrap">
                  <StatusDot set={!!keys.CLAUDE_SESSION_TOKEN} label={keys.CLAUDE_SESSION_TOKEN ? 'Connected' : 'Not connected'} />
                  <button onClick={connectClaude} disabled={connectingClaude} className="btn-accent text-sm">
                    {connectingClaude ? 'Importing…' : keys.CLAUDE_SESSION_TOKEN ? '↻ Re-import from Claude Code' : '⟶ Import from Claude Code'}
                  </button>
                  <button onClick={startManualAuth} className="text-xs text-muted hover:text-text underline">or authorize manually</button>
                </div>
                {manualAuthState && (
                  <CodePasteBox
                    hint={<>A claude.ai auth tab opened. After authorizing you'll land on <span className="font-mono text-muted2">console.anthropic.com</span>. Paste the <span className="font-mono text-accent">code=</span> value or the full URL.</>}
                    value={manualCode} onChange={setManualCode}
                    onSubmit={submitManualCode} onCancel={() => setManualAuthState(null)}
                    loading={exchanging}
                  />
                )}
              </div>
            </Row>
          )}

          {/* OpenAI subscription auth */}
          {cfg.provider === 'openai-subscription' && (
            <Row label="Authentication" hint="Connect your ChatGPT subscription">
              <div className="space-y-3">
                {openaiMsg && (
                  <p className={`text-xs ${openaiMsg.ok ? 'text-green' : 'text-red'}`}>{openaiMsg.ok ? '✓' : '✗'} {openaiMsg.text}</p>
                )}
                <div className="flex items-center gap-3 flex-wrap">
                  <StatusDot set={!!keys.OPENAI_ACCESS_TOKEN} label={keys.OPENAI_ACCESS_TOKEN ? 'Connected' : 'Not connected'} />
                  <button onClick={openOpenAIAuth} className="btn-accent text-sm">
                    {keys.OPENAI_ACCESS_TOKEN ? '↻ Re-authorize' : '⟶ Connect OpenAI Account'}
                  </button>
                  {keys.OPENAI_ACCESS_TOKEN && (
                    <button onClick={doRefreshOpenAI} disabled={openaiRefreshing} className="text-xs text-muted hover:text-text underline disabled:opacity-40">
                      {openaiRefreshing ? 'Refreshing…' : 'Refresh token'}
                    </button>
                  )}
                </div>
                {openaiAuthState && (
                  <CodePasteBox
                    hint={<>An OpenAI auth tab opened. Complete sign-in, then you'll be redirected to <span className="font-mono text-muted2">localhost:1455/auth/callback</span> — that page won't load, that's normal. Paste the full URL or just the <span className="font-mono text-accent">code=</span> value.</>}
                    value={openaiCode} onChange={setOpenaiCode}
                    onSubmit={submitOpenAICode} onCancel={() => setOpenaiAuthState(null)}
                    loading={openaiExchanging}
                  />
                )}
              </div>
            </Row>
          )}

          {/* Model picker */}
          <Row
            label="Model"
            hint={
              isAnthropicFamily ? 'Select a Claude model' :
              cfg.provider === 'openai-subscription' ? 'Select or type a model ID' :
              cfg.provider === 'openrouter' ? 'Search and select a model' :
              'Select a locally available model'
            }
          >
            <div className="space-y-2">
              {cfg.model && !modelPickerOpen ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-accent bg-accent-dim flex-1 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
                    <span className="text-sm text-accent font-mono truncate">{cfg.model}</span>
                  </div>
                  <button onClick={() => { setModelPickerOpen(true); setModelSearch('') }} className="btn-secondary text-sm">Change</button>
                </div>
              ) : (
                <>
                  {/* Search */}
                  {((isAnthropicFamily && anthropicModels.length > 0) || (cfg.provider === 'openrouter' && orModels.length > 0)) && (
                    <input autoFocus={modelPickerOpen} type="text" placeholder="Search models…" value={modelSearch} onChange={e => setModelSearch(e.target.value)} />
                  )}

                  {/* Anthropic list */}
                  {isAnthropicFamily && anthropicModels.length > 0 && (
                    <select value={cfg.model} onChange={e => { setCfg(p => ({ ...p, model: e.target.value })); setModelPickerOpen(false) }} className="w-full" size={Math.min(filteredAnthropicModels.length + 1, 6)}>
                      <option value="">— use default —</option>
                      {filteredAnthropicModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  )}

                  {/* OpenRouter list */}
                  {cfg.provider === 'openrouter' && orModels.length > 0 && (
                    <select value={cfg.model} onChange={e => { setCfg(p => ({ ...p, model: e.target.value })); setModelPickerOpen(false) }} className="w-full" size={Math.min(filteredOrModels.length + 1, 8)}>
                      <option value="">— select model —</option>
                      {filteredOrModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  )}

                  {/* Ollama list */}
                  {cfg.provider === 'ollama' && ollamaModels.length > 0 && (
                    <select value={cfg.model} onChange={e => { setCfg(p => ({ ...p, model: e.target.value })); setModelPickerOpen(false) }} className="w-full">
                      <option value="">— select model —</option>
                      {ollamaModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  )}

                  {/* OpenAI subscription buttons */}
                  {cfg.provider === 'openai-subscription' && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {[
                          { id: 'gpt-5.4',       label: 'GPT-5.4',      note: 'flagship'   },
                          { id: 'gpt-5.4-mini',  label: 'GPT-5.4 mini', note: 'fast'       },
                          { id: 'gpt-5.2',       label: 'GPT-5.2',      note: 'balanced'   },
                          { id: 'gpt-5.1',       label: 'GPT-5.1',      note: 'efficient'  },
                        ].map(m => (
                          <button key={m.id} onClick={() => { setCfg(p => ({ ...p, model: m.id })); setModelPickerOpen(false) }}
                            className={`flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-colors ${
                              cfg.model === m.id ? 'border-accent bg-accent-dim text-accent' : 'border-border text-muted hover:border-muted2 hover:text-text'
                            }`}>
                            <span className="text-xs font-mono font-semibold">{m.label}</span>
                            <span className="text-[10px] text-muted/60">{m.note}</span>
                          </button>
                        ))}
                      </div>
                      <input type="text" placeholder="or type a custom model ID…" value={cfg.model}
                        onChange={e => setCfg(p => ({ ...p, model: e.target.value }))}
                        className="text-xs font-mono" />
                    </div>
                  )}

                  {/* Fallback text input when model list empty */}
                  {((isAnthropicFamily && anthropicModels.length === 0) ||
                    (cfg.provider === 'openrouter' && orModels.length === 0) ||
                    (cfg.provider === 'ollama' && ollamaModels.length === 0)) && (
                    <input type="text"
                      placeholder={isAnthropicFamily ? 'claude-opus-4-6 (default)' : cfg.provider === 'openrouter' ? 'anthropic/claude-opus-4-6' : 'llama3.1'}
                      value={cfg.model}
                      onChange={e => setCfg(p => ({ ...p, model: e.target.value }))} />
                  )}

                  {modelPickerOpen && cfg.model && (
                    <button onClick={() => setModelPickerOpen(false)} className="text-xs text-muted hover:text-text">✕ Cancel</button>
                  )}
                </>
              )}
            </div>
          </Row>

          <div className="flex items-center gap-3 pt-2 border-t border-border">
            <button onClick={save} disabled={saving} className="btn-green">
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="text-sm text-green">Saved</span>}
          </div>
        </div>
      </Card>
    </div>
  )
}

// ── Credentials Tab ───────────────────────────────────────────────────────────
function CredentialsTab({ keys, onKeysChange }: { keys: KeysResponse; onKeysChange: (k: KeysResponse) => void }) {
  const [values, setValues]   = useState<Record<string, string>>({})
  const [saving, setSaving]   = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({})

  const save = async (envKey: string) => {
    const val = values[envKey]
    if (!val?.trim()) return
    setSaving(envKey)
    try {
      await saveKeys({ [envKey]: val.trim() })
      onKeysChange({ ...keys, [envKey]: true })
      setValues(p => ({ ...p, [envKey]: '' }))
    } finally { setSaving(null) }
  }

  const test = async (service: string, envKey: string) => {
    if (!service) return
    setTesting(envKey)
    try {
      const result = await testConn(service)
      setResults(p => ({ ...p, [envKey]: result }))
      setTimeout(() => setResults(p => { const n = { ...p }; delete n[envKey]; return n }), 6000)
    } finally { setTesting(null) }
  }

  return (
    <Card title="API Keys">
      <p className="text-xs text-muted mb-6">Values are written to your .env file and applied immediately. They are never shown after saving.</p>
      <div className="space-y-5">
        {SERVICES.map(s => {
          const isSet     = !!keys[s.envKey]
          const isSaving  = saving === s.envKey
          const isTesting = testing === s.envKey
          const result    = results[s.envKey]
          return (
            <div key={s.envKey} className="grid grid-cols-[180px_1fr_auto] gap-4 items-start pb-5 border-b border-border last:border-0 last:pb-0">
              <div>
                <div className="text-sm font-semibold text-text mb-1">{s.label}</div>
                <StatusDot set={isSet} label={isSet ? 'Set' : 'Not set'} />
                <p className="text-xs text-muted leading-relaxed mt-1">{s.description}</p>
              </div>
              <div>
                <input
                  type={s.secret ? 'password' : 'text'}
                  placeholder={isSet && s.secret ? '••••••••••' : s.placeholder}
                  value={values[s.envKey] ?? ''}
                  onChange={e => setValues(p => ({ ...p, [s.envKey]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') save(s.envKey) }}
                />
                {result && (
                  <p className={`text-xs mt-1.5 ${result.ok ? 'text-green' : 'text-red'}`}>
                    {result.ok ? '✓' : '✗'} {result.message}
                  </p>
                )}
              </div>
              <div className="flex gap-2 pt-0.5">
                <button disabled={!values[s.envKey]?.trim() || isSaving} onClick={() => save(s.envKey)} className="btn-green text-sm">
                  {isSaving ? 'Saving…' : 'Save'}
                </button>
                {s.service && (
                  <button disabled={!isSet || isTesting} onClick={() => test(s.service, s.envKey)} className="btn-secondary text-sm">
                    {isTesting ? '…' : 'Test'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ── Bridge Tab ────────────────────────────────────────────────────────────────
function BridgeTab() {
  const [appCfg, setAppCfg] = useState<AppConfig & { bridgeKey?: string }>({
    bridgePort:   '8000',
    bridgeUrl:    '',
    bridgeKeySet: false,
    logLevel:     'info',
  })
  const [bridgeKeyInput, setBridgeKeyInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, showSaved]  = useSaved()
  const [testing, setTesting]   = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    getConfig().then(c => setAppCfg(c)).catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await saveConfig({
        bridgePort: appCfg.bridgePort,
        bridgeUrl:  appCfg.bridgeUrl,
        ...(bridgeKeyInput.trim() ? { bridgeKey: bridgeKeyInput.trim() } : {}),
      })
      if (bridgeKeyInput.trim()) {
        setAppCfg(p => ({ ...p, bridgeKeySet: true }))
        setBridgeKeyInput('')
      }
      showSaved()
    } finally { setSaving(false) }
  }

  const testBridge = async () => {
    setTesting(true); setTestResult(null)
    try {
      const result = await testConn('mt5')
      setTestResult(result)
      setTimeout(() => setTestResult(null), 6000)
    } finally { setTesting(false) }
  }

  return (
    <Card title="MT5 Bridge">
      <p className="text-xs text-muted mb-6">
        Wolf-Fin communicates with MetaTrader 5 via the local Python bridge.
        Configure connection details here if you changed the defaults.
      </p>
      <div className="space-y-6">
        <Row label="Bridge Port" hint="Port the MT5 Python bridge listens on (default 8000)">
          <input
            type="text"
            value={appCfg.bridgePort}
            onChange={e => setAppCfg(p => ({ ...p, bridgePort: e.target.value }))}
            placeholder="8000"
            className="max-w-xs font-mono"
          />
          <p className="text-xs text-muted mt-1">Used when Bridge URL is empty</p>
        </Row>

        <Row label="Bridge URL" hint="Full URL override — leave blank to use localhost + port">
          <input
            type="text"
            value={appCfg.bridgeUrl}
            onChange={e => setAppCfg(p => ({ ...p, bridgeUrl: e.target.value }))}
            placeholder="http://127.0.0.1:8000"
            className="font-mono"
          />
          <p className="text-xs text-muted mt-1">Set this if the bridge runs on another host</p>
        </Row>

        <Row label="Auth Key" hint="Optional secret key the bridge requires (X-Bridge-Key header)">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <StatusDot set={appCfg.bridgeKeySet} label={appCfg.bridgeKeySet ? 'Key is set' : 'No key set (bridge is open)'} />
            </div>
            <input
              type="password"
              value={bridgeKeyInput}
              onChange={e => setBridgeKeyInput(e.target.value)}
              placeholder={appCfg.bridgeKeySet ? 'Enter new key to replace…' : 'Enter bridge auth key…'}
              className="font-mono"
            />
          </div>
        </Row>

        <Row label="Connection" hint="Test that the bridge is reachable with current settings">
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={testBridge} disabled={testing} className="btn-secondary">
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
            {testResult && (
              <span className={`text-sm ${testResult.ok ? 'text-green' : 'text-red'}`}>
                {testResult.ok ? '✓' : '✗'} {testResult.message}
              </span>
            )}
          </div>
        </Row>

        <div className="flex items-center gap-3 pt-2 border-t border-border">
          <button onClick={save} disabled={saving} className="btn-green">
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="text-sm text-green">Saved</span>}
        </div>
      </div>
    </Card>
  )
}

// ── General Tab ───────────────────────────────────────────────────────────────
function GeneralTab() {
  const [appCfg, setAppCfg] = useState<AppConfig>({
    bridgePort: '8000', bridgeUrl: '', bridgeKeySet: false, logLevel: 'info',
  })
  const [saving, setSaving] = useState(false)
  const [saved, showSaved]  = useSaved()

  useEffect(() => {
    getConfig().then(setAppCfg).catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    try { await saveConfig({ logLevel: appCfg.logLevel }); showSaved() }
    finally { setSaving(false) }
  }

  return (
    <Card title="General">
      <div className="space-y-6">
        <Row label="Log Level" hint="Controls verbosity of server logs">
          <div className="flex gap-2 flex-wrap">
            {(['debug', 'info', 'warn', 'error'] as const).map(lvl => (
              <button
                key={lvl}
                onClick={() => setAppCfg(p => ({ ...p, logLevel: lvl }))}
                className={`px-4 py-2 text-sm rounded-lg border font-mono transition-colors ${
                  appCfg.logLevel === lvl
                    ? 'border-accent text-accent bg-accent-dim'
                    : 'border-border text-muted hover:border-muted2 hover:text-text'
                }`}
              >{lvl}</button>
            ))}
          </div>
          <p className="text-xs text-muted mt-1.5">
            {appCfg.logLevel === 'debug' && 'Verbose — logs all internal operations'}
            {appCfg.logLevel === 'info'  && 'Standard — logs key events (recommended)'}
            {appCfg.logLevel === 'warn'  && 'Quiet — only warnings and errors'}
            {appCfg.logLevel === 'error' && 'Minimal — only errors'}
          </p>
        </Row>

        <div className="flex items-center gap-3 pt-2 border-t border-border">
          <button onClick={save} disabled={saving} className="btn-green">
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="text-sm text-green">Saved</span>}
        </div>
      </div>
    </Card>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-4 items-start">
      <div>
        <div className="text-sm font-semibold text-text mb-0.5">{label}</div>
        <p className="text-xs text-muted leading-relaxed">{hint}</p>
      </div>
      <div>{children}</div>
    </div>
  )
}

function StatusDot({ set, label }: { set: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${set ? 'bg-green' : 'bg-muted2'}`} />
      <span className={`text-xs ${set ? 'text-green' : 'text-muted'}`}>{label}</span>
    </div>
  )
}

function CodePasteBox({
  hint, value, onChange, onSubmit, onCancel, loading,
}: {
  hint: React.ReactNode
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
  loading: boolean
}) {
  return (
    <div className="bg-bg border border-border rounded-lg p-3 space-y-2">
      <p className="text-xs text-muted leading-relaxed">{hint}</p>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Paste code or full redirect URL…"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSubmit() }}
          className="flex-1 text-xs font-mono"
        />
        <button onClick={onSubmit} disabled={!value.trim() || loading}
          className="px-3 py-1.5 text-xs border border-green text-green rounded-lg hover:bg-green-dim disabled:opacity-40 disabled:cursor-default transition-colors whitespace-nowrap">
          {loading ? 'Connecting…' : 'Submit'}
        </button>
        <button onClick={onCancel} className="text-xs text-muted hover:text-text">✕</button>
      </div>
    </div>
  )
}

// ── Main Config page ──────────────────────────────────────────────────────────
export function Config() {
  const [tab, setTab] = useState<Tab>('llm')
  const [keys, setKeys] = useState<KeysResponse>({})

  useEffect(() => {
    getKeys().then(r => setKeys(r as KeysResponse)).catch(() => {})
  }, [])

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-xl font-bold text-text mb-1">Settings</h1>
      <p className="text-muted text-sm mb-6">Configure LLM provider, API credentials, MT5 bridge, and runtime options.</p>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors -mb-px border-b-2 ${
              tab === t.id
                ? 'text-green border-green'
                : 'text-muted border-transparent hover:text-text'
            }`}
          >{t.label}</button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'llm'         && <LLMTab keys={keys} onKeysChange={setKeys} />}
      {tab === 'credentials' && <CredentialsTab keys={keys} onKeysChange={setKeys} />}
      {tab === 'bridge'      && <BridgeTab />}
      {tab === 'general'     && <GeneralTab />}
    </div>
  )
}
