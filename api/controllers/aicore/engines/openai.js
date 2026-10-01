//OpenAI Integration Layer for AICore - Responses API.
//The Responses API is OpenAI's current agentic-oriented surface: tools are
//sent as {type:"function", name, description, parameters}, a pending call
//comes back as a `function_call` output item, and the result is sent back
//as a `function_call_output` input item on the next turn. Same caller-drives
//the-loop model as Claude/LogiksAI - just OpenAI's own wire shape.

const AIEngine = require("./aiengine");
const OpenAI = require("openai");

const DEFAULT_MODEL = "gpt-4.1";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

module.exports = class OpenAIEngine extends AIEngine {

    __name() {
        return "openai";
    }

    _client() {
        if (!this._openai) {
            this._openai = new OpenAI({ apiKey: this.params.apikey });
        }
        return this._openai;
    }

    async sendMessage(sessId, messages, tools = [], userInfo = {}, params = {}) {
        const client = this._client();

        const instructions = messages
            .filter(m => m.role === "system")
            .map(m => m.content)
            .join("\n\n") || undefined;

        const input = toResponseInput(messages.filter(m => m.role !== "system"));
        const openaiTools = tools.map(t => ({
            type: "function",
            name: t.name,
            description: t.description,
            parameters: t.inputSchema || { type: "object", properties: {} }
        }));

        const response = await client.responses.create({
            model: params.model || this.params.model || DEFAULT_MODEL,
            instructions,
            input,
            tools: openaiTools.length ? openaiTools : undefined
        });

        const toolCalls = (response.output || [])
            .filter(item => item.type === "function_call")
            .map(item => ({
                id: item.call_id,
                name: item.name,
                arguments: safeParse(item.arguments)
            }));

        return {
            message: response.output_text || "",
            toolCalls,
            usage: {
                inputTokens: response.usage?.input_tokens || 0,
                outputTokens: response.usage?.output_tokens || 0
            },
            raw: response
        };
    }

    async embed(input, params = {}) {
        const client = this._client();
        const response = await client.embeddings.create({
            model: params.model || this.params.embeddingModel || DEFAULT_EMBEDDING_MODEL,
            input
        });
        return response.data.map(d => d.embedding);
    }
}

//Translates the generic {role, content, toolCalls?, toolCallId?} shape into
//Responses API input items - assistant tool calls become `function_call`
//items, tool results become `function_call_output` items.
function toResponseInput(messages) {
    const out = [];

    for (const m of messages) {
        if (m.role === "assistant") {
            if (m.content) out.push({ role: "assistant", content: m.content });
            for (const call of (m.toolCalls || [])) {
                out.push({
                    type: "function_call",
                    call_id: call.id,
                    name: call.name,
                    arguments: JSON.stringify(call.arguments || {})
                });
            }
        } else if (m.role === "tool") {
            out.push({
                type: "function_call_output",
                call_id: m.toolCallId,
                output: String(m.content ?? "")
            });
        } else {
            out.push({ role: "user", content: toResponseContent(m.content) });
        }
    }

    return out;
}

//Plain string stays a string; an array of generic {type:"text"}/{type:"image"}
//parts (see aiengine.js) becomes the Responses API's own input_text/input_image
//content items for multimodal input.
function toResponseContent(content) {
    if (typeof content === "string" || content == null) return content;

    if (Array.isArray(content)) {
        return content.map(part => {
            if (part.type === "image") {
                return { type: "input_image", image_url: `data:${part.mimeType};base64,${part.data}` };
            }
            return { type: "input_text", text: part.text };
        });
    }

    return String(content);
}

function safeParse(jsonStr) {
    try {
        return JSON.parse(jsonStr || "{}");
    } catch (e) {
        return {};
    }
}
