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

module.exports = {
	name: "modules",

	actions: {
		//For supporting
		// /api/modules/reports/lead.main
		// /api/modules/lead/main
		fetchModule: {
			rest: {
				method: "GET",
				fullPath: "/api/modules/:module/:item?/:operation?/:refid?"///:action/:item?
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

					if(CONFIG.JSON_MODULES.indexOf(moduleName)>=0) {
						submoduleFile = `${submoduleFile}.json`;
					}

					if(ctx.params.recache===true || ctx.params.recache==="true") {
						if(COMPONENT_CACHE[`${pluginID}:${moduleName}:${submoduleFile}`]) delete COMPONENT_CACHE[`${pluginID}:${moduleName}:${submoduleFile}`];
					}

					if(COMPONENT_CACHE[`${pluginID}:${moduleName}:${submoduleFile}`]) {
						return {
							"component": modname,
							"content": await processJSONComponent(COMPONENT_CACHE[`${pluginID}:${moduleName}:${submoduleFile}`].data, ctx.params.item, ctx.params.module, ctx)
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
						"content": await processJSONComponent(fileContent, ctx.params.item, ctx.params.module, ctx)
					};
				} else {
					var submoduleFile = ctx.params.item+".json";
					const pluginID = moduleName;

					if(ctx.params.recache===true || ctx.params.recache==="true") {
						if(COMPONENT_CACHE[`PAGE:${moduleName}:${submoduleFile}`]) delete COMPONENT_CACHE[`PAGE:${moduleName}:${submoduleFile}`];
					}

					if(COMPONENT_CACHE[`PAGE:${moduleName}:${submoduleFile}`]) {
						return {
							"component": "page",
							"content": await processJSONComponent(COMPONENT_CACHE[`PAGE:${moduleName}:${submoduleFile}`].data, ctx.params.item, ctx.params.module, ctx)
						};
					}
					
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
						"content": await processJSONComponent(fileContent, ctx.params.item, ctx.params.module, ctx)
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

				const fileContent = await ctx.call(`${moduleName}.source`, {folder: "component", file: fileName, params: ctx.params});

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
				fullPath: "/api/requests/:moduleId/:actionId?"
			},
			async handler(ctx) {
				const moduleName = ctx.params.moduleId;
				const actionId = ctx.params.actionId;
				
				var cmdString = `${moduleName}.${actionId}`;

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

async function processJSONComponent(jsonObj, objId, moduleId, ctx) {
	// console.log("processJSONComponent", objId, moduleId, jsonObj);
	
	//Process For Policies
	if(jsonObj.policy && jsonObj.policy.length>0) {
		var isAllowed = await RBAC.checkPolicy(ctx, jsonObj.policy);//false
		if(!isAllowed) {
			throw new LogiksError(
				"Forbidden",
				403,
				"FORBIDDEN_ADMIN_ONLY"
			);
		}
	}
	jsonObj = await RBAC.processJSONComponent(ctx, jsonObj);

	//Process For Query
	try {
		var tempObj = _.cloneDeep(jsonObj);
		if(typeof tempObj == "string") tempObj  = JSON.parse(tempObj);
		
		switch(moduleId) {
			case "forms":
				if(tempObj.source && tempObj.source.type=="sql") {
					const operationId = ctx.params.operation?ctx.params.operation:"create";
					const refid = ctx.params.refid?ctx.params.refid:0;
					if(operationId!="create") {
						tempObj.source.refid = refid;
					}
					
					if(tempObj.hooks) tempObj.source.hooks = tempObj.hooks;

					const dbOpsID = await DBOPS.storeDBOpsQuery(tempObj.source, tempObj.fields, operationId, tempObj.forcefill?tempObj.forcefill:{}, ctx.meta.user);
					tempObj.source = {
						"type": "sql",
						"dbopsid": dbOpsID
					};
				}
				// tempObj.fields.filter && type!= "dataMethod" && .table
				//Process Data to generate options
				_.each(tempObj.fields, async function(v,k) {
					if(v.table) {
						tempObj.fields[k] = {
							...v,
							queryid: await QUERY.storeQuery(v, ctx.meta.user),
						};
						if(tempObj.fields[k].table) delete tempObj.fields[k].table;
						if(tempObj.fields[k].columns) delete tempObj.fields[k].columns;
						if(tempObj.fields[k].where) delete tempObj.fields[k].where;
					}
				})

				jsonObj = tempObj;
				break;
			case "infoview":
				if(tempObj.source && tempObj.source.type=="sql") {
					const operationId = ctx.params.operation?ctx.params.operation:"fetch";
					const refid = ctx.params.refid?ctx.params.refid:0;
					tempObj.source.refid = refid;

					if(tempObj.hooks) tempObj.source.hooks = tempObj.hooks;

					const dbOpsID = await DBOPS.storeDBOpsQuery(tempObj.source, tempObj.fields, operationId, tempObj.forcefill?tempObj.forcefill:{}, ctx.meta.user);
					tempObj.source = {
						"type": "sql",
						"dbopsid": dbOpsID
					};
				}
				_.each(tempObj.fields, async function(v,k) {
					if(v.table) {
						tempObj.fields[k] = {
							...v,
							queryid: await QUERY.storeQuery(v, ctx.meta.user),
						};
						if(tempObj.fields[k].table) delete tempObj.fields[k].table;
						if(tempObj.fields[k].columns) delete tempObj.fields[k].columns;
						if(tempObj.fields[k].where) delete tempObj.fields[k].where;
					}
				})
				_.each(tempObj.infoview.groups, async function(v,k) {
					if(v.config && v.config.table) {
						if(!tempObj.infoview.groups[k].config.columns && tempObj.infoview.groups[k].config.cols) {
							tempObj.infoview.groups[k].config.columns = tempObj.infoview.groups[k].config.cols;
							delete tempObj.infoview.groups[k].config.cols;
						}

						tempObj.infoview.groups[k].config = {
							...v.config,
							queryid: await QUERY.storeQuery(v.config, ctx.meta.user),
						};

						if(tempObj.infoview.groups[k].config.table) delete tempObj.infoview.groups[k].config.table;
						if(tempObj.infoview.groups[k].config.columns) delete tempObj.infoview.groups[k].config.columns;
						if(tempObj.infoview.groups[k].config.where) delete tempObj.infoview.groups[k].config.where;
					}

					if(v.config && v.config.form && v.config.form.source && v.config.form.source.type=="sql") {
						if(v.config.hooks) v.config.form.source.hooks = v.config.hooks;
						const dbOpsID = await DBOPS.storeDBOpsQuery(v.config.form.source, v.config.form.fields, "fetch", v.config.form.forcefill?v.config.form.forcefill:{}, ctx.meta.user);
						v.config.form.source = {
							"type": "sql",
							"dbopsid": dbOpsID
						};
					}
				});
				

				jsonObj = tempObj;
				break;
			case "dashboards":
			case "dashboard":
				_.each(tempObj.cards, async function(v,k) {
					if(v.source && v.source.type && v.source.type=="sql") {
						tempObj.cards[k].source = {
							type: "sql",
							queryid: await QUERY.storeQuery(v.source, ctx.meta.user),
						};
					}
				})
				if(tempObj.filters) {
					_.each(tempObj.filters, async function(v,k) {
						if(v.table) {
							tempObj.filters[k] = {
								...v,
								queryid: await QUERY.storeQuery(v.filter, ctx.meta.user),
							};
							if(tempObj.filters[k].table) delete tempObj.filters[k].table;
							if(tempObj.filters[k].columns) delete tempObj.filters[k].columns;
							if(tempObj.filters[k].where) delete tempObj.filters[k].where;
						}
					})
				}

				jsonObj = tempObj;
				break;
			case "charts":
				if(tempObj.filters) {
					_.each(tempObj.filters, async function(v,k) {
						if(v.table) {
							tempObj.filters[k] = {
								...v,
								queryid: await QUERY.storeQuery(v.filter, ctx.meta.user),
							};
							if(tempObj.filters[k].table) delete tempObj.filters[k].table;
							if(tempObj.filters[k].columns) delete tempObj.filters[k].columns;
							if(tempObj.filters[k].where) delete tempObj.filters[k].where;
						}
					})
				}
			case "reports":
				// tempObj.datagrid.filter && type!= "dataMethod" && .table
				_.each(tempObj.datagrid, async function(v,k) {
					if(v.filter && v.filter.table) {
						tempObj.datagrid[k].filter = {
							type: v.filter.type,
							queryid: await QUERY.storeQuery(v.filter, ctx.meta.user),
						};
					}
				})
			default:
				if(tempObj.source && tempObj.source.type=="sql") {
					if(!tempObj.source.columns && tempObj.source.cols) {
						tempObj.source.columns = tempObj.source.cols;
						delete tempObj.source.cols;
					}
					
					const queryID = await QUERY.storeQuery(tempObj.source, ctx.meta.user);
					tempObj.source = {
						"type": "sql",
						"queryid": queryID
					};
				}

				jsonObj = tempObj;
				break;
		}
	} catch(e) {
		console.error(e);
	}

	jsonObj.module_refid = objId;
	jsonObj.module_type = moduleId;

	return jsonObj;
}