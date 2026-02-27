//uset state management
"use strict";

module.exports = {
	name: "userstates",

	actions: {
		fetch: {
            rest: {
				method: "POST",
				path: "/"
			},
            params: {
                module: "string",
                // state: "object"
            },
			async handler(ctx) {
                var STATE_KEY = `${ctx.meta.user.tenantId}_${ctx.meta.user.userId}_${ctx.params.module}`;

                var stateObj = CACHEMAP.get("USER_STATE_MAP", STATE_KEY);

                if(ctx.params.state) {
                    stateObj = ctx.params.state;
                    CACHEMAP.set("USER_STATE_MAP", STATE_KEY, stateObj);
                }

                if(stateObj) {
                    return stateObj;
                } else {
                    return {};
                }
            }
        },
        save: {
            rest: {
				method: "POST",
				path: "/save"
			},
            params: {
                module: "string",
                state: "object"
            },
			async handler(ctx) {
                var STATE_KEY = `${ctx.meta.user.tenantId}_${ctx.meta.user.userId}_${ctx.params.module}`;
                
                var stateObj = CACHEMAP.get("USER_STATE_MAP", STATE_KEY);

                stateObj = ctx.params.state;
                
                CACHEMAP.set("USER_STATE_MAP", STATE_KEY, stateObj);

                return {
                    "status": "okay",
                    "state": stateObj,
                    "module": ctx.params.module,
                    "timestamp": new moment(str).format("YYYY-MM-DD HH:mm:ss")
                };
            }
        },
        reset: {
            rest: {
				method: "POST",
				path: "/reset"
			},
            params: {
                module: "string"
            },
			async handler(ctx) {
                var STATE_KEY = `${ctx.meta.user.tenantId}_${ctx.meta.user.userId}_${ctx.params.module}`;
                
                CACHEMAP.set("USER_STATE_MAP", STATE_KEY, {});

                return {
                    "status": "okay",
                    "state": {},
                    "module": ctx.params.module,
                    "timestamp": new moment(str).format("YYYY-MM-DD HH:mm:ss")
                };
            }
        }
    }
}