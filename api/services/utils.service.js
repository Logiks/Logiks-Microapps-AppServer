//Misc Utility Service Endpoints

module.exports = {
	name: "utils",

	actions: {
        getDOMRule: {
            rest: {
				method: "GET",
				fullPath: "/api/domrules/:ruleId"
			},
			async handler(ctx) {
                var data = await _DB.db_selectQ("appdb", "sys_domrules", "*", {
                        blocked: "false",
                        rulecode: ctx.params.ruleId,
                    },{});
                if(!data || !data?.results || data.results.length<=0) data = [];
                
                return {"status": "success", "data": data};
            }
        },
		runRule: {
            rest: {
				method: "POST",
				fullPath: "/api/rules/:ruleId"
			},
            params: {
                "fields": "object",
                // "addonFacts": "object",
            },
			async handler(ctx) {
                const results = await RULEENGINE.processRule(ctx.params.ruleId, ctx.params.fields, ctx.params.addonFacts);
                return results;
            }
        },
        runAPI: {
            rest: {
				method: "POST",
				fullPath: "/api/api/:apiCode"
			},
            params: {
                // "query": "object",
                // "body": "object",
            },
			async handler(ctx) {
                const results = await APIHUB.runAPI(ctx.params.apiCode, {
                    query: ctx.params.query || {},
                    body: ctx.params.body || {}
                }, ctx);
                return results;
            }
        },
        runValidation: {
            rest: {
				method: "POST",
				fullPath: "/api/validate/:ruleId"
			},
            params: {
                "fields": "object"
            },
			async handler(ctx) {
                const results = await VALIDATIONS.processRule(ctx.params.ruleId, ctx.params.fields);
                return results;
            }
        },
        logActivity: {
            rest: {
				method: "POST",
				fullPath: "/api/log/:logId"
			},
            params: {
                // "type": "string",//local, db
                "group": "string",
                "data": "object"
            },
			async handler(ctx) {
                if(!req.params.type || ["local", "db"].indexOf(req.params.type)<0)  req.params.type = "db";
                if(!req.params.level)  req.params.level = "info";

                const logID = req.params.logId;//"activities"
                const appID = req.meta.appInfo.appid;
                const guid = req.meta.user.tenantId;
                
                ctx.params.data.guid = guid;
                ctx.params.data.appid = appID;
                
                if(req.params.type=="db")
                    _DBLOGGER._log(logID, ctx.params.data, ctx);
                else
                    LOGGER.log(ctx.params.data, logID, req.params.level);
            }
        },
        ctrlcenterGet: {
            rest: {
				method: "GET",
				fullPath: "/api/ctrlcenter/:module/:ctrlId?"
			},
			async handler(ctx) {
                const whereLogic = {
                    blocked: "false",
                    guid: ctx.meta.user.guid,
                    module: ctx.params.module,
                };
                if(ctx.params.ctrlId && ctx.params.ctrlId.length>0) {
                    whereLogic["var_code"] = ctx.params.ctrlId;
                }
                var data = await _DB.db_selectQ("appdb", "lgks_ctrlcenter", "module, var_title, var_code, var_value", whereLogic,{});
                if(!data || !data?.results || data.results.length<=0) data = {results: []};
                
                return {"status": "success", "module": ctx.params.module, "controls": data.results};
            }
        },
        listCacheKey: {
            rest: {
				method: "GET",
				fullPath: "/api/cacheMap"
			},
            async handler(ctx) {
                return {"status": "success", "data": _CACHE.listCacheKeys()};
            }
        },
        clearCache: {
            rest: {
				method: "GET",
				fullPath: "/api/cacheMap/clear/:cacheId?"
			},
            async handler(ctx) {
                _CACHE.deleteCacheMap(ctx.params.cacheId);
                return {"status": "success"};
            }
        }
    }
}