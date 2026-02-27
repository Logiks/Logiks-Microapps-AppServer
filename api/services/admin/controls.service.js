//For control Center

"use strict";

const os = require("os");

module.exports = {
	name: "admin.ctrls",

	actions: {
        //Control Center for the Server
		ctrls: {
			rest: {
				method: "POST",
				path: "/:task?/:refid?"
			},
			params: {},
			async handler(ctx) {
				ctx.call("admin.verifyAdmin", {}, { meta: ctx.meta })

                if(!CONTROLS[ctx.params.task]) return {"status": "okay", "commands": Object.keys(CONTROLS)};
                else return await CONTROLS[ctx.params.task](ctx);
			}
		},
    }
}

const CONTROLS = {
    "stats": async function(ctx) {
        const [nodes, services, health] = await Promise.all([
            ctx.call("$node.list"),
            ctx.call("$node.services"),
            ctx.call("$node.health"),
        ]);

        const mem = process.memoryUsage();

        return {
            timestamp: moment().format("Y-M-D HH:mm:ss"),
            nodeCount: nodes.length,
            serviceCount: services.length,
            hostname: os.hostname(),
            uptime: process.uptime(),
            memory: {
                load: os.loadavg()[0], // 1-minute load avg
                rssMB: (mem.rss / 1024 / 1024).toFixed(2),
                heapUsedMB: (mem.heapUsed / 1024 / 1024).toFixed(2)
            },
            nodes: nodes.map(n => ({
                id: n.id,
                hostname: n.hostname,
                ip: n.ipList,
                available: n.available,
                // cpu: n.cpu,
                client: n.client,
                // services: services.map(s => s.name),
                // metadata: n.metadata
            })),
            health: health
        };
    }, 
    "routeStats": async function(ctx) {
        const stats = await ctx.call("system.routeStatsSummary");
        return stats;
    }, 
    "restart": async function(ctx) {}, 
    "restartNode": async function(ctx) {}, 
    "restartAll": async function(ctx) {}, 
    "check_update": async function(ctx) {}, 
    "run_update": async function(ctx) {}, 
    "nodes": async function(ctx) {}, 
    "nodeInfo": async function(ctx) {}, 
    "services": async function(ctx) {}, 
    "backup": async function(ctx) {}, 
    "app_module_map": async function(ctx) {}, 
};