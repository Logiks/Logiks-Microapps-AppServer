"use strict";

module.exports = {
	name: "tenant",

	actions: {
		fetch: {
			rest: {
				method: "GET",
				fullPath: "/api/tenant"
			},
			async handler(ctx) {
				const serverHost = ctx.meta.serverHost;
				const tenantInfo = await BASEAPP.getAppInfo(serverHost);

				return tenantInfo;
			}
		}
	}
};
