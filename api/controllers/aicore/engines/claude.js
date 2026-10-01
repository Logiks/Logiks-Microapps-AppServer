//Claude Integration Layer for AICore - Anthropic Messages API.
//Speaks the real Messages API tool-use protocol: tools are sent as
//{name, description, input_schema}, a pending tool call comes back as a
//`tool_use` content block with stop_reason "tool_use", and the result is
//sent back as a `tool_result` content block inside a user-role message.
//This is the same multi-turn loop Claude Code itself is built on - AICore
//just drives it from agentLoop.js instead of a coding-agent harness.

const AIEngine = require("./aiengine");
const Anthropic = require("@anthropic-ai/sdk");

const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_MAX_TOKENS = 4096;

module.exports = class Claude extends AIEngine {

    __name() {
        return "claude";
    }

    _client() {
        if (!this._anthropic) {
            this._anthropic = new Anthropic({ apiKey: this.params.apikey });
        }
        return this._anthropic;
    }

    async sendMessage(sessId, messages, tools = [], userInfo = {}, params = {}) {
        const client = this._client();

        const systemPrompt = messages
            .filter(m => m.role === "system")
            .map(m => m.content)
            .join("\n\n") || undefined;

        const anthropicMessages = toAnthropicMessages(messages.filter(m => m.role !== "system"));
        const anthropicTools = tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema || { type: "object", properties: {} }
        }));

        const response = await client.messages.create({
            model: params.model || this.params.model || DEFAULT_MODEL,
            max_tokens: params.maxTokens || this.params.maxTokens || DEFAULT_MAX_TOKENS,
            system: systemPrompt,
            messages: anthropicMessages,
            tools: anthropicTools.length ? anthropicTools : undefined
        });

        const toolCalls = response.content
            .filter(block => block.type === "tool_use")
            .map(block => ({ id: block.id, name: block.name, arguments: block.input }));

        const message = response.content
            .filter(block => block.type === "text")
            .map(block => block.text)
            .join("\n");

        return {
            message,
            toolCalls,
            usage: {
                inputTokens: response.usage?.input_tokens || 0,
                outputTokens: response.usage?.output_tokens || 0
            },
            raw: response
        };
    }
}

//Translates the generic {role, content, toolCalls?, toolCallId?} shape into
//Anthropic's content-block message array. Assistant tool calls become
//`tool_use` blocks; tool results become `tool_result` blocks nested inside
//a user-role message, exactly as the Messages API requires.
function toAnthropicMessages(messages) {
    const out = [];

    for (const m of messages) {
        if (m.role === "assistant") {
            const content = [];
            if (m.content) content.push({ type: "text", text: m.content });
            for (const call of (m.toolCalls || [])) {
                content.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments });
            }
            out.push({ role: "assistant", content });
        } else if (m.role === "tool") {
            out.push({
                role: "user",
                content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: String(m.content ?? "") }]
            });
        } else {
            out.push({ role: "user", content: toAnthropicContent(m.content) });
        }
    }

    return out;
}

//Plain string stays a string (the SDK accepts that); an array of generic
//{type:"text"}/{type:"image"} parts (see aiengine.js) becomes Anthropic's
//own content-block shape for multimodal input.
function toAnthropicContent(content) {
    if (typeof content === "string" || content == null) return content;

    if (Array.isArray(content)) {
        return content.map(part => {
            if (part.type === "image") {
                return { type: "image", source: { type: "base64", media_type: part.mimeType, data: part.data } };
            }
            return { type: "text", text: part.text };
        });
    }

    return String(content);
}
