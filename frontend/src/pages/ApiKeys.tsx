import { useEffect, useState, useMemo } from 'react'
import { getKeys, saveKeys, testConn, getPlatformLLM, setPlatformLLM, getAnthropicModels, getOpenRouterModels, getOllamaModels, importClaudeCLI, startClaudeAuth, exchangeClaudeCode, startOpenAIAuth, exchangeOpenAICode, refreshOpenAIToken } from '../api/client.ts'
import type { PlatformLLMConfig, AnthropicModel, OpenRouterModel, OllamaModel } from '../types/index.ts'

type KeysResponse = Record<string, boolean | undefined>
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
  { label: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', service: 'anthropic', description: 'Claude AI — required when using Anthropic (API Key) as LLM provider', required: false, placeholder: 'sk-ant-api03-...', secret: true },
  { label: 'Claude Model', envKey: 'CLAUDE_MODEL', service: '', description: 'Leave blank to use default (claude-opus-4-5-20251101)', required: false, placeholder: 'claude-haiku-4-5-20251001', secret: false },
  { label: 'Claude Session Token', envKey: 'CLAUDE_SESSION_TOKEN', service: 'anthropic-subscription', description: 'Claude.ai subscription token — required when using Anthropic (Subscription) as LLM provider', required: false, placeholder: 'sk-ant-...', secret: true },
  { label: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', service: 'openrouter', description: 'OpenRouter — access 100+ models (GPT-4o, Gemini, Llama, etc.) as LLM provider', required: false, placeholder: 'sk-or-v1-...', secret: true },
  { label: 'Ollama URL', envKey: 'OLLAMA_URL', service: 'ollama', description: 'Local LLM server — default http://localhost:11434', required: false, placeholder: 'http://localhost:11434', secret: false },
  { label: 'Finnhub', envKey: 'FINNHUB_KEY', service: 'finnhub', description: 'Economic calendar — optional enrichment', required: false, placeholder: 'Your Finnhub key', secret: true },
]

export function ApiKeys() {
  const [keys, setKeys] = useState<KeysResponse | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({})
  const [connectingClaude, setConnectingClaude] = useState(false)
  const [claudeAuthMsg, setClaudeAuthMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [manualAuthState, setManualAuthState] = useState<{ url: string; state: string } | null>(null)
  const [manualCode, setManualCode] = useState('')
  const [exchanging, setExchanging] = useState(false)

  const [openaiAuthMsg, setOpenaiAuthMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [openaiAuthState, setOpenaiAuthState] = useState<{ url: string; state: string } | null>(null)
  const [openaiCode, setOpenaiCode] = useState('')
  const [openaiExchanging, setOpenaiExchanging] = useState(false)
  const [openaiRefreshing, setOpenaiRefreshing] = useState(false)

  const [platformLLM, setPlatformLLMState] = useState<PlatformLLMConfig>({ provider: 'anthropic', model: '' })
  const [platformSaving, setPlatformSaving] = useState(false)
  const [platformSaved, setPlatformSaved] = useState(false)
  const [modelSearch, setModelSearch] = useState('')
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [anthropicModels, setAnthropicModels] = useState<AnthropicModel[]>([])
  const [orModels, setOrModels] = useState<OpenRouterModel[]>([])
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([])

  useEffect(() => {
    getKeys().then(r => setKeys(r as KeysResponse)).catch(() => { /* ignore */ })
    getPlatformLLM().then(setPlatformLLMState).catch(() => { /* ignore */ })
  }, [])

  useEffect(() => {
    setModelSearch('')
    setModelPickerOpen(false)
    if (platformLLM.provider === 'anthropic' || platformLLM.provider === 'anthropic-subscription') {
      getAnthropicModels().then(setAnthropicModels).catch(() => setAnthropicModels([]))
    } else if (platformLLM.provider === 'openrouter') {
      getOpenRouterModels().then(setOrModels).catch(() => setOrModels([]))
    } else if (platformLLM.provider === 'ollama') {
      getOllamaModels().then(setOllamaModels).catch(() => setOllamaModels([]))
    }
  }, [platformLLM.provider])

  const showAuthMsg = (ok: boolean, text: string) => {
    setClaudeAuthMsg({ ok, text })
    setTimeout(() => setClaudeAuthMsg(null), ok ? 5000 : 8000)
  }

  const showOpenaiMsg = (ok: boolean, text: string) => {
    setOpenaiAuthMsg({ ok, text })
    setTimeout(() => setOpenaiAuthMsg(null), ok ? 5000 : 8000)
  }

  const openOpenAIAuth = async () => {
    setOpenaiAuthMsg(null)
    try {
      const res = await startOpenAIAuth()
      setOpenaiAuthState(res)
      setOpenaiCode('')
      window.open(res.url, '_blank', 'noopener')
    } catch {
      showOpenaiMsg(false, 'Failed to generate auth URL')
    }
  }

  const submitOpenAICode = async () => {
    if (!openaiAuthState || !openaiCode.trim()) return
    setOpenaiExchanging(true)
    try {
      let code = openaiCode.trim()
      try { code = new URL(code).searchParams.get('code') ?? code } catch { /* bare code */ }
      await exchangeOpenAICode(code, openaiAuthState.state)
      setKeys(prev => prev ? { ...prev, OPENAI_ACCESS_TOKEN: true } : prev)
      showOpenaiMsg(true, 'OpenAI account connected successfully')
      setOpenaiAuthState(null)
      setOpenaiCode('')
    } catch (e) {
      showOpenaiMsg(false, e instanceof Error ? e.message : 'Code exchange failed')
    } finally {
      setOpenaiExchanging(false)
    }
  }

  const doRefreshOpenAI = async () => {
    setOpenaiRefreshing(true)
    try {
      await refreshOpenAIToken()
      showOpenaiMsg(true, 'Token refreshed successfully')
    } catch (e) {
      showOpenaiMsg(false, e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setOpenaiRefreshing(false)
    }
  }

  // Method 1: import from local Claude Code CLI credentials (one click)
  const connectClaude = async () => {
    setConnectingClaude(true)
    setClaudeAuthMsg(null)
    try {
      const res = await importClaudeCLI()
      setKeys(prev => prev ? { ...prev, CLAUDE_SESSION_TOKEN: true } : prev)
      showAuthMsg(true, `Connected via Claude Code CLI${res.subscriptionType ? ` (${res.subscriptionType})` : ''}`)
    } catch (e) {
      showAuthMsg(false, e instanceof Error ? e.message : 'Import failed')
    } finally {
      setConnectingClaude(false)
    }
  }

  // Method 2: manual PKCE — open auth URL, user pastes back the code
  const startManualAuth = async () => {
    setClaudeAuthMsg(null)
    try {
      const res = await startClaudeAuth()
      setManualAuthState(res)
      setManualCode('')
      window.open(res.url, '_blank', 'noopener')
    } catch {
      showAuthMsg(false, 'Failed to generate auth URL')
    }
  }

  const submitManualCode = async () => {
    if (!manualAuthState || !manualCode.trim()) return
    setExchanging(true)
    try {
      // Accept either a full URL or just the code value
      let code = manualCode.trim()
      try { code = new URL(code).searchParams.get('code') ?? code } catch { /* bare code */ }
      await exchangeClaudeCode(code, manualAuthState.state)
      setKeys(prev => prev ? { ...prev, CLAUDE_SESSION_TOKEN: true } : prev)
      showAuthMsg(true, 'Claude account connected successfully')
      setManualAuthState(null)
      setManualCode('')
    } catch (e) {
      showAuthMsg(false, e instanceof Error ? e.message : 'Code exchange failed')
    } finally {
      setExchanging(false)
    }
  }

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
      await saveKeys({ [envKey]: val.trim() })
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
      const result = await testConn(service)
      setResults(prev => ({ ...prev, [envKey]: result }))
      setTimeout(() => setResults(prev => { const n = { ...prev }; delete n[envKey]; return n }), 6000)
    } finally {
      setTesting(null)
    }
  }

  if (!keys) return <div className="p-6 text-muted text-sm">Loading...</div>

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-xl font-bold text-text mb-2">Integrations</h1>
      <p className="text-muted text-sm mb-6">API keys and provider credentials — saved to your .env file and applied immediately. Values are never shown after saving.</p>

      <Card title="Platform LLM">
        <p className="text-xs text-muted mb-6 leading-relaxed">The LLM provider and model used by all agents set to "Platform LLM" and for platform-level AI features.</p>
        <div className="space-y-6">
          <div className="grid grid-cols-[200px_1fr] gap-4 items-start">
            <div>
              <div className="text-sm font-semibold text-text mb-1">Provider</div>
              <p className="text-xs text-muted leading-relaxed">Which LLM service to use</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                { value: 'anthropic', label: 'Anthropic (API Key)' },
                { value: 'anthropic-subscription', label: 'Anthropic (Subscription)' },
                { value: 'openai-subscription', label: 'OpenAI (ChatGPT)' },
                { value: 'openrouter', label: 'OpenRouter' },
                { value: 'ollama', label: 'Ollama' },
              ] as const).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setPlatformLLMState(prev => ({ ...prev, provider: value, model: '' }))}
                  className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                    platformLLM.provider === value
                      ? 'border-accent text-accent bg-accent-dim'
                      : 'border-border text-muted hover:border-muted2 hover:text-text'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {platformLLM.provider === 'openai-subscription' && (
            <div className="grid grid-cols-[200px_1fr] gap-4 items-start">
              <div>
                <div className="text-sm font-semibold text-text mb-1">Authentication</div>
                <p className="text-xs text-muted leading-relaxed">Connect your ChatGPT subscription</p>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${keys?.OPENAI_ACCESS_TOKEN ? 'bg-green' : 'bg-muted2'}`} />
                    <span className={`text-sm ${keys?.OPENAI_ACCESS_TOKEN ? 'text-green' : 'text-muted'}`}>
                      {keys?.OPENAI_ACCESS_TOKEN ? 'Connected' : 'Not connected'}
                    </span>
                  </div>
                  <button
                    onClick={openOpenAIAuth}
                    className="px-4 py-2 text-sm border border-accent text-accent rounded-lg hover:bg-accent-dim transition-colors font-medium whitespace-nowrap"
                  >
                    {keys?.OPENAI_ACCESS_TOKEN ? '↻ Re-authorize' : '⟶ Connect OpenAI Account'}
                  </button>
                  {keys?.OPENAI_ACCESS_TOKEN && (
                    <button
                      onClick={doRefreshOpenAI}
                      disabled={openaiRefreshing}
                      className="text-xs text-muted hover:text-text transition-colors underline whitespace-nowrap disabled:opacity-40"
                    >
                      {openaiRefreshing ? 'Refreshing…' : 'Refresh token'}
                    </button>
                  )}
                </div>
                {openaiAuthState && (
                  <div className="bg-bg border border-border rounded-lg p-3 space-y-2">
                    <p className="text-xs text-muted leading-relaxed">
                      An OpenAI auth tab has opened. Complete sign-in, then you'll be redirected to{' '}
                      <span className="font-mono text-muted2">localhost:1455/auth/callback</span>.
                      That page won't load — that's normal. Copy the full URL from your browser bar
                      (or just the <span className="font-mono text-accent">code=</span> value) and paste it below.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Paste code or full redirect URL…"
                        value={openaiCode}
                        onChange={e => setOpenaiCode(e.target.value)}
                        className="flex-1 text-xs font-mono bg-surface2 border border-border rounded-lg px-3 py-2 text-text focus:border-accent outline-none"
                      />
                      <button
                        onClick={submitOpenAICode}
                        disabled={!openaiCode.trim() || openaiExchanging}
                        className="px-3 py-1.5 text-xs border border-green text-green rounded-lg hover:bg-green-dim disabled:opacity-40 disabled:cursor-default transition-colors whitespace-nowrap"
                      >
                        {openaiExchanging ? 'Connecting…' : 'Submit'}
                      </button>
                      <button onClick={() => setOpenaiAuthState(null)} className="text-xs text-muted hover:text-text">✕</button>
                    </div>
                  </div>
                )}
                {openaiAuthMsg && (
                  <p className={`text-xs ${openaiAuthMsg.ok ? 'text-green' : 'text-red'}`}>{openaiAuthMsg.text}</p>
                )}
                <p className="text-xs text-muted/60 leading-relaxed">
                  Uses the OpenAI Codex CLI OAuth client — the same flow used by the official Codex CLI.
                  Your ChatGPT Plus/Pro subscription gives access to GPT-5.4 and other models without per-token API charges.
                </p>
              </div>
            </div>
          )}

          {platformLLM.provider === 'anthropic-subscription' && (
            <div className="grid grid-cols-[200px_1fr] gap-4 items-start">
              <div>
                <div className="text-sm font-semibold text-text mb-1">Authentication</div>
                <p className="text-xs text-muted leading-relaxed">Connect your Claude.ai subscription</p>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${keys?.CLAUDE_SESSION_TOKEN ? 'bg-green' : 'bg-muted2'}`} />
                    <span className={`text-sm ${keys?.CLAUDE_SESSION_TOKEN ? 'text-green' : 'text-muted'}`}>
                      {keys?.CLAUDE_SESSION_TOKEN ? 'Connected' : 'Not connected'}
                    </span>
                  </div>
                  <button
                    onClick={connectClaude}
                    disabled={connectingClaude}
                    className="px-4 py-2 text-sm border border-accent text-accent rounded-lg hover:bg-accent-dim disabled:opacity-40 disabled:cursor-default transition-colors font-medium whitespace-nowrap"
                  >
                    {connectingClaude ? 'Importing…' : keys?.CLAUDE_SESSION_TOKEN ? '↻ Re-import from Claude Code' : '⟶ Import from Claude Code'}
                  </button>
                  <button
                    onClick={startManualAuth}
                    className="text-xs text-muted hover:text-text transition-colors underline whitespace-nowrap"
                  >
                    or authorize manually
                  </button>
                </div>
                {manualAuthState && (
                  <div className="bg-bg border border-border rounded-lg p-3 space-y-2">
                    <p className="text-xs text-muted leading-relaxed">
                      A claude.ai auth tab has opened. After authorizing, you'll be redirected to <span className="font-mono text-muted2">console.anthropic.com</span>.
                      Copy the <span className="font-mono text-accent">code=</span> value from the URL (or paste the full URL) and submit below.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Paste code or full redirect URL…"
                        value={manualCode}
                        onChange={e => setManualCode(e.target.value)}
                        className="flex-1 text-xs font-mono"
                      />
                      <button
                        onClick={submitManualCode}
                        disabled={!manualCode.trim() || exchanging}
                        className="px-3 py-1.5 text-xs border border-green text-green rounded-lg hover:bg-green-dim disabled:opacity-40 disabled:cursor-default transition-colors whitespace-nowrap"
                      >
                        {exchanging ? 'Connecting…' : 'Submit'}
                      </button>
                      <button onClick={() => setManualAuthState(null)} className="text-xs text-muted hover:text-text">✕</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-[200px_1fr] gap-4 items-start">
            <div>
              <div className="text-sm font-semibold text-text mb-1">Model</div>
              <p className="text-xs text-muted leading-relaxed">
                {(platformLLM.provider === 'anthropic' || platformLLM.provider === 'anthropic-subscription') && 'Select a Claude model'}
                {platformLLM.provider === 'openai-subscription' && 'Enter a model ID (e.g. gpt-5.4, gpt-5.4-mini)'}
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
                  {(((platformLLM.provider === 'anthropic' || platformLLM.provider === 'anthropic-subscription') && anthropicModels.length > 0) ||
                    (platformLLM.provider === 'openrouter' && orModels.length > 0)) && (
                    <input
                      autoFocus={modelPickerOpen}
                      type="text"
                      placeholder="Search models..."
                      value={modelSearch}
                      onChange={e => setModelSearch(e.target.value)}
                    />
                  )}

                  {/* Anthropic / Subscription list */}
                  {(platformLLM.provider === 'anthropic' || platformLLM.provider === 'anthropic-subscription') && anthropicModels.length > 0 && (
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

                  {/* OpenAI subscription — known model buttons + free-text */}
                  {platformLLM.provider === 'openai-subscription' && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {[
                          { id: 'gpt-5.4',        label: 'GPT-5.4',        note: 'flagship' },
                          { id: 'gpt-5.4-mini',   label: 'GPT-5.4 mini',   note: 'fast + cheap' },
                          { id: 'gpt-5.3-codex',  label: 'GPT-5.3 Codex',  note: 'coding' },
                          { id: 'gpt-5.2',        label: 'GPT-5.2',        note: 'balanced' },
                          { id: 'gpt-5.1',        label: 'GPT-5.1',        note: 'efficient' },
                        ].map(m => (
                          <button
                            key={m.id}
                            onClick={() => { setPlatformLLMState(prev => ({ ...prev, model: m.id })); setModelPickerOpen(false) }}
                            className={`flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-colors ${
                              platformLLM.model === m.id
                                ? 'border-accent bg-accent-dim text-accent'
                                : 'border-border text-muted hover:border-muted2 hover:text-text'
                            }`}
                          >
                            <span className="text-xs font-mono font-semibold">{m.label}</span>
                            <span className="text-[10px] text-muted/60">{m.note}</span>
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="or type a custom model ID…"
                          value={platformLLM.model}
                          onChange={e => setPlatformLLMState(prev => ({ ...prev, model: e.target.value }))}
                          className="flex-1 text-xs font-mono bg-surface2 border border-border rounded-lg px-3 py-2 text-text focus:border-accent outline-none"
                        />
                      </div>
                    </div>
                  )}

                  {/* Fallback text input when models can't be loaded */}
                  {(((platformLLM.provider === 'anthropic' || platformLLM.provider === 'anthropic-subscription') && anthropicModels.length === 0) ||
                    (platformLLM.provider === 'openrouter' && orModels.length === 0) ||
                    (platformLLM.provider === 'ollama' && ollamaModels.length === 0)) && (
                    <input
                      type="text"
                      placeholder={
                        (platformLLM.provider === 'anthropic' || platformLLM.provider === 'anthropic-subscription') ? 'claude-opus-4-5-20251101 (default)' :
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
        {claudeAuthMsg && (
          <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${claudeAuthMsg.ok ? 'bg-green-dim text-green border border-green/20' : 'bg-red-dim text-red border border-red/20'}`}>
            {claudeAuthMsg.ok ? '✓' : '✗'} {claudeAuthMsg.text}
          </div>
        )}
        <div className="space-y-5">
          {SERVICES.map(s => {
            const isSet = keys[s.envKey]
            const isSaving = saving === s.envKey
            const isTesting = testing === s.envKey
            const result = results[s.envKey]
            const isClaudeToken = s.envKey === 'CLAUDE_SESSION_TOKEN'
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
                  {isClaudeToken && (
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={connectClaude}
                          disabled={connectingClaude}
                          className="px-3 py-1.5 text-xs border border-accent text-accent rounded-lg hover:bg-accent-dim disabled:opacity-40 disabled:cursor-default transition-colors font-medium whitespace-nowrap"
                        >
                          {connectingClaude ? 'Importing…' : isSet ? '↻ Re-import from Claude Code' : '⟶ Import from Claude Code'}
                        </button>
                        <button
                          onClick={startManualAuth}
                          className="text-xs text-muted hover:text-text transition-colors underline whitespace-nowrap"
                        >
                          or authorize manually
                        </button>
                      </div>
                      {manualAuthState && (
                        <div className="bg-bg border border-border rounded-lg p-3 space-y-2">
                          <p className="text-xs text-muted leading-relaxed">
                            A claude.ai auth tab has opened. After authorizing, you'll be redirected to <span className="font-mono text-muted2">console.anthropic.com</span>.
                            Copy the <span className="font-mono text-accent">code=</span> value from the URL (or paste the full URL) and submit below.
                          </p>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="Paste code or full redirect URL…"
                              value={manualCode}
                              onChange={e => setManualCode(e.target.value)}
                              className="flex-1 text-xs font-mono"
                            />
                            <button
                              onClick={submitManualCode}
                              disabled={!manualCode.trim() || exchanging}
                              className="px-3 py-1.5 text-xs border border-green text-green rounded-lg hover:bg-green-dim disabled:opacity-40 disabled:cursor-default transition-colors whitespace-nowrap"
                            >
                              {exchanging ? 'Connecting…' : 'Submit'}
                            </button>
                            <button onClick={() => setManualAuthState(null)} className="text-xs text-muted hover:text-text">✕</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
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
