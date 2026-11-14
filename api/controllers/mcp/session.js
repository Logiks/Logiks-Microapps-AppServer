//MCP sessions.
//Sessions are created on "initialize" and identified by the Mcp-Session-Id header on every later request.
//
//The session record (id, user, protocol version, client info) lives in Redis with an idle expiry, so any gateway
//process can serve any request of a session - pm2 cluster mode and several hosts work without sticky routing.
//Only the open GET /mcp notification stream (the SSE connection) is tied to the process that accepted it, and is kept
//in a local map. Nothing in the server pushes notifications today; if that changes, route GET /mcp with affinity
//(see docs/05-workers.md, "MCP behind a load balancer").

const LOCAL_STREAMS = new Map(); // sessionId -> { res, lastSeen }

const IDLE_TTL_SEC = 30 * 60; // 30 minutes without any request/ping
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_ID_RE = /^[A-Za-z0-9_-]{24}$/;

const redis = () => _CACHE.getRedisInstance();
const key = (id) => `mcp:session:${id}`;

//The stored part of a session; the stream is local and never stored
function toRecord(session) {
    return {
        id: session.id,
        createdAt: session.createdAt,
        lastSeen: Date.now(),
        initialized: !!session.initialized,
        protocolVersion: session.protocolVersion || null,
        clientInfo: session.clientInfo || null,
        user: session.user || {}
    };
}

async function createSession(meta = {}) {
    const session = {
        id: UNIQUEID.generate(24),
        createdAt: Date.now(),
        initialized: false,
        protocolVersion: null,
        clientInfo: null,
        user: meta.user || {}
    };
    await redis().set(key(session.id), JSON.stringify(toRecord(session)), "EX", IDLE_TTL_SEC);
    session.sseRes = null;
    return session;
}

//Persists changes made to a session object (for example after initialize fills in the client details)
async function updateSession(session) {
    if(!session || !SESSION_ID_RE.test(session.id)) return false;
    await redis().set(key(session.id), JSON.stringify(toRecord(session)), "EX", IDLE_TTL_SEC);
    return true;
}

async function getSession(id) {
    if(typeof id !== "string" || !SESSION_ID_RE.test(id)) return null;

    const raw = await redis().get(key(id));
    if(!raw) return null;

    let session;
    try {
        session = JSON.parse(raw);
    } catch(e) {
        return null;
    }

    // Every use keeps the session alive
    await redis().expire(key(id), IDLE_TTL_SEC);
    session.sseRes = LOCAL_STREAMS.has(id) ? LOCAL_STREAMS.get(id).res : null;
    return session;
}

async function touchSession(id) {
    if(typeof id !== "string" || !SESSION_ID_RE.test(id)) return false;
    return (await redis().expire(key(id), IDLE_TTL_SEC)) === 1;
}

function attachStream(id, res) {
    const existing = LOCAL_STREAMS.get(id);
    if(existing && existing.res !== res) {
        try { existing.res.end(); } catch (e) {}
    }

    LOCAL_STREAMS.set(id, { res, lastSeen: Date.now() });

    res.on("close", () => {
        const current = LOCAL_STREAMS.get(id);
        if(current && current.res === res) LOCAL_STREAMS.delete(id);
    });

    return true;
}

//Only reaches a stream held by this process
function sendEvent(id, data, eventName) {
    const stream = LOCAL_STREAMS.get(id);
    if(!stream) return false;

    if(eventName) stream.res.write(`event: ${eventName}\n`);
    stream.res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
    stream.lastSeen = Date.now();
    return true;
}

async function closeSession(id) {
    const stream = LOCAL_STREAMS.get(id);
    if(stream) {
        try { stream.res.end(); } catch (e) {}
        LOCAL_STREAMS.delete(id);
    }

    if(typeof id === "string" && SESSION_ID_RE.test(id)) await redis().del(key(id));
    return true;
}

//Redis expires the records; this only drops streams on this process that have been idle
function sweep() {
    const now = Date.now();
    for (const [id, stream] of LOCAL_STREAMS) {
        if (now - stream.lastSeen > IDLE_TTL_SEC * 1000) {
            try { stream.res.end(); } catch (e) {}
            LOCAL_STREAMS.delete(id);
        }
    }
}

setInterval(sweep, SWEEP_INTERVAL_MS).unref();

module.exports = {
    createSession,
    updateSession,
    getSession,
    touchSession,
    attachStream,
    sendEvent,
    closeSession
};
