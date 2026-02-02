"use strict";

module.exports = {
	name: "callbacks",

	actions: {
		runWebhook: {
            rest: {
				method: "POST",
				fullPath: "/callbacks/:callbackid"
                // path: "/:callbackid"
			},
            params: {
                // cmd: "string"
            },
			async handler(ctx) {
                const response = await WEBHOOKS.receiveRequest(ctx.params.callbackid, ctx);
                return response;
            }
        }
    }
}