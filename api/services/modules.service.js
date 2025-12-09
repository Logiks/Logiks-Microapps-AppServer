"use strict";

// /api/modules/reports/doc.main
// /api/modules/forms/doc.main
// /api/modules/dashboards/doc.main

// PAGES
// /api/modules/docs/main
// /api/modules/pages/docs.main

// Components
// /api/modules/components/docs.main

const mimeMap = {
	// "reports", "forms", "infoview", "dashboard", "search", "charts"
};

module.exports = {
	name: "modules",

	actions: {
		fetchModule: {
			rest: {
				method: "GET",
				fullPath: "/api/modules/:module/:item?"///:action/:item?
			},
			async handler(ctx) {
				const moduleName = ctx.params.module;
				var item = ctx.params.item.split(".");
				
				console.log("MODULE_HANDLER", ctx.params, item.length);

				if(item.length>1) {
					var pluginID = item[0];
					var submoduleFile = item[1];//ctx.params.item.substring(item[0].length);
					var modname = moduleName.substring(moduleName.length-1,moduleName.length)=="s"?moduleName.substring(0,moduleName.length-1):moduleName;

					if(["reports", "forms", "infoview", "dashboard", "search", "charts", "pages"].indexOf(moduleName)>=0) {
						submoduleFile = `${submoduleFile}.json`;
					}

					console.log("XXXX", `${pluginID}.source`, {folder: moduleName, file: submoduleFile});
					const fileContent = await ctx.call(`${pluginID}.source`, {folder: moduleName, file: submoduleFile});
					return {
						"component": modname,
						"content": fileContent
					};
				} else {
					const fileContent = await ctx.call(`${pluginID}.source`, {folder: "pages", file: submoduleFile});
					return {
						"component": "page",
						"content": fileContent
					};
				}
			}
		},
		fetchComponent: {
			rest: {
				method: "GET",
				fullPath: "/api/modules/:module/component/:item?"
			},
			async handler(ctx) {
				const moduleName = ctx.params.module;
				var fileName = ctx.params.item;
				
				console.log("MODULE_COMPONENT_HANDLER", ctx.params);

				const fileContent = await ctx.call(`${moduleName}.source`, {folder: "components", file: fileName});
				return fileContent;
			}
		},
		fetchService: {
			rest: {
				method: "POST",
				fullPath: "/api/services/:module/:action?"
			},
			async handler(ctx) {
				const moduleName = ctx.params.module;
				const action = ctx.params.action;
				
				var cmdString = `${moduleName}.${action}`;

				console.log("SERVICE_HANDLER", ctx.params, cmdString);

				const a1 = await ctx.call(cmdString);
                return {"status": "okay", "results": a1};
			}
		}
	}
};
