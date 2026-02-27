//All Node Related Admin Functionalities to control worker nodes

"use strict";

module.exports = {
	name: "admin.plugins",

	actions: {
        listNodes: {
			rest: {
				method: "GET",
				path: "/"
			},
			params: {
                more: { type: "string", optional: true, default: "false" }
            },
            async handler(ctx) {
                ctx.call("admin.verifyAdmin", {}, { meta: ctx.meta })

                ctx.params.more = ctx.params.more || "false";
                
                if(ctx.params.more === "true")
                    return await ctx.call("system.plugins", {"more": true});
                else
                    return await ctx.call("system.plugins");
            }
        },
        nodeInfo: {
            rest: {
                method: "GET",
                path: "/info/:plugin"
            },
            params: {
                plugin: "string"
            },
            handler(ctx) {
                ctx.call("admin.verifyAdmin", {}, { meta: ctx.meta })

                // const plugin = ctx.broker.plugins.find(n => n.name === ctx.params.plugin);
                // if (plugin) {
                //     return plugin;
                // } else {
                //     throw new Error(`Plugin with name ${ctx.params.plugin} not found.`);
                // }
                return {"status": "error", "message": "Source Not found"};
            }
        },
    },

    methods: { 
    }
}