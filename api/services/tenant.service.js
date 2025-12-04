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
				fullPath: "/api/layout/:layoutid?"
			},
			async handler(ctx) {

				if(!ctx.params.layoutid) ctx.params.layoutid = "default";

				const appLayoutFile = `misc/apps/${ctx.meta.appInfo.appid}/layouts/${ctx.params.layoutid}.json`;
				if(fs.existsSync(appLayoutFile)) {
					const layoutData = JSON.parse(fs.readFileSync(appLayoutFile, "utf8"));
					return layoutData;
				} else {
					throw new Errors.MoleculerClientError(
						"Invalid Application Layout Identifier",
						401,
						"INVALID_LAYOUT_KEY",
						ctx.params.layoutid
					);
				}
			}
		},

		theme: {
			rest: {
				method: "GET",
				fullPath: "/api/theme/:themeid?"
			},
			async handler(ctx) {

				if(!ctx.params.themeid) ctx.params.themeid = "default";

				//const appLayoutFile = `misc/apps/${ctx.meta.appInfo.appid}/layouts/${ctx.params.layoutid}.json`;
				const themeFile = `misc/themes/${ctx.params.themeid}/style.css`;
				if(fs.existsSync(themeFile)) {
					const themeData = fs.readFileSync(themeFile, "utf8");
					
					ctx.meta.$responseType = "text/css";
					return themeData;
				} else {
					throw new Errors.MoleculerClientError(
						"Invalid Application Layout Identifier",
						401,
						"INVALID_LAYOUT_KEY",
						ctx.params.themeid
					);
				}
			}
		}
	}
};
