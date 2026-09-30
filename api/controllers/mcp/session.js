//In-memory MCP session store.
//Sessions are created on "initialize" and identified by the Mcp-Session-Id
//header on every subsequent request. A session can optionally hold an open
//SSE stream (the GET /mcp long-lived connection) for server -> client
//notifications; POST requests work fine without one.
//
//Single-process, in-memory store - fine for one AppServer instance. If this
//ever runs behind multiple instances, sessions will need to move to a shared
//store (redis/cachemap) keyed the same way.

const SESSIONS = new Map();

const IDLE_TTL_MS = 30 * 60 * 1000; // 30 minutes without any request/ping
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function createSession(meta = {}) {
    const id = UNIQUEID.generate(24);
    const session = {
        id,
        createdAt: Date.now(),
        lastSeen: Date.now(),
        initialized: false,
        protocolVersion: null,
        clientInfo: null,
        user: meta.user || {},
        sseRes: null
    };
    SESSIONS.set(id, session);
    return session;
}

function getSession(id) {
    if (!id) return null;
    const session = SESSIONS.get(id);
    if (!session) return null;
    session.lastSeen = Date.now();
    return session;
}

function touchSession(id) {
    const session = SESSIONS.get(id);
    if (session) session.lastSeen = Date.now();
}

function attachStream(id, res) {
    const session = SESSIONS.get(id);
    if (!session) return false;

    if (session.sseRes && session.sseRes !== res) {
        try { session.sseRes.end(); } catch (e) {}
    }

    session.sseRes = res;
    session.lastSeen = Date.now();

    res.on("close", () => {
        if (session.sseRes === res) session.sseRes = null;
    });

    return true;
}

function sendEvent(id, data, eventName) {
    const session = SESSIONS.get(id);
    if (!session || !session.sseRes) return false;

    if (eventName) session.sseRes.write(`event: ${eventName}\n`);
    session.sseRes.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
    return true;
}

function closeSession(id) {
    const session = SESSIONS.get(id);
    if (!session) return false;

    if (session.sseRes) {
        try { session.sseRes.end(); } catch (e) {}
    }

    SESSIONS.delete(id);
    return true;
}

function sweep() {
    const now = Date.now();
    for (const [id, session] of SESSIONS) {
        if (now - session.lastSeen > IDLE_TTL_MS) closeSession(id);
    }
}

setInterval(sweep, SWEEP_INTERVAL_MS).unref();

module.exports = {
    createSession,
    getSession,
    touchSession,
    attachStream,
    sendEvent,
    closeSession
};
