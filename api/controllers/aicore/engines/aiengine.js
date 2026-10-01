//Default AI Engine Interface.
//Every concrete engine (logiksai.js, openai.js, claude.js) extends this and
//translates the generic `messages`/`tools` shape below into that provider's
//own native wire protocol, then translates the native response back into
//this shape. agentLoop.js only ever talks to this shape - it never needs to
//know which provider is underneath.
//
// messages: [
//   { role: "system", content: "..." },
//   { role: "user", content: "..." },
//   // or, for multimodal input (summerize/describe/ocr/extract on an image):
//   { role: "user", content: [{ type: "text", text: "..." }, { type: "image", mimeType: "image/png", data: "<base64>" }] },
//   { role: "assistant", content: "...", toolCalls: [{id, name, arguments}] },
//   { role: "tool", toolCallId: "...", name: "...", content: "..." }
// ]
// tools: MCP tool definitions as returned by REGISTRY.listTools() -
//   [{ name, description, inputSchema }]
//
//Return shape all sendMessage() implementations must produce:
// {
//   message: "final assistant text, empty string while tool calls are pending",
//   toolCalls: [{ id, name, arguments }],   // empty array when the model is done
//   usage: { inputTokens, outputTokens },
//   raw: <untouched provider response, for logging/debugging>
// }
module.exports = class AIEngine {

    constructor(params = {}) {
        this.params = params;
    }

    __name() {
        return "aiengine";
    }

    async sendMessage(sessId, messages, tools, userInfo, params = {}) {
        return { message: "", toolCalls: [], usage: {}, raw: null };
    }

    //Optional - only engines with a real embeddings API override this.
    //AICore's embed() tries engines in priority order and skips any that
    //throw here, so this default is what makes an engine get skipped.
    async embed(input, params = {}) {
        throw new Error(`AICore: engine '${this.__name()}' does not support embeddings`);
    }
}
