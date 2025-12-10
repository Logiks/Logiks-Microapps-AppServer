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
                if(!data) data = [];
                
                return {"status": "success", "data": data};
            }
        },
		runRule: {
            rest: {
				method: "POST",
				fullPath: "/api/rules/:ruleId"
			},
            params: {
                "fields": "object"
            },
			async handler(ctx) {
                const results = await RULEENGINE.processRule(ctx.params.ruleId, ctx.params.fields);
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
                "level": "string",
                "group": "string",
                "data": "object"
            },
			async handler(ctx) {
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
                        module: ctx.params.module,
                    };
                if(ctx.params.ctrlId && ctx.params.ctrlId.length>0) {
                    whereLogic["var_code"] = ctx.params.ctrlId;
                }
                var data = await _DB.db_selectQ("appdb", "do_ctrlcenter", "*", whereLogic,{});
                if(!data) data = [[]];
                
                return {"status": "success", "data": data[0]};
            }
        },
        clearCache: {
            rest: {
				method: "GET",
				fullPath: "/api/clearCache/:cacheId?"
			},
            async handler(ctx) {
                
                return {"status": "success"};
            }
        }
    }
}