// JSON Object Processor
// This helper is responsible for multiple key updates to all JSON objects that goes through the system

module.exports = {

    initialize: function() {
        // console.log("\x1b[36m%s\x1b[0m","DBOperation Engine Initialized");
    },

    processJSONComponent: async function(jsonObj, objId, moduleId, ctx) {
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
                    tempObj.fields = await JSONPROCESSOR.processFormFields(tempObj.fields, ctx, objId, moduleId);

                    if(tempObj.infoview && tempObj.infoview.groups) {
                        const groupList = Object.keys(tempObj.infoview.groups);
                        for (var i = groupList.length - 1; i >= 0; i--) {
                            const k = groupList[i];
                            const v = tempObj.infoview.groups[k];

                            if(v.policy && v.policy.length>0) {
                                var isAllowed = await RBAC.checkPolicy(ctx, v.policy);
                                if(!isAllowed) {
                                    delete tempObj.infoview.groups[k];
                                    continue;
                                }
                            }

                            if(v.config && v.config.table) {
                                if(!tempObj.infoview.groups[k].config.columns && tempObj.infoview.groups[k].config.cols) {
                                    tempObj.infoview.groups[k].config.columns = tempObj.infoview.groups[k].config.cols;
                                    delete tempObj.infoview.groups[k].config.cols;
                                }
                                const newRefID1 = `${objId}.infoviewTable.${k}`;
                                tempObj.infoview.groups[k].config = {
                                    ...v.config,
                                    queryid: await QUERY.storeQuery(v.config, ctx.meta.user, false, {objId: newRefID1, moduleId, "refid": `infoview.groups.${k}`}),
                                };

                                if(tempObj.infoview.groups[k].config.table) delete tempObj.infoview.groups[k].config.table;
                                if(tempObj.infoview.groups[k].config.columns) delete tempObj.infoview.groups[k].config.columns;
                                if(tempObj.infoview.groups[k].config.where) delete tempObj.infoview.groups[k].config.where;
                            }

                            if(v.config && v.config.form && v.config.form.source && v.config.form.source.type=="sql") {
                                if(v.config.hooks) v.config.form.source.hooks = v.config.hooks;
                                v.config.form.source.refid = tempObj.source.refid;
                                const newRefID = `${objId}.infoview.${k}`;
                                const dbOpsID = await DBOPS.storeDBOpsQuery(v.config.form.source, v.config.form.fields, "fetch", v.config.form.forcefill?v.config.form.forcefill:{}, ctx.meta.user, {objId: newRefID, moduleId, "refid": tempObj.source.refid}, v.config.form.hooks?v.config.form.hooks:{});
                                v.config.form.source = {
                                    "type": "sql",
                                    "dbopsid": dbOpsID
                                };

                                if(v.config.form.fields) {
                                    v.config.form.fields = await JSONPROCESSOR.processFormFields(v.config.form.fields, ctx, objId, moduleId);
                                }
                            }

                            if(v.config && v.config['popup.form'] && v.config['popup.form'].source && v.config['popup.form'].source.type=="sql") {
                                if(v.config.hooks) v.config['popup.form'].source.hooks = v.config.hooks;
                                v.config['popup.form'].source.refid = tempObj.source.refid;
                                const newRefID1 = `${objId}.infoview_popup.${k}`;
                                const dbOpsID = await DBOPS.storeDBOpsQuery(v.config['popup.form'].source, v.config['popup.form'].fields, "fetch", v.config['popup.form'].forcefill?v.config['popup.form'].forcefill:{}, ctx.meta.user, {objId: newRefID1, moduleId, "refid": tempObj.source.refid}, v.config['popup.form'].hooks?v.config['popup.form'].hooks:{});
                                v.config['popup.form'].source = {
                                    "type": "sql",
                                    "dbopsid": dbOpsID
                                };
                                if(v.config['popup.form'].fields) {
                                    v.config['popup.form'].fields = await JSONPROCESSOR.processFormFields(v.config['popup.form'].fields, ctx, objId, moduleId);
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

                        if(v.policy && v.policy.length>0) {
                            var isAllowed = await RBAC.checkPolicy(ctx, v.policy);
                            if(!isAllowed) {
                                delete tempObj.cards[k];
                                continue;
                            }
                        }

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
                case "reports":
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

                    // tempObj.datagrid.filter && type!= "dataMethod" && .table
                    const datagridList = Object.keys(tempObj.datagrid);
                    for (var i = datagridList.length - 1; i >= 0; i--) {
                        const k = datagridList[i];
                        const v = tempObj.datagrid[k];

                        if(v.policy && v.policy.length>0) {
                            var isAllowed = await RBAC.checkPolicy(ctx, v.policy);
                            if(!isAllowed) {
                                delete tempObj.datagrid[k];
                                continue;
                            }
                        }
                        
                        if(v.filter && v.filter.table) {
                            // 	tempObj.datagrid[k].filter = {
                            // 		type: v.filter.type,
                            // 		queryid: await QUERY.storeQuery(v.filter, ctx.meta.user, false, {objId, moduleId, "refid": `datagrid.${k}`}),
                            // 	};
                            switch(v.filter.type) {
                                case 'dataMethod': case 'dataSelector': case 'dataSelectorFromUniques': case 'dataSelectorFromTable':
                                case 'dropdown': case 'select': //case 'selectAJAX':
                                    var selectorOptions = await JSONPROCESSOR.generateSelector(v.filter, k, ctx);
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
                                    var selectorOptions = await JSONPROCESSOR.generateSelector(v.editor, k, ctx);
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

                    jsonObj = tempObj;
                    break;
                default:
                    //For other file types like layout, pages etc
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
    },

    processFormFields: async function(formFields, ctx, objId, moduleId) {
        if(!formFields) return {};
        const fieldList = Object.keys(formFields);
        for (var i = fieldList.length - 1; i >= 0; i--) {
            const k = fieldList[i];
            const v = formFields[k];

            if(v.policy && v.policy.length>0) {
                var isAllowed = await RBAC.checkPolicy(ctx, v.policy);
                if(!isAllowed) {
                    delete formFields[k];
                    continue;
                }
            }

            switch(v.type) {
                case 'dataMethod': case 'dataSelector': case 'dataSelectorFromUniques': case 'dataSelectorFromTable':
                case 'dropdown': case 'select': case 'autosuggest'://case 'selectAJAX':
                    // v.table = 
                    // v.columns = 
                    // v.columns = 
                    var selectorOptions = await JSONPROCESSOR.generateSelector(v, k, ctx);
                    if(!selectorOptions) selectorOptions = [];
                    
                    formFields[k].type = "select";
                    formFields[k].options = selectorOptions;

                    if(formFields[k].table) delete formFields[k].table;
                    if(formFields[k].columns) delete formFields[k].columns;
                    if(formFields[k].where) delete formFields[k].where;
                    
                    if(v.type=="autosuggest") {
                        formFields[k].type = "autosuggest";
                    }
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
                        
                        if(obj.type=="sql") {
                            v.ajaxchain[k1].src = {
                                "type": "sql",
                                queryid: await QUERY.storeQuery(v.ajaxchain[k1].src, ctx.meta.user, false, {objId, moduleId, "refid": `fields.${k}.ajaxchain.${k1}`}),
                            }
                        }
                    }
                else {
                    if(v.ajaxchain.type=="sql") {
                        v.ajaxchain.src = {
                            "type": "sql",
                            queryid: await QUERY.storeQuery(v.ajaxchain.src, ctx.meta.user, false, {objId, moduleId, "refid": `fields.${k}.ajaxchain.0`}),
                        };
                    }
                }
            }
            if(v.autocomplete) {
                if(!v.autocomplete.src.type) v.autocomplete.src.type = "sql";
                if(v.autocomplete.src.type=="sql") {
                    v.autocomplete.src = {
                        "type": "sql",
                        queryid: await QUERY.storeQuery(v.autocomplete.src, ctx.meta.user, false, {objId, moduleId, "refid": `fields.${k}.autocomplete.0`}),
                    };
                }
            }
            if(v.default && v.default.length>0) {
                v.default = _replaceCtx(v.default, ctx);
            }
        }

        return formFields;
    },
    generateSelector: async function(fieldObj, fieldKey, ctx) {
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
            case 'autosuggest':
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
}