//SSE Event Handler
"use strict";

const crypto = require("crypto");

const clients = new Map();

//EventSource cannot send an Authorization header, so an authenticated caller
//first trades its Bearer token for a short-lived, single-use ticket bound to
//one user + one stream id, and passes that in the EventSource URL instead.
const tickets = new Map();
const TICKET_TTL_MS = 30 * 1000;
const MAX_STREAMS_PER_USER = 5;

function pruneTickets() {
    const now = Date.now();
    for(const [k, v] of tickets) {
        if(v.expires <= now) tickets.delete(k);
    }
}

module.exports = {
    name: "sse",

    actions: {
        ticket: {
            rest: {
                method: "POST",
                fullPath: "/api/sse/ticket"
            },
            handler(ctx) {
                const userId = ctx.meta?.user?.userId;
                if(!userId) throw new LogiksError("Authentication required", 401, "NO_AUTH");

                pruneTickets();

                //The server picks the stream id so it cannot be guessed or chosen by another user
                const eventId = crypto.randomUUID();
                const ticket = crypto.randomBytes(32).toString("hex");
                tickets.set(ticket, { userId, eventId, expires: Date.now() + TICKET_TTL_MS });

                return { eventId, ticket, expiresIn: TICKET_TTL_MS / 1000 };
            }
        },

        recieveEvents: {
            timeout: 0,
            retryPolicy: {
                enabled: false
            },

            handler(ctx) {
                try {
                    const req = ctx.meta.$req;
                    const res = ctx.meta.$res;

                    const id = ctx.params.eventId;

                    //Single-use: removed whether or not it turns out to be valid
                    const t = tickets.get(ctx.params.ticket);
                    tickets.delete(ctx.params.ticket);
                    if(!t || t.expires <= Date.now() || t.eventId !== id) {
                        throw new LogiksError("Invalid or expired event ticket", 401, "INVALID_TICKET");
                    }
                    const owner = t.userId;

                    let open = 0;
                    for(const c of clients.values()) if(c.owner === owner) open++;
                    if(open >= MAX_STREAMS_PER_USER && !clients.has(id)) {
                        throw new LogiksError("Too many open event streams", 429, "TOO_MANY_STREAMS");
                    }

                    // A stream id belongs to whoever opened it; another user must not be able to replace it
                    const existing = clients.get(id);
                    if(existing && existing.owner !== owner) {
                        return {"status": "error", "msg": "Event stream id is already in use"};
                    }
                    if(existing) {
                        try { existing.res.end(); } catch(e) {}
                    }

                    res.writeHead(200, {
                        "Content-Type": "text/event-stream",
                        "Cache-Control": "no-cache",
                        "Connection": "keep-alive",
                        "X-Accel-Buffering": "no"
                    });

                    // Event ownership validation
                    // if (!this.isAllowed(ctx.meta.user, id)) {
                    //     res.writeHead(403, {
                    //         "Content-Type": "application/json"
                    //     });

                    //     res.end(JSON.stringify({
                    //         status: "error",
                    //         message: "Forbidden"
                    //     }));

                    //     return;
                    // }

                    // // Only AFTER validation...
                    // res.writeHead(200, {
                    //     "Content-Type": "text/event-stream",
                    //     "Cache-Control": "no-cache",
                    //     "Connection": "keep-alive",
                    //     "X-Accel-Buffering": "no"
                    // });

                    res.write(`event: connected\n\n`);
                    res.write(`data: ${JSON.stringify({ id })}\n\n`);

                    clients.set(id, { res, owner });

                    // Only drop the entry if it is still this connection (a reconnect may have replaced it)
                    const release = () => {
                        if(clients.get(id)?.res === res) clients.delete(id);
                    };

                    req.on("close", () => {
                        release();

                        try {
                            res.end();
                        } catch(e) {}

                        console.log("SSE closed", id);
                    });

                    // Prevent Moleculer from sending a normal response
                    // return undefined;
                    // return new Promise(() => {});
                    return new Promise(resolve => {

                        const heartbeat = setInterval(() => {
                            try {
                                res.write(': heartbeat\n\n');
                            } catch(e) {
                                clearInterval(heartbeat);
                            }
                        }, 15000);

                        req.on("close", () => {

                            clearInterval(heartbeat);

                            release();

                            try {
                                res.end();
                            } catch(e) {}

                            resolve();
                        });

                    });
                } catch(e1) {
                    //Auth/limit failures must reach the client as real 401/429, not a 200 error body
                    if(e1 instanceof LogiksError) throw e1;
                    console.error("SSE.recieveEvents_ERROR", e1);
                    return {"status": "error", "msg": e1.message};
                }
            }
        }
    },

    methods: {
        sendEvent(id, event, data) {
            const client = clients.get(id)?.res;

            if (!client) return false;

            // newlines in the event name would let a payload inject extra SSE fields
            client.write(`event: ${String(event).replace(/[\r\n]/g, " ")}\n`);
            client.write(`data: ${JSON.stringify(data)}\n\n`);

            return true;
        }
    },

    events: {
        //use SSE.broadcast to send events to all clients
        "sse.push"(payload) {
            if(!clients.get(payload.id)) return;

            this.sendEvent(
                payload.id,
                payload.event,
                payload.data
            );
        }
    }
}