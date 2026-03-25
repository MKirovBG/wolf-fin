// Wolf-Fin — OpenAI subscription LLM provider (ChatGPT OAuth token)
// Uses chatgpt.com/backend-api/codex/responses (Responses API via SSE streaming).
// Translates Wolf-Fin's Anthropic-format messages ↔ OpenAI Responses API format.

import type Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider, LLMCreateParams, LLMResponse } from './types.js'

const CODEX_URL       = 'https://chatgpt.com/backend-api/codex/responses'
const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CLIENT_ID       = 'app_EMoamEEZ73f0CkXaXp7hrann'

// ── JWT helpers ───────────────────────────────────────────────────────────────

/** Extract chatgpt_account_id from the access token JWT claims. */
function extractAccountId(accessToken: string): string | null {
  try {
    const parts = accessToken.split('.')
    if (parts.length < 2) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>
    // The claim key is "https://api.openai.com/auth" with a nested chatgpt_account_id
    const authClaim = payload['https://api.openai.com/auth'] as Record<string, string> | undefined
    return authClaim?.chatgpt_account_id ?? null
  } catch {
    return null
  }
}

// ── Token refresh ─────────────────────────────────────────────────────────────

export async function refreshOpenAIToken(refreshToken: string): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
}> {
  const res = await fetch(OPENAI_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     CLIENT_ID,
      refresh_token: refreshToken,
    }).toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`OpenAI token refresh failed (${res.status}): ${text}`)
  }
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>
}

// ── Format translation: Anthropic → Responses API ────────────────────────────
// The Responses API uses a flat `input` array containing user/assistant turns
// plus tool call outputs, all interleaved.

type ResponsesAPIInputItem =
  | { role: 'user';      content: string }
  | { role: 'assistant'; content: string }
  // The Responses API requires call_id on function_call items (used to link outputs)
  | { type: 'function_call'; id: string; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string }

function toResponsesAPIInput(messages: Anthropic.MessageParam[]): ResponsesAPIInputItem[] {
  const result: ResponsesAPIInputItem[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        result.push({ role: 'user', content: msg.content })
        continue
      }
      const blocks = msg.content as Array<Anthropic.ContentBlockParam>
      const toolResults = blocks.filter(b => b.type === 'tool_result') as Anthropic.ToolResultBlockParam[]
      const textBlocks  = blocks.filter(b => b.type === 'text') as Anthropic.TextBlockParam[]

      for (const tr of toolResults) {
        // tool_use_id can be undefined at runtime despite the type saying string;
        // JSON.stringify silently drops undefined values → API 400 missing call_id
        const callId = tr.tool_use_id ?? ''
        if (!callId) continue   // skip malformed tool results with no id
        const output = Array.isArray(tr.content)
          ? (tr.content as Anthropic.TextBlockParam[]).map(b => b.text ?? '').join('\n')
          : (tr.content as string | undefined) ?? ''
        result.push({ type: 'function_call_output', call_id: callId, output })
      }
      if (textBlocks.length > 0) {
        result.push({ role: 'user', content: textBlocks.map(b => b.text).join('\n') })
      }
    } else {
      // assistant
      if (typeof msg.content === 'string') {
        result.push({ role: 'assistant', content: msg.content })
        continue
      }
      const blocks = msg.content as Array<Anthropic.TextBlock | Anthropic.ToolUseBlock>
      for (const block of blocks) {
        if (block.type === 'text') {
          if (block.text) result.push({ role: 'assistant', content: block.text })
        } else if (block.type === 'tool_use') {
          result.push({
            type:      'function_call',
            id:        `fc_${block.id}`,  // Responses API requires id to start with 'fc'
            call_id:   block.id,          // actual tool id — matched by function_call_output.call_id
            name:      block.name,
            arguments: JSON.stringify(block.input),
          })
        }
      }
    }
  }

  return result
}

// Tool definitions: Anthropic input_schema → Responses API function format
function toResponsesAPITools(tools: Anthropic.Tool[]) {
  return tools.map(t => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.input_schema as Record<string, unknown>,
    strict: false,
  }))
}

// ── SSE streaming accumulator ─────────────────────────────────────────────────

interface ResponsesDoneEvent {
  type: 'response.done'
  response: {
    status:       string
    output:       ResponsesOutputItem[]
    usage?: { input_tokens: number; output_tokens: number }
  }
}

