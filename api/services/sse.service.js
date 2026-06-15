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

                    clients.set(id, res);

                    req.on("close", () => {
                        clients.delete(id);

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

                            clients.delete(id);

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
            const client = clients.get(id);

            if (!client) return false;

            client.write(`event: ${event}\n`);
            client.write(`data: ${JSON.stringify(data)}\n\n`);

            return true;
        }
    },

    events: {
        "sse.push"(payload) {
            this.sendEvent(
                payload.id,
                payload.event,
                payload.data
            );
        }
    }
}