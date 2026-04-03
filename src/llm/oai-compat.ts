// Wolf-Fin — Shared OpenAI-compatible wire types and translators
// Used by both OpenRouter and Ollama providers.

import type Anthropic from '@anthropic-ai/sdk'
import type { LLMResponse } from './types.js'

// ── JSON repair for malformed LLM tool-call arguments ────────────────────────

function repairJSON(raw: string): string {
  let s = raw.trim()
  // Replace single quotes with double quotes (but not inside already-quoted strings)
  s = s.replace(/'/g, '"')
  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, '$1')
  // Wrap unquoted keys: { key: "value" } → { "key": "value" }
  s = s.replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":')
  return s
}

// ── OpenAI-compatible wire types ──────────────────────────────────────────────

export interface OAITool {
  type: 'function'
  function: { name: string; description?: string; parameters: Record<string, unknown> }
}

export interface OAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

export interface OAIResponse {
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

export function toOAITools(tools: Anthropic.Tool[] | undefined): OAITool[] {
  return (tools ?? []).map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>,
    },
  }))
}

export function toOAIMessages(system: string, messages: Anthropic.MessageParam[]): OAIMessage[] {
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

export function fromOAIResponse(res: OAIResponse): LLMResponse {
  const choice = res.choices[0]
  const msg = choice.message
  const content: Array<Anthropic.TextBlock | Anthropic.ToolUseBlock> = []

  if (msg.content) {
    content.push({ type: 'text', text: msg.content } as Anthropic.TextBlock)
  }

  for (const tc of msg.tool_calls ?? []) {
    let input: Record<string, unknown>
    try {
      input = JSON.parse(tc.function.arguments) as Record<string, unknown>
    } catch {
      // Attempt lightweight repair: trailing commas, single quotes, unquoted keys
      const repaired = repairJSON(tc.function.arguments)
      try {
        input = JSON.parse(repaired) as Record<string, unknown>
        console.warn(`[llm] Repaired malformed JSON for tool "${tc.function.name}": ${tc.function.arguments.slice(0, 200)}`)
      } catch {
        console.warn(`[llm] Unparseable tool call JSON for "${tc.function.name}": ${tc.function.arguments.slice(0, 200)}`)
        const TRADE_TOOLS = ['place_order', 'close_position', 'modify_position', 'cancel_order']
        if (TRADE_TOOLS.includes(tc.function.name)) {
          // For trade actions, mark as parse error so agent loop can reject safely
          input = { _parse_error: true, _raw: tc.function.arguments.slice(0, 300) }
        } else {
          input = {}
        }
      }
    }
    content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input } as Anthropic.ToolUseBlock)
  }

  return {
    stop_reason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
    content,
    usage: { input_tokens: res.usage.prompt_tokens, output_tokens: res.usage.completion_tokens },
  }
}