interface ResponsesOutputItem {
  type:    'message' | 'function_call'
  role?:   string
  content?: Array<{ type: string; text?: string }>
  // function_call fields — API returns both id (item id) and call_id (linking id)
  id?:        string
  call_id?:   string
  name?:      string
  arguments?: string
}

async function consumeSSE(res: Response): Promise<ResponsesDoneEvent['response']> {
  const body = res.body
  if (!body) throw new Error('No response body from Codex API')

  const decoder = new TextDecoder()
  let buffer    = ''
  let doneEvent: ResponsesDoneEvent['response'] | null = null
  let errorMsg:  string | null = null
  const seenTypes: string[] = []

  const reader = body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (raw === '[DONE]') continue
        try {
          const evt = JSON.parse(raw) as {
            type: string
            response?: ResponsesDoneEvent['response']
            error?:    { message?: string; code?: string }
          }
          seenTypes.push(evt.type)
          // Accept both response.done (older) and response.completed (current spec)
          if ((evt.type === 'response.done' || evt.type === 'response.completed') && evt.response) {
            doneEvent = evt.response
          }
          // Capture API-level error events
          if (evt.type === 'response.failed' || evt.type === 'error') {
            errorMsg = evt.error?.message ?? evt.type
          }
        } catch { /* skip malformed line */ }
      }
    }
  } finally {
    reader.releaseLock()
  }

  if (errorMsg) throw new Error(`Codex API error: ${errorMsg}`)
  if (!doneEvent) {
    const seen = seenTypes.length > 0 ? ` (saw: ${[...new Set(seenTypes)].join(', ')})` : ' (no events received)'
    throw new Error(`Codex API stream ended without completion event${seen}`)
  }
  return doneEvent
}

// ── Response translation: Responses API → Anthropic ──────────────────────────

function fromResponsesAPIResponse(
  response: ResponsesDoneEvent['response']
): LLMResponse {
  if (response.status === 'failed' || response.status === 'incomplete') {
    throw new Error(`Codex API response status: ${response.status}`)
  }

  const content: Array<Anthropic.TextBlock | Anthropic.ToolUseBlock> = []
  let hasToolUse = false

  for (const item of response.output ?? []) {
    if (item.type === 'message' && item.content) {
      for (const part of item.content) {
        if (part.type === 'output_text' && part.text) {
          content.push({ type: 'text', text: part.text } as Anthropic.TextBlock)
        }
      }
    } else if (item.type === 'function_call' && item.name) {
      hasToolUse = true
      let input: Record<string, unknown> = {}
      try { input = JSON.parse(item.arguments ?? '{}') } catch { /* ignore */ }
      content.push({
        type:  'tool_use',
        // Use call_id (the linking ID) as our tool_use id so function_call_output.call_id matches
        id:    item.call_id ?? item.id ?? `call_${Date.now()}`,
        name:  item.name,
        input,
      } as Anthropic.ToolUseBlock)
    }
  }

  return {
    stop_reason: hasToolUse ? 'tool_use' : 'end_turn',
    content,
    usage: {
      input_tokens:  response.usage?.input_tokens  ?? 0,
      output_tokens: response.usage?.output_tokens ?? 0,
    },
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class OpenAISubscriptionProvider implements LLMProvider {
  private readonly accountId: string | null

  constructor(private readonly accessToken: string) {
    this.accountId = extractAccountId(accessToken)
  }

  async createMessage(params: LLMCreateParams): Promise<LLMResponse> {
    const headers: Record<string, string> = {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${this.accessToken}`,
      'Accept':        'text/event-stream',
      'OpenAI-Beta':   'responses=experimental',
      'originator':    'pi',
    }
    if (this.accountId) {
      headers['chatgpt-account-id'] = this.accountId
    }

    const body: Record<string, unknown> = {
      model:        params.model,
      stream:       true,
      store:        false,
      instructions: params.system,
      input:        toResponsesAPIInput(params.messages),
      text:         { verbosity: 'medium' },
    }
    if (params.tools.length > 0) {
      body.tools        = toResponsesAPITools(params.tools)
      body.tool_choice  = 'auto'
      // parallel_tool_calls disabled: prevents two order/close calls firing before
      // guardrails can inspect the first result (safer for live trading)
      body.parallel_tool_calls = false
    }

    const res = await fetch(CODEX_URL, {
      method:  'POST',
      headers,
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(90_000),   // 90 s — prevents hung tick loops
    })

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(`OpenAI subscription API ${res.status}: ${text}`)
    }

    const response = await consumeSSE(res)
    return fromResponsesAPIResponse(response)
  }
}
