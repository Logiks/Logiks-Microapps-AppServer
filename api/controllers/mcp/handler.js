//Raw HTTP entry point for MCP (Streamable HTTP transport).
//Meant to be wired into api/server.js as a custom alias handler on its own
//route group, the same way FABRIC.forwardRequest is wired for /fabric - see
//that route group's `aliases` block for the pattern. With bodyParsers:false
//on that route, moleculer-web hands us the raw req/res untouched, and
//authentication/authorization still run beforehand (populating req.$ctx.meta
//per the /fabric route), so req.$ctx is available here exactly like in
//fabric.js.
//
//  POST /mcp   - JSON-RPC request/notification (initialize, tools/list, tools/call, ...)
//  GET  /mcp   - opens the SSE stream for server -> client notifications
//  DELETE /mcp - client-initiated session termination

const PROTOCOL = require("./protocol.js");
const SESSION = require("./session.js");
const REGISTRY = require("./registry.js");

const SESSION_HEADER = "mcp-session-id";

module.exports = {
    handleRequest: async function (req, res) {
        try {
            switch (req.method) {
                case "OPTIONS":
                    return handleOptions(res);
                case "POST":
                    return await handlePost(req, res);
                case "GET":
                    return handleStream(req, res);
                case "DELETE":
                    return handleDelete(req, res);
                default:
                    res.writeHead(405, { "Allow": "GET, POST, DELETE, OPTIONS" });
                    return res.end();
            }
        } catch (err) {
            console.error("MCP handler error", err);
            if (!res.headersSent) {
                PROTOCOL.writeJson(res, 500, PROTOCOL.buildError(null, PROTOCOL.JSONRPC_ERRORS.INTERNAL_ERROR, "Internal error"));
            } else {
                res.end();
            }
        }
    }
};

function handleOptions(res) {
    res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, X-API-Key",
        "Access-Control-Expose-Headers": "Mcp-Session-Id"
    });
    res.end();
}

function handleDelete(req, res) {
    const sessionId = req.headers[SESSION_HEADER];
    if (sessionId) SESSION.closeSession(sessionId);
    res.writeHead(204);
    res.end();
}

function handleStream(req, res) {
    const sessionId = req.headers[SESSION_HEADER];
    const session = SESSION.getSession(sessionId);

    if (!session) {
        return PROTOCOL.writeJson(res, 400, { error: "Missing or unknown Mcp-Session-Id header" });
    }

    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Mcp-Session-Id": session.id
    });

    SESSION.attachStream(session.id, res);

    const keepAlive = setInterval(() => {
        try {
            res.write(": ping\n\n");
        } catch (e) {
            clearInterval(keepAlive);
        }
    }, 25000);

    req.on("close", () => clearInterval(keepAlive));
}

async function handlePost(req, res) {
    const raw = await PROTOCOL.readRequestBody(req);
    const parsed = PROTOCOL.parseJsonRpc(raw);

    if (!parsed.ok) {
        return PROTOCOL.writeJson(res, 400, parsed.error);
    }
    if (parsed.messages.length === 0) {
        res.writeHead(202);
        return res.end();
    }

    const ctx = req.$ctx;
    //Carries the session id across the batch - set by an `initialize` call
    //if one is present, otherwise taken from the incoming header.
    const state = { sessionId: req.headers[SESSION_HEADER] };

    const responses = [];
    for (const message of parsed.messages) {
        const response = await dispatch(message, state, ctx);
        if (response) responses.push(response);
    }

    if (responses.length === 0) {
        res.writeHead(202);
        return res.end();
    }

    const headers = { "Content-Type": "application/json" };
    if (state.sessionId) headers[SESSION_HEADER] = state.sessionId;

    const body = responses.length === 1 ? responses[0] : responses;
    res.writeHead(200, headers);
    res.end(JSON.stringify(body));
}

async function dispatch(message, state, ctx) {
    const { id, method, params } = message;
    const notification = PROTOCOL.isNotification(message);

    try {
        switch (method) {
            case "initialize": {
                const session = SESSION.createSession({ user: ctx?.meta?.user });
                session.initialized = true;
                session.protocolVersion = (params && params.protocolVersion) || PROTOCOL.MCP_PROTOCOL_VERSION;
                session.clientInfo = (params && params.clientInfo) || {};
                state.sessionId = session.id;

                if (notification) return null;
                return PROTOCOL.buildResult(id, {
                    protocolVersion: PROTOCOL.MCP_PROTOCOL_VERSION,
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: { name: "logiks-mcp", version: "1.0.0" }
                });
            }

            case "notifications/initialized":
                return null;

            case "ping":
                return notification ? null : PROTOCOL.buildResult(id, {});

            case "tools/list":
                return notification ? null : PROTOCOL.buildResult(id, { tools: REGISTRY.listTools() });

            case "tools/call": {
                if (!params || !params.name) {
                    return notification ? null : PROTOCOL.buildError(id, PROTOCOL.JSONRPC_ERRORS.INVALID_PARAMS, "Missing tool name");
                }

                try {
                    const result = await REGISTRY.callTool(params.name, params.arguments, ctx);
                    return notification ? null : PROTOCOL.buildResult(id, PROTOCOL.toolResult(result));
                } catch (toolErr) {
                    //Tool-level failures are reported as MCP tool errors, not
                    //JSON-RPC errors, so the model sees the message and can react.
                    return notification ? null : PROTOCOL.buildResult(id, PROTOCOL.toolError(toolErr.message || String(toolErr)));
                }
            }

            default:
                return notification ? null : PROTOCOL.buildError(id, PROTOCOL.JSONRPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${method}`);
        }
    } catch (err) {
        console.error("MCP dispatch error", method, err);
        return notification ? null : PROTOCOL.buildError(id, PROTOCOL.JSONRPC_ERRORS.INTERNAL_ERROR, err.message || "Internal error");
    }
}
