"use strict";

const USER_STATE_MAP = {};

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

                if(!USER_STATE_MAP[ctx.meta.user.tenantId]) USER_STATE_MAP[ctx.meta.user.tenantId] = {};
                if(!USER_STATE_MAP[ctx.meta.user.tenantId][ctx.meta.user.userId]) USER_STATE_MAP[ctx.meta.user.tenantId][ctx.meta.user.userId] = {};
                
                if(ctx.params.state) {
                    USER_STATE_MAP[ctx.meta.user.tenantId][ctx.meta.user.userId][STATE_KEY] = ctx.params.state;
                }

                if(USER_STATE_MAP[ctx.meta.user.tenantId][ctx.meta.user.userId][STATE_KEY]) {
                    return USER_STATE_MAP[ctx.meta.user.tenantId][ctx.meta.user.userId][STATE_KEY];
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
                
                if(!USER_STATE_MAP[ctx.meta.user.tenantId]) USER_STATE_MAP[ctx.meta.user.tenantId] = {};
                if(!USER_STATE_MAP[ctx.meta.user.tenantId][ctx.meta.user.userId]) USER_STATE_MAP[ctx.meta.user.tenantId][ctx.meta.user.userId] = {};

                USER_STATE_MAP[ctx.meta.user.tenantId][ctx.meta.user.userId][STATE_KEY] = ctx.params.state;
                
                return {
                    "status": "okay",
                    "state": USER_STATE_MAP[ctx.meta.user.tenantId][ctx.meta.user.userId][STATE_KEY],
                    "timestamp": Date.now()
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
                
                if(!USER_STATE_MAP[ctx.meta.user.tenantId]) USER_STATE_MAP[ctx.meta.user.tenantId] = {};
                if(!USER_STATE_MAP[ctx.meta.user.tenantId][ctx.meta.user.userId]) USER_STATE_MAP[ctx.meta.user.tenantId][ctx.meta.user.userId] = {};
                
                if(USER_STATE_MAP[ctx.meta.user.tenantId][ctx.meta.user.userId][STATE_KEY]) delete USER_STATE_MAP[ctx.meta.user.tenantId][ctx.meta.user.userId][STATE_KEY];
                
                return {
                    "status": "okay",
                    "state": USER_STATE_MAP[ctx.meta.user.tenantId][ctx.meta.user.userId][STATE_KEY],
                    "timestamp": Date.now()
                };
            }
        },
        resetUser: {
            rest: {
				method: "POST",
				path: "/resetUser"
			},
			async handler(ctx) {
                //var STATE_KEY = `${ctx.meta.user.tenantId}_${ctx.meta.user.userId}_${ctx.params.module}`;
                
                if(!USER_STATE_MAP[ctx.meta.user.tenantId]) USER_STATE_MAP[ctx.meta.user.tenantId] = {};
                if(USER_STATE_MAP[ctx.meta.user.tenantId][ctx.meta.user.userId]) {
                    delete USER_STATE_MAP[ctx.meta.user.tenantId][ctx.meta.user.userId];
                }
                
                return {
                    "status": "okay",
                    "timestamp": Date.now()
                };
            }
        }
    }
}