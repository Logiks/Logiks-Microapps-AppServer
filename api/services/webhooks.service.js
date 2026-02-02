"use strict";
//This works for webhooks and webhooks

module.exports = {
	name: "webhooks",

	actions: {
		runWebhook: {
            rest: {
				method: "POST",
				fullPath: "/webhooks/:webhookid"
                // path: "/:webhookid"
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