//LogiksAI Integration Layer for AICore.
//
//Wire protocol (from the server's own /public/openapi.json):
//
//  - Auth: every call carries `Authorization: Bearer <apikey>`. A global key
//    also needs an `auth-token` JWT, minted per caller with
//    POST /generateToken {guid, uuid} - guid is the tenant, uuid the user, so
//    LogiksAI sees (and scopes personas, memory and history to) the real
//    AppServer user. Tokens are cached per guid+uuid until shortly before expiry.
//
//  - The server holds the conversation. POST /msg {msg, channel, persona,
//    tools_available} + `sesskey` header starts/continues a session, so only
//    the newest user message is sent, not the replayed history.
//
//  - Tools are caller-executed ("tools forwarding"): tools_available is a list
//    of MCP-shaped definitions with no server-side implementation. When the
//    model calls one the turn pauses and answers
//    data: { STATUS: "tool_call_pending", PENDING_TOOL_CALLS: [{id, name, input}], PENDING_TOKEN }.
//    We hand those to agentLoop as toolCalls, and when the loop comes back
//    with the results we resume via POST /msg/continue
//    {sesskey, pending_token, tool_results: {<id>: <result>}}.
//    The LogiksAI persona used must have tools_forwarding switched on.
//
//config: { url, apikey, appid (optional), persona (default "assistant"), channel (default "aicore") }

const AIEngine = require("./aiengine");

const TOKEN_SKEW_SECONDS = 60;

module.exports = class LogiksAI extends AIEngine {

    constructor(params = {}) {
        super(params);
        this.tokens = new Map();//"guid|uuid" -> { token, exp (epoch seconds) }
        this.pending = new Map();//sessId -> { pendingToken, ids: [toolCallId] }
    }

    __name() {
        return "logiksai";
    }

    baseUrl() {
        return (this.params.url || "").replace(/\/+$/, "");
    }

    //Mints (or reuses) the JWT for this tenant+user. uuid is the logged-in
    //userId; an anonymous caller falls back to LogiksAI's own "guest".
    async getToken(guid, uuid, force = false) {
        const cacheKey = `${guid || ""}|${uuid || ""}`;
        const cached = this.tokens.get(cacheKey);
        if (!force && cached && cached.exp - TOKEN_SKEW_SECONDS > Date.now() / 1000) return cached.token;

        const res = await this.request("POST", "/generateToken", null, { guid, uuid: uuid || "guest" }, {}, 10000);
        const token = res.token;
        if (!token) throw requestError("LogiksAI generateToken returned no token", 401);

        this.tokens.set(cacheKey, { token, exp: tokenExpiry(token, res.expiresIn) });
        return token;
    }

    async sendMessage(sessId, messages, tools = [], userInfo = {}, params = {}) {
        const guid = userInfo.guid;
        const uuid = userInfo.userId || userInfo.id;
        if (!guid) throw requestError("LogiksAI needs the caller's guid to mint a token", 400);

        const resume = this.resumeFor(sessId, messages);
        const timeout = params.timeout_ms || 60000;

        let data;
        try {
            data = await this.call(guid, uuid, sessId, resume, messages, tools, params, timeout);
        } catch (err) {
            //An expired/rejected token: mint a fresh one and retry once.
            if (!isAuthFailure(err.status, err.message)) throw err;
            data = await this.retryWithFreshToken(guid, uuid, sessId, resume, messages, tools, params, timeout);
        }

        //LogiksAI can also answer 200 with an error body for a bad token
        if (data.status === "error" && isAuthFailure(null, JSON.stringify(data.errors || ""))) {
            data = await this.retryWithFreshToken(guid, uuid, sessId, resume, messages, tools, params, timeout);
        }

        if (data.status === "error") {
            const detail = typeof data.errors === "string" ? data.errors : JSON.stringify(data.errors || data.msg || "");
            //Refusals (unknown persona, bad pending token, filtered input...) are answers to this request, not engine outages
            throw requestError(`LogiksAI refused the request: ${detail}`, 400);
        }

        const out = data.data || {};
        this.pending.delete(sessId);

        if (out.STATUS === "tool_call_pending") {
            const calls = out.PENDING_TOOL_CALLS || [];
            this.pending.set(sessId, { pendingToken: out.PENDING_TOKEN, ids: calls.map(c => c.id) });
            return {
                message: "",
                toolCalls: calls.map(c => ({ id: c.id, name: c.name, arguments: c.input || {} })),
                usage: usageOf(out),
                raw: data
            };
        }

        return {
            message: out.RESPONSE || "",
            toolCalls: [],
            usage: usageOf(out),
            raw: data
        };
    }

    async retryWithFreshToken(guid, uuid, sessId, resume, messages, tools, params, timeout) {
        this.tokens.delete(`${guid}|${uuid || ""}`);
        return await this.call(guid, uuid, sessId, resume, messages, tools, params, timeout, true);
    }

    //The last messages being tool results means the loop is answering a pending pause.
    resumeFor(sessId, messages) {
        const last = messages[messages.length - 1];
        if (!last || last.role !== "tool") return null;

        const pending = this.pending.get(sessId);
        if (!pending) throw requestError("LogiksAI: tool results arrived with no pending tool call for this session", 400);

        const results = {};
        for (let i = messages.length - 1; i >= 0 && messages[i].role === "tool"; i--) {
            results[messages[i].toolCallId] = parseResult(messages[i].content);
        }
        const missing = pending.ids.filter(id => !(id in results));
        if (missing.length) throw requestError(`LogiksAI: missing results for tool calls ${missing.join(", ")}`, 400);

        return { pending_token: pending.pendingToken, tool_results: results };
    }

    async call(guid, uuid, sessId, resume, messages, tools, params, timeout, forceToken = false) {
        const token = await this.getToken(guid, uuid, forceToken);
        const headers = { "auth-token": token, "sesskey": sessId };
        if (this.params.appid) headers.appid = this.params.appid;

        if (resume) {
            return await this.request("POST", "/msg/continue", headers, { sesskey: sessId, ...resume }, params, timeout);
        }

        const userMessage = [...messages].reverse().find(m => m.role === "user");
        const systemMessage = messages.find(m => m.role === "system");
        const body = {
            msg: textOf(userMessage?.content),
            channel: this.params.channel || "aicore",
            persona: params.persona || this.params.persona || "assistant",
            tools_available: tools.map(t => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema || { type: "object", properties: {} }
            }))
        };
        if (params.model) body.model = params.model;
        if (params.provider) body.provider = params.provider;
        //Only honoured by LogiksAI when the application allows it in requests; ignored otherwise
        if (systemMessage?.content) body.system_message = systemMessage.content;

        return await this.request("POST", "/msg", headers, body, params, timeout);
    }

    async request(method, path, headers, data, params, timeout) {
        let response;
        try {
            response = await axios({
                url: this.baseUrl() + path,
                method,
                headers: { "Authorization": `Bearer ${this.params.apikey}`, ...(headers || {}) },
                data,
                timeout
            });
        } catch (err) {
            //LogiksAI reports 401/403 as {code, message}; keep that text rather than axios's generic one
            const detail = err.response?.data?.message || err.message;
            const error = requestError(`LogiksAI request failed: ${detail}`, err.response?.status);
            error.cause = err;
            throw error;
        }
        return response.data || {};
    }
}

