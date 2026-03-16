// Wolf-Fin — OpenRouter LLM provider (OpenAI-compatible API)
// Translates between Anthropic message format (internal canonical) and OpenAI format.

import type Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider, LLMCreateParams, LLMResponse } from './types.js'

// ── OpenAI-compatible wire types ──────────────────────────────────────────────

interface OAITool {
  type: 'function'
  function: { name: string; description?: string; parameters: Record<string, unknown> }
}

interface OAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

interface OAIResponse {
  choices: Array<{
    finish_reason: string
    message: {
      role: 'assistant'
      content: string | null
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
    }
  }>
  usage: { prompt_tokens: number; completion_tokens: number }
}

// ── Translators ───────────────────────────────────────────────────────────────

function toOAITools(tools: Anthropic.Tool[]): OAITool[] {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>,
    },
  }))
}

function toOAIMessages(system: string, messages: Anthropic.MessageParam[]): OAIMessage[] {
  const result: OAIMessage[] = [{ role: 'system', content: system }]

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        result.push({ role: 'user', content: msg.content })
      } else {
        const blocks = msg.content as Anthropic.ContentBlockParam[]
        const textBlocks = blocks.filter(b => b.type === 'text') as Anthropic.TextBlockParam[]
        const toolResults = blocks.filter(b => b.type === 'tool_result') as Anthropic.ToolResultBlockParam[]

        if (textBlocks.length > 0) {
          result.push({ role: 'user', content: textBlocks.map(b => b.text).join('\n') })
        }
        for (const tr of toolResults) {
          result.push({
            role: 'tool',
            tool_call_id: tr.tool_use_id,
            content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
          })
        }
      }
    } else if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        result.push({ role: 'assistant', content: msg.content })
      } else {
        const blocks = msg.content as Array<Anthropic.TextBlock | Anthropic.ToolUseBlock>
        const textBlocks = blocks.filter(b => b.type === 'text') as Anthropic.TextBlock[]
        const toolUseBlocks = blocks.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[]

        const assistantMsg: OAIMessage = {
          role: 'assistant',
          content: textBlocks.map(b => b.text).join('\n') || null,
        }
        if (toolUseBlocks.length > 0) {
          assistantMsg.tool_calls = toolUseBlocks.map(b => ({
            id: b.id,
            type: 'function' as const,
            function: { name: b.name, arguments: JSON.stringify(b.input) },
          }))
        }
        result.push(assistantMsg)
      }
    }
  }

  return result
}

function fromOAIResponse(res: OAIResponse): LLMResponse {
  const choice = res.choices[0]
  const msg = choice.message
  const content: Array<Anthropic.TextBlock | Anthropic.ToolUseBlock> = []

  if (msg.content) {
    content.push({ type: 'text', text: msg.content } as Anthropic.TextBlock)
  }

  for (const tc of msg.tool_calls ?? []) {
    let input: Record<string, unknown>
    try { input = JSON.parse(tc.function.arguments) as Record<string, unknown> }
    catch { input = {} }
    content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input } as Anthropic.ToolUseBlock)
  }

  return {
    stop_reason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
    content,
    usage: { input_tokens: res.usage.prompt_tokens, output_tokens: res.usage.completion_tokens },
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class OpenRouterProvider implements LLMProvider {
  constructor(private readonly apiKey: string) {}

  async createMessage(params: LLMCreateParams): Promise<LLMResponse> {
    const body = {
      model: params.model,
      max_tokens: params.max_tokens,
      messages: toOAIMessages(params.system, params.messages),
      tools: toOAITools(params.tools),
      tool_choice: 'auto',
    }

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://wolf-fin.local',
        'X-Title': 'Wolf-Fin Trading Agent',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`OpenRouter API error ${res.status}: ${err}`)
    }

    const data = await res.json() as OAIResponse
    return fromOAIResponse(data)
  }
}
