"use strict";

// /api/modules/reports/doc.main
// /api/modules/forms/doc.main
// /api/modules/dashboards/doc.main

// PAGES
// /api/modules/docs/main
// /api/modules/pages/docs.main

// Components
// /api/modules/components/docs.main

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
					var submoduleFile = item[1];
					var modname = moduleName.substring(moduleName.length-1,moduleName.length)=="s"?moduleName.substring(0,moduleName.length-1):moduleName;

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
		fetchModule: {
			rest: {
				method: "GET",
				fullPath: "/api/modules/:module/component/:item?"
			},
			async handler(ctx) {
				const moduleName = ctx.params.module;
				var item = ctx.params.item.split(".");
				
				console.log("MODULE_COMPONENT_HANDLER", ctx.params, item.length);

				const fileContent = await ctx.call(`${pluginID}.source`, {folder: "components", file: submoduleFile});
				return fileContent;
			}
		},
		service: {
			rest: {
				method: "GET",
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
