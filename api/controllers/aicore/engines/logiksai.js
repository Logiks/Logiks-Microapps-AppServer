//LogiksAI Integration Layer for AICore.
//
//LogiksAI is confirmed to expose a native tool-use protocol (a tools list
//goes in, structured tool-call requests come back) - the same caller-drives-
//the-loop shape as Claude/OpenAI, so it plugs into agentLoop.js the same
//way. The request/response field names below are a best-effort mapping
//against CONFIG.aicore's {url, apikey, appid} shape and are NOT yet
//confirmed against LogiksAI's actual API reference - treat this file as a
//stub-with-a-real-shape until that reference (or a sample request/response)
//is available to verify field names against.

const AIEngine = require("./aiengine");

module.exports = class LogiksAI extends AIEngine {

    __name() {
        return "logiksai";
    }

    async sendMessage(sessId, messages, tools = [], userInfo = {}, params = {}) {
        const url = (this.params.url || "").replace(/\/$/, "") + "/chat";

        const payload = {
            appid: this.params.appid,
            sessionId: sessId,
            messages: messages.map(toLogiksAIMessage),
            tools: tools.map(t => ({
                name: t.name,
                description: t.description,
                parameters: t.inputSchema || { type: "object", properties: {} }
            })),
            user: { id: userInfo.userId || userInfo.id, guid: userInfo.guid },
            params: params || {}
        };

        let response;
        try {
            response = await axios({
                url,
                method: "POST",
                headers: { "Authorization": `Bearer ${this.params.apikey}` },
                data: payload,
                timeout: params.timeout_ms || 30000
            });
        } catch (err) {
            const error = new Error(`LogiksAI request failed: ${err.message}`);
            error.cause = err;
            error.status = err.response?.status;//lets resilience.js tell request errors from engine failures
            throw error;
        }

        const data = response.data || {};

        return {
            message: data.message || data.content || "",
            toolCalls: (data.toolCalls || data.tool_calls || []).map(call => ({
                id: call.id,
                name: call.name,
                arguments: call.arguments || call.input || {}
            })),
            usage: {
                inputTokens: data.usage?.inputTokens || data.usage?.input_tokens || 0,
                outputTokens: data.usage?.outputTokens || data.usage?.output_tokens || 0
            },
            raw: data
        };
    }
}

function toLogiksAIMessage(m) {
    if (m.role === "assistant") {
        return { role: "assistant", content: m.content || "", toolCalls: m.toolCalls || [] };
    }
    if (m.role === "tool") {
        return { role: "tool", toolCallId: m.toolCallId, name: m.name, content: String(m.content ?? "") };
    }
    return { role: m.role, content: m.content };
}
