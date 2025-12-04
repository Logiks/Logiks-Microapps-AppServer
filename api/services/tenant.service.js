"use strict";

const mime = require("mime-types");

const themeCache = new Map();

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
			async handler(ctx) {
				const guid = ctx.params.guid;
				var whereCond = {
					"blocked": "false",
					"guid": guid
				};
				var data = await new Promise((resolve, reject) => {
					db_selectQ("MYSQL0", "auth_tenants", "*", whereCond, {}, function (tenantInfo) {
						if (tenantInfo) {
							resolve(tenantInfo);
						} else {
							resolve(false);
						}
					});
				})

				if(!data) {
					throw new Errors.MoleculerClientError(
						"Invalid Tenant key",
						401,
						"INVALID_TENANT_KEY"
					);
				}
				const appid = ctx.meta.appInfo.appid;
				var tenantInfo = data[0]; 
				tenantInfo.allowed_apps = tenantInfo.allowed_apps.split(",");

				try {
					tenantInfo.applicationOverrides = JSON.parse(tenantInfo.application_overrides);
				} catch(err) {
					tenantInfo.applicationOverrides = {};
				}
				
				delete tenantInfo.id;
				delete tenantInfo.application_overrides;

				if(tenantInfo.allowed_apps.indexOf("*")>=0) {
					return tenantInfo;
				} else if(tenantInfo.allowed_apps.indexOf(appid)>=0) {
					return tenantInfo;
				} else {
					if(!data) {
						throw new Errors.MoleculerClientError(
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
