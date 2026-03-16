// Wolf-Fin — LLM provider abstraction types
// Canonical internal format mirrors Anthropic SDK so the agent loop is provider-agnostic.

import type Anthropic from '@anthropic-ai/sdk'

export interface LLMResponse {
  stop_reason: 'end_turn' | 'tool_use'
  content: Array<Anthropic.TextBlock | Anthropic.ToolUseBlock>
  usage: { input_tokens: number; output_tokens: number }
}

export interface LLMCreateParams {
  model: string
  max_tokens: number
  system: string
  tools: Anthropic.Tool[]
  messages: Anthropic.MessageParam[]
}

export interface LLMProvider {
  createMessage(params: LLMCreateParams): Promise<LLMResponse>
}
