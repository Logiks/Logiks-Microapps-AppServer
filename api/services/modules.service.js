"use strict";

const { Readable } = require('stream');

// const mime = require("mime-types");

// /api/modules/reports/doc.main
// /api/modules/forms/doc.main
// /api/modules/dashboards/doc.main

// PAGES
// /api/modules/docs/main
// /api/modules/pages/docs.main

// Components
// /api/modules/components/docs.main

const COMPONENT_CACHE = _CACHE.getCacheMap("MODULES_COMPONENT_CACHE");

const mimeMap = {
	// "reports", "forms", "infoviews", "dashboards", "search", "charts"
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
				if(CONFIG.disable_cache.modules) ctx.params.recache = true;

				const moduleName = ctx.params.module;
				var item = ctx.params.item.split(".");
				
				console.log("MODULE_HANDLER", ctx.params, item.length, item);

				if(item.length>1) {
					var pluginID = item[0];
					var submoduleFile = item[1];
					var modname = moduleName.substring(moduleName.length-1,moduleName.length)=="s"?moduleName.substring(0,moduleName.length-1):moduleName;

					if(["reports", "forms", "infoview", "dashboard", "search", "charts", "pages"].indexOf(moduleName)>=0) {
						submoduleFile = `${submoduleFile}.json`;
					}

					if(ctx.params.recache===true || ctx.params.recache==="true") {
						if(COMPONENT_CACHE[`${pluginID}:${moduleName}:${submoduleFile}`]) delete COMPONENT_CACHE[`${pluginID}:${moduleName}:${submoduleFile}`];
					}

					if(COMPONENT_CACHE[`${pluginID}:${moduleName}:${submoduleFile}`]) {
						return {
							"component": modname,
							"content": COMPONENT_CACHE[`${pluginID}:${moduleName}:${submoduleFile}`].data
						};
					}

					const fileContent = await ctx.call(`${pluginID}.source`, {folder: moduleName, file: submoduleFile, params: ctx.params});

					COMPONENT_CACHE[`${pluginID}:${moduleName}:${submoduleFile}`] = {
							component: modname,
							data: fileContent,
							version: Date.now(),
							updatedAt: Date.now()
						};
					_CACHE.saveCacheMap("MODULES_COMPONENT_CACHE", COMPONENT_CACHE);

					return {
						"component": modname,
						"content": fileContent
					};
				} else {
					var submoduleFile = ctx.params.item;
					const pluginID = moduleName;

					if(ctx.params.recache===true || ctx.params.recache==="true") {
						if(COMPONENT_CACHE[`PAGE:${moduleName}:${submoduleFile}`]) delete COMPONENT_CACHE[`PAGE:${moduleName}:${submoduleFile}`];
					}

					if(COMPONENT_CACHE[`PAGE:${moduleName}:${submoduleFile}`]) {
						return {
							"component": "page",
							"content": COMPONENT_CACHE[`PAGE:${moduleName}:${submoduleFile}`].data
						};
					}
					console.log("MODULE_HANDLER_2", pluginID, {folder: "pages", file: submoduleFile, params: ctx.params});
					const fileContent = await ctx.call(`${pluginID}.source`, {folder: "pages", file: submoduleFile, params: ctx.params});

					COMPONENT_CACHE[`PAGE:${moduleName}:${submoduleFile}`] = {
							component: "page",
							data: fileContent,
							version: Date.now(),
							updatedAt: Date.now()
						};
					_CACHE.saveCacheMap("MODULES_COMPONENT_CACHE", COMPONENT_CACHE);

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
				if(CONFIG.disable_cache.modules) ctx.params.recache = true;
				
				const moduleName = ctx.params.module;
				var fileName = ctx.params.item;
				
				console.log("MODULE_COMPONENT_HANDLER", ctx.params);

				if(ctx.params.recache===true || ctx.params.recache==="true") {
					if(COMPONENT_CACHE[`COMPONENTS:${moduleName}:${fileName}`]) delete COMPONENT_CACHE[`COMPONENTS:${moduleName}:${fileName}`];
				}

				if(COMPONENT_CACHE[`COMPONENTS:${moduleName}:${fileName}`]) {
					return Readable.from(COMPONENT_CACHE[`COMPONENTS:${moduleName}:${fileName}`].data);
				}

				const fileContent = await ctx.call(`${moduleName}.source`, {folder: "components", file: fileName, params: ctx.params});

				COMPONENT_CACHE[`COMPONENTS:${moduleName}:${fileName}`] = {
						data: fileContent,
						version: Date.now(),
						updatedAt: Date.now()
					};
				_CACHE.saveCacheMap("MODULES_COMPONENT_CACHE", COMPONENT_CACHE);

				return Readable.from(fileContent);
				// return fileContent;
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

				const a1 = await ctx.call(cmdString, ctx.params);
                return {"status": "okay", "results": a1};
			}
		},
		fetchUI: {
			rest: {
				method: "GET",
				fullPath: "/api/ui/:module/:asset1?/:asset2?"
			},
			async handler(ctx) {
				const moduleName = ctx.params.module;
				const asset1 = ctx.params.asset1;
				const asset2 = ctx.params.asset2;

				var cmdString = `${moduleName}.www`;

				console.log("UI_ASSET_HANDLER", cmdString, {folder: asset1, file: asset2});

				if(!asset2 || asset2.length<=0) {
					const folder = "";
					const file = asset1;

					const fileContent = await ctx.call(cmdString, {folder: folder, file: file});
				
                	return Readable.from(fileContent);
				} else {
					const folder = asset1;
					const file = asset2;

					const fileContent = await ctx.call(cmdString, {folder: folder, file: file});
				
                	return Readable.from(fileContent);
				}
			}
		}
	}
};
