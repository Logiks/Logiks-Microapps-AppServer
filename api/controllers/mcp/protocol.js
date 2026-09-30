//JSON-RPC 2.0 / MCP wire-format helpers
//Kept transport-agnostic - handler.js owns the HTTP specifics (headers, SSE),
//this file only knows about the JSON-RPC envelope and MCP error codes.

const MCP_PROTOCOL_VERSION = "2025-06-18";

const JSONRPC_ERRORS = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603
};

function readRequestBody(req, limitBytes = 5 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;

        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > limitBytes) {
                reject(new Error("Request body too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });

        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}

//Accepts a single JSON-RPC message or a batch array; always returns an array
function parseJsonRpc(raw) {
    if (!raw || raw.trim().length === 0) return { ok: true, messages: [] };

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        return { ok: false, error: buildError(null, JSONRPC_ERRORS.PARSE_ERROR, "Parse error") };
    }

    const messages = Array.isArray(parsed) ? parsed : [parsed];

    for (const msg of messages) {
        if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
            return { ok: false, error: buildError(msg && msg.id !== undefined ? msg.id : null, JSONRPC_ERRORS.INVALID_REQUEST, "Invalid Request") };
        }
    }

    return { ok: true, messages };
}

//Per JSON-RPC 2.0, a message with no `id` member is a notification -
//no response is expected (or permitted) for it.
function isNotification(msg) {
    return !("id" in msg);
}

function buildResult(id, result) {
    return { jsonrpc: "2.0", id, result };
}

function buildError(id, code, message, data) {
    const err = { code, message };
    if (data !== undefined) err.data = data;
    return { jsonrpc: "2.0", id: id === undefined ? null : id, error: err };
}

//MCP tools/call result shape - a content array of typed blocks.
//Tool handlers return plain JS values; the registry wraps them with these.
function toolResult(data) {
    return {
        content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }]
    };
}

function toolError(message) {
    return {
        content: [{ type: "text", text: message }],
        isError: true
    };
}

function writeJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
    });
    res.end(body);
}

module.exports = {
    MCP_PROTOCOL_VERSION,
    JSONRPC_ERRORS,
    readRequestBody,
    parseJsonRpc,
    isNotification,
    buildResult,
    buildError,
    toolResult,
    toolError,
    writeJson
};
