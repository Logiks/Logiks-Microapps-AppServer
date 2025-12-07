"use strict";

module.exports = {
	name: "tenant",

	actions: {
		//Get Tenant Information
		fetch: {
			rest: {
				method: "POST",
				fullPath: "/api/tenant"
			},
			params: {
				"guid": "string"
			},
			// meta: {
			// 	scopes: ["/api/tenant"]
			// },
			async handler(ctx) {
				const guid = ctx.params.guid;
				const appid = ctx.meta.appInfo.appid;

				var tenantInfo = await TENANT.getTenantInfo(guid);

				if(!tenantInfo) {
					throw new LogiksError(
						"Invalid Tenant key",
						401,
						"INVALID_TENANT_KEY"
					);
				}
				
				delete tenantInfo.id;
				delete tenantInfo.application_overrides;

				if(tenantInfo.allowed_apps.indexOf("*")>=0) {
					return tenantInfo;
				} else if(tenantInfo.allowed_apps.indexOf(appid)>=0) {
					return tenantInfo;
				} else {
					if(!data) {
						throw new LogiksError(
							"Tenant does not have access to this application",
							401,
							"UNAUTHORISED_TENANT"
						);
					}
				}
			}
		}
	}
};
