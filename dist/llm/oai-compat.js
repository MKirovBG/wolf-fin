// Wolf-Fin — Shared OpenAI-compatible wire types and translators
// Used by both OpenRouter and Ollama providers.
// ── JSON repair for malformed LLM tool-call arguments ────────────────────────
function repairJSON(raw) {
    let s = raw.trim();
    // Replace single quotes with double quotes (but not inside already-quoted strings)
    s = s.replace(/'/g, '"');
    // Remove trailing commas before } or ]
    s = s.replace(/,\s*([}\]])/g, '$1');
    // Wrap unquoted keys: { key: "value" } → { "key": "value" }
    s = s.replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":');
    return s;
}
// ── Translators ───────────────────────────────────────────────────────────────
export function toOAITools(tools) {
    return (tools ?? []).map(t => ({
        type: 'function',
        function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
        },
    }));
}
export function toOAIMessages(system, messages) {
    const result = [{ role: 'system', content: system }];
    for (const msg of messages) {
        if (msg.role === 'user') {
            if (typeof msg.content === 'string') {
                result.push({ role: 'user', content: msg.content });
            }
            else {
                const blocks = msg.content;
                const textBlocks = blocks.filter(b => b.type === 'text');
                const toolResults = blocks.filter(b => b.type === 'tool_result');
                if (textBlocks.length > 0) {
                    result.push({ role: 'user', content: textBlocks.map(b => b.text).join('\n') });
                }
                for (const tr of toolResults) {
                    result.push({
                        role: 'tool',
                        tool_call_id: tr.tool_use_id,
                        content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
                    });
                }
            }
        }
        else if (msg.role === 'assistant') {
            if (typeof msg.content === 'string') {
                result.push({ role: 'assistant', content: msg.content });
            }
            else {
                const blocks = msg.content;
                const textBlocks = blocks.filter(b => b.type === 'text');
                const toolUseBlocks = blocks.filter(b => b.type === 'tool_use');
                const assistantMsg = {
                    role: 'assistant',
                    content: textBlocks.map(b => b.text).join('\n') || null,
                };
                if (toolUseBlocks.length > 0) {
                    assistantMsg.tool_calls = toolUseBlocks.map(b => ({
                        id: b.id,
                        type: 'function',
                        function: { name: b.name, arguments: JSON.stringify(b.input) },
                    }));
                }
                result.push(assistantMsg);
            }
        }
    }
    return result;
}
export function fromOAIResponse(res) {
    const choice = res.choices[0];
    const msg = choice.message;
    const content = [];
    if (msg.content) {
        content.push({ type: 'text', text: msg.content });
    }
    for (const tc of msg.tool_calls ?? []) {
        let input;
        try {
            input = JSON.parse(tc.function.arguments);
        }
        catch {
            // Attempt lightweight repair: trailing commas, single quotes, unquoted keys
            const repaired = repairJSON(tc.function.arguments);
            try {
                input = JSON.parse(repaired);
                console.warn(`[llm] Repaired malformed JSON for tool "${tc.function.name}": ${tc.function.arguments.slice(0, 200)}`);
            }
            catch {
                console.warn(`[llm] Unparseable tool call JSON for "${tc.function.name}": ${tc.function.arguments.slice(0, 200)}`);
                const TRADE_TOOLS = ['place_order', 'close_position', 'modify_position', 'cancel_order'];
                if (TRADE_TOOLS.includes(tc.function.name)) {
                    // For trade actions, mark as parse error so agent loop can reject safely
                    input = { _parse_error: true, _raw: tc.function.arguments.slice(0, 300) };
                }
                else {
                    input = {};
                }
            }
        }
        content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
    }
    return {
        stop_reason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
        content,
        usage: { input_tokens: res.usage.prompt_tokens, output_tokens: res.usage.completion_tokens },
    };
}
//# sourceMappingURL=oai-compat.js.map