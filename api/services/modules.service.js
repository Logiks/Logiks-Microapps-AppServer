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
				if(!ctx.params.item) return false;
				
				const moduleName = ctx.params.module;
				var item = ctx.params.item.split(".");
				
				// console.log("MODULE_HANDLER", ctx.params, item.length, item);

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
				if(!fileContent) {
					throw new LogiksError(
						"Invalid Component",
						404,
						"COMPONENT_NOT_FOUND"
					);
				}
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

	try {
		if(typeof jsonObj == "string") jsonObj = JSON.parse(jsonObj);
	} catch(e) {}
	if(!jsonObj) return false;

	
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
			case "infoview":
				if(tempObj.source && tempObj.source.type=="sql") {
					const operationId = ctx.params.operation?ctx.params.operation:"fetch";
					const refid = ctx.params.refid?ctx.params.refid:0;
					tempObj.source.refid = refid;

					const dbOpsID = await DBOPS.storeDBOpsQuery(tempObj.source, tempObj.fields, operationId, tempObj.forcefill?tempObj.forcefill:{}, ctx.meta.user, {objId, moduleId, "refid": tempObj.source.refid}, tempObj.hooks?tempObj.hooks:{});
					tempObj.source = {
						"type": "sql",
						"dbopsid": dbOpsID
					};
				}
				tempObj.fields = await processFormFields(tempObj.fields, ctx, objId, moduleId);

				if(tempObj.infoview && tempObj.infoview.groups) {
					const groupList = Object.keys(tempObj.infoview.groups);
					for (var i = groupList.length - 1; i >= 0; i--) {
						const k = groupList[i];
						const v = tempObj.infoview.groups[k];
						if(v.config && v.config.table) {
							if(!tempObj.infoview.groups[k].config.columns && tempObj.infoview.groups[k].config.cols) {
								tempObj.infoview.groups[k].config.columns = tempObj.infoview.groups[k].config.cols;
								delete tempObj.infoview.groups[k].config.cols;
							}
							const newRefID1 = `${objId}.infoviewTable.${k}`;
							tempObj.infoview.groups[k].config = {
								...v.config,
								queryid: await QUERY.storeQuery(v.config, ctx.meta.user, false, {newRefID1, moduleId, "refid": `infoview.groups.${k}`}),
							};

							if(tempObj.infoview.groups[k].config.table) delete tempObj.infoview.groups[k].config.table;
							if(tempObj.infoview.groups[k].config.columns) delete tempObj.infoview.groups[k].config.columns;
							if(tempObj.infoview.groups[k].config.where) delete tempObj.infoview.groups[k].config.where;
						}

						if(v.config && v.config.form && v.config.form.source && v.config.form.source.type=="sql") {
							if(v.config.hooks) v.config.form.source.hooks = v.config.hooks;
							v.config.form.source.refid = tempObj.source.refid;
							const newRefID = `${objId}.infoview.${k}`;
							const dbOpsID = await DBOPS.storeDBOpsQuery(v.config.form.source, v.config.form.fields, "fetch", v.config.form.forcefill?v.config.form.forcefill:{}, ctx.meta.user, {newRefID, moduleId, "refid": tempObj.source.refid}, v.config.form.hooks?v.config.form.hooks:{});
							v.config.form.source = {
								"type": "sql",
								"dbopsid": dbOpsID
							};

							if(v.config.form.fields) {
								v.config.form.fields = await processFormFields(v.config.form.fields, ctx, objId, moduleId);
							}
						}

						if(v.config && v.config['popup.form'] && v.config['popup.form'].source && v.config['popup.form'].source.type=="sql") {
							if(v.config.hooks) v.config['popup.form'].source.hooks = v.config.hooks;
							v.config['popup.form'].source.refid = tempObj.source.refid;
							const newRefID1 = `${objId}.infoview_popup.${k}`;
							const dbOpsID = await DBOPS.storeDBOpsQuery(v.config['popup.form'].source, v.config['popup.form'].fields, "fetch", v.config['popup.form'].forcefill?v.config['popup.form'].forcefill:{}, ctx.meta.user, {newRefID1, moduleId, "refid": tempObj.source.refid}, v.config['popup.form'].hooks?v.config['popup.form'].hooks:{});
							v.config['popup.form'].source = {
								"type": "sql",
								"dbopsid": dbOpsID
							};
							if(v.config['popup.form'].fields) {
								v.config['popup.form'].fields = await processFormFields(v.config['popup.form'].fields, ctx, objId, moduleId);
							}
						}
					};
				}
				
				jsonObj = tempObj;
				break;
			case "dashboards":
			case "dashboard":
				const cardList = Object.keys(tempObj.cards);
				for (var i = cardList.length - 1; i >= 0; i--) {
					const k = cardList[i];
					const v = tempObj.cards[k];
					if(v.source && v.source.type && v.source.type=="sql") {
						tempObj.cards[k].source = {
							type: "sql",
							queryid: await QUERY.storeQuery(v.source, ctx.meta.user, false, {objId, moduleId, "refid": `cards.${k}`}),
						};
					}
				}
				if(tempObj.filters) {
					const filterList = Object.keys(tempObj.filters);
					for (var i = filterList.length - 1; i >= 0; i--) {
						const k = filterList[i];
						const v = tempObj.filters[k];
						if(v.table) {
							tempObj.filters[k] = {
								...v,
								queryid: await QUERY.storeQuery(v.filter, ctx.meta.user, false, {objId, moduleId, "refid": `filters.${k}`}),
							};
							if(tempObj.filters[k].table) delete tempObj.filters[k].table;
							if(tempObj.filters[k].columns) delete tempObj.filters[k].columns;
							if(tempObj.filters[k].where) delete tempObj.filters[k].where;
						}
					}
				}

				jsonObj = tempObj;
				break;
			case "charts":
				if(tempObj.filters) {
					const filterList = Object.keys(tempObj.filters);
					for (var i = filterList.length - 1; i >= 0; i--) {
						const k = filterList[i];
						const v = tempObj.filters[k];
						if(v.table) {
							tempObj.filters[k] = {
								...v,
								queryid: await QUERY.storeQuery(v.filter, ctx.meta.user, false, {objId, moduleId, "refid": `filters.${k}`}),
							};
							if(tempObj.filters[k].table) delete tempObj.filters[k].table;
							if(tempObj.filters[k].columns) delete tempObj.filters[k].columns;
							if(tempObj.filters[k].where) delete tempObj.filters[k].where;
						}
					}
				}
			case "reports":
				// tempObj.datagrid.filter && type!= "dataMethod" && .table
				const datagridList = Object.keys(tempObj.datagrid);
				for (var i = datagridList.length - 1; i >= 0; i--) {
					const k = datagridList[i];
					const v = tempObj.datagrid[k];
					
					if(v.filter && v.filter.table) {
						// 	tempObj.datagrid[k].filter = {
						// 		type: v.filter.type,
						// 		queryid: await QUERY.storeQuery(v.filter, ctx.meta.user, false, {objId, moduleId, "refid": `datagrid.${k}`}),
						// 	};
						switch(v.filter.type) {
							case 'dataMethod': case 'dataSelector': case 'dataSelectorFromUniques': case 'dataSelectorFromTable':
							case 'dropdown': case 'select': //case 'selectAJAX':
								var selectorOptions = await generateSelector(v.filter, k, ctx);
								if(!selectorOptions) selectorOptions = [];

								tempObj.datagrid[k].filter.type = "select";
								tempObj.datagrid[k].filter.options = selectorOptions;

								if(tempObj.datagrid[k].filter.table) delete tempObj.datagrid[k].filter.table;
								if(tempObj.datagrid[k].filter.columns) delete tempObj.datagrid[k].filter.columns;
								if(tempObj.datagrid[k].filter.where) delete tempObj.datagrid[k].filter.where;
							break;
						}
					}
					if(v.editor && v.editor.table) {
						// tempObj.datagrid[k].editor = {
						// 	type: v.editor.type,
						// 	queryid: await QUERY.storeQuery(v.editor, ctx.meta.user, false, {objId, moduleId, "refid": `datagrid.${k}`}),
						// };

						switch(v.editor.type) {
							case 'dataMethod': case 'dataSelector': case 'dataSelectorFromUniques': case 'dataSelectorFromTable':
							case 'dropdown': case 'select': //case 'selectAJAX':
								var selectorOptions = await generateSelector(v.editor, k, ctx);
								if(!selectorOptions) selectorOptions = [];

								tempObj.datagrid[k].editor.type = "select";
								tempObj.datagrid[k].editor.options = selectorOptions;

								if(tempObj.datagrid[k].editor.table) delete tempObj.datagrid[k].editor.table;
								if(tempObj.datagrid[k].editor.columns) delete tempObj.datagrid[k].editor.columns;
								if(tempObj.datagrid[k].editor.where) delete tempObj.datagrid[k].editor.where;
							break;
						}
					}
				}
			default:
				if(tempObj.source && tempObj.source.type=="sql") {
					if(!tempObj.source.columns && tempObj.source.cols) {
						tempObj.source.columns = tempObj.source.cols;
						delete tempObj.source.cols;
					}
					
					const queryID = await QUERY.storeQuery(tempObj.source, ctx.meta.user, false, {objId, moduleId, "refid": "source"});
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

async function processFormFields(formFields, ctx, objId, moduleId) {
	const fieldList = Object.keys(formFields);
	for (var i = fieldList.length - 1; i >= 0; i--) {
		const k = fieldList[i];
		const v = formFields[k];

		switch(v.type) {
			case 'dataMethod': case 'dataSelector': case 'dataSelectorFromUniques': case 'dataSelectorFromTable':
			case 'dropdown': case 'select': //case 'selectAJAX':
				var selectorOptions = await generateSelector(v, k, ctx);
				if(!selectorOptions) selectorOptions = [];
				
				formFields[k].type = "select";
				formFields[k].options = selectorOptions;

				if(formFields[k].table) delete formFields[k].table;
				if(formFields[k].columns) delete formFields[k].columns;
				if(formFields[k].where) delete formFields[k].where;
				break;
			default:
				if(v.table) {
					formFields[k] = {
						...v,
						queryid: await QUERY.storeQuery(v, ctx.meta.user, false, {objId, moduleId}),
					};
					if(formFields[k].table) delete formFields[k].table;
					if(formFields[k].columns) delete formFields[k].columns;
					if(formFields[k].where) delete formFields[k].where;
				}
		}
		if(v.ajaxchain) {
			if(Array.isArray(v.ajaxchain))
				for (let k1 = 0; k1 < v.ajaxchain.length; k1++) {
					const obj = v.ajaxchain[k1];
					
					v.ajaxchain[k1].src = {
						"type": "sql",
						queryid: await QUERY.storeQuery(v.ajaxchain[k1].src, ctx.meta.user, false, {objId, moduleId, "refid": `fields.${k}.ajaxchain.${k1}`}),
					}
				}
			else
				v.ajaxchain.src = {
					"type": "sql",
					queryid: await QUERY.storeQuery(v.ajaxchain.src, ctx.meta.user, false, {objId, moduleId, "refid": `fields.${k}.ajaxchain.0`}),
				};
		}
	}

	return formFields;
}

async function generateSelector(fieldObj, fieldKey, ctx) {
	switch(fieldObj.type) {
		case 'dataMethod': 
			if(fieldObj.src) return await _call(fieldObj.src, fieldObj);
			else if(fieldObj.method) return await _call(fieldObj.method, fieldObj);
			return [];
			break;
		case 'dataSelector': 
			if(!fieldObj.groupid) return [];
			const sqlData1 = await _DB.db_selectQ("appdb", "do_lists", "title, value, class, privilege", {
					"blocked": false,
					"guid": ctx.meta.user.guid,
					"groupid": fieldObj.groupid,
					"privilege": [["*", ctx.meta.user.privilege], "IN"]
				}, {}, " ORDER BY sortorder ASC");
			if(!sqlData1.results) sqlData1.results = [];
			return sqlData1.results;
			break;
		case 'dataSelectorFromUniques': 
			// fieldObj.where['guid'] = ctx.meta.user.guid;
			const sqlData2 = await _DB.db_selectQ("appdb", fieldObj.table, fieldObj.cols || fieldObj.columns || fieldObj.column, fieldObj.where, {}, ` GROUP BY ${fieldObj.groupby || 'id'} ORDER BY ${fieldObj.orderby || 'id'}`);
			if(!sqlData2.results) sqlData2.results = [];
			return sqlData2.results;
			break;
		case 'dataSelectorFromTable':
			const sqlData3 = await _DB.db_selectQ("appdb", fieldObj.table, fieldObj.cols || fieldObj.columns || fieldObj.column, fieldObj.where, {}, ` GROUP BY ${fieldObj.groupby || 'id'} ORDER BY ${fieldObj.orderby || 'id'}`);
			if(!sqlData3.results) sqlData3.results = [];
			return sqlData3.results;
			break;
		case 'dropdown':
		case 'select': 
			if(!fieldObj.options) return [];
			return fieldObj.options;
			break;
	}
}