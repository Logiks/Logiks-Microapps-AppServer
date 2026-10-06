//SSE Event Handler
"use strict";

const clients = new Map();

module.exports = {
    name: "sse",

    actions: {
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
                    const owner = ctx.meta?.user?.userId;

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