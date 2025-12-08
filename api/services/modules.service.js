"use strict";

module.exports = {
	name: "modules",

	actions: {
		listModules: {
			rest: {
				method: "GET",
				fullPath: "/api/modules/:module/:item?"///:action/:item?
			},
			async handler(ctx) {
				const moduleName = ctx.params.module;
				var item = ctx.params.item.split(".");
				var pluginID = item[0];
				var submoduleFile = item[1];
				console.log("MODULE_HANDLER", ctx.params);
				
				const fileContent = await ctx.call(`${pluginID}.source`, {folder: moduleName, file: submoduleFile});
                return {
					"component": moduleName,
					"content": fileContent
				};
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
