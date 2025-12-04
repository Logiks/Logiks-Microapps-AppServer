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
				if(!tenantInfo) {
					throw new Errors.MoleculerClientError(
						"Invalid Tenant key",
						401,
						"INVALID_TENANT_KEY"
					);
				}

				delete tenantInfo.domain;

				return tenantInfo;
			}
		}
	}
};