function isAuthFailure(status, text) {
    if (status === 401 || status === 403) return true;
    return /auth-token|token (is )?(invalid|expired)|invalid token|expired token|unauthori[sz]ed/i.test(text || "");
}

function requestError(message, status) {
    const error = new Error(message);
    error.status = status;//lets resilience.js tell request errors from engine failures
    return error;
}

//Token expiry in epoch seconds: prefer the JWT's own exp claim, since the
//server's `expiresIn` field has been seen as an absolute timestamp, not a duration.
function tokenExpiry(token, expiresIn) {
    try {
        const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
        if (claims.exp) return claims.exp;
    } catch (e) { /* fall through */ }
    const n = Number(expiresIn) || 0;
    return n > 1e9 ? n : Date.now() / 1000 + (n || 300);
}

function parseResult(content) {
    if (content && typeof content === "object") return content;
    try {
        const parsed = JSON.parse(content);
        return parsed && typeof parsed === "object" ? parsed : { result: parsed };
    } catch (e) {
        return { result: String(content ?? "") };
    }
}

function textOf(content) {
    if (Array.isArray(content)) return content.filter(p => p.type === "text").map(p => p.text).join("\n");
    return String(content ?? "");
}

function usageOf(out) {
    const u = out.USAGE || out.usage || {};
    return {
        inputTokens: u.inputTokens || u.input_tokens || u.prompt_tokens || 0,
        outputTokens: u.outputTokens || u.output_tokens || u.completion_tokens || 0
    };
}
