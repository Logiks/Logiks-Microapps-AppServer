"use strict";

module.exports = {
	name: "callbacks",

	actions: {
		runWebhook: {
            rest: {
				method: "POST",
				// fullPath: "/callbacks/:webhookid"
                path: "/:webhookid"
			},
            params: {
                // cmd: "string"
            },
			async handler(ctx) {
                const response = await WEBHOOKS.receiveRequest(ctx.params.webhookid, ctx);
                return response;
            }
        }
    }
}