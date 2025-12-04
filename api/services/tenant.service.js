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
		},

		layout: {
			rest: {
				method: "GET",
				fullPath: "/api/layout"
			},
			async handler(ctx) {
				console.log("TENANT_LAYOUT", { meta: ctx.meta });

				const appLayoutFile = "misc/apps/"+ctx.meta.appInfo.appid+"/layouts/default.json";
				if(fs.existsSync(appLayoutFile)) {
					const layoutData = JSON.parse(fs.readFileSync(appLayoutFile, "utf8"));
					return layoutData;
				} else {
					throw new Errors.MoleculerClientError(
						"Invalid Application key",
						401,
						"INVALID_APP_KEY"
					);
				}
			}
		}
	}
};
