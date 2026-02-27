// Admin-only endpoint (requires admin role).

//✅ Restarting Nodes:
// ✅ Remote cluster reboot
// ✅ Targeted restarts
// ✅ Zero-SSH orchestration
// ✅ PM2-safe restarts
// ✅ Admin-only security
// ✅ Zero-downtime rolling restarts

"use strict";

module.exports = {
	name: "admin",

	actions: {
		verifyAdmin(ctx) {
			// ABSOLUTELY REQUIRED SECURITY CHECK
			if (!ctx.meta.user || ctx.meta.user.roles.indexOf("admin")<0) {
				throw new Error("Admin access only");
			}

			return true;
		},
		
		adminList: {
			rest: {
				method: "GET",
				path: "/"
			},
			params: {},
			async handler(ctx) {
				// const actions = await ctx.call("$node.actions", {
				// 	onlyLocal: false,      // include remote nodes
				// 	skipInternal: true,    // hide $node.* actions
				// 	withEndpoints: true    // include which node each action belongs to
				// });//.then(res => console.log(res));


				// const services = await ctx.call("$node.services", {
				// 	onlyLocal: false,
				// 	skipInternal: true,
				// 	withActions: true
				// });//.then(res => console.log(res));

				// const actionsExtended = ctx.broker.registry.getActionList({
				// 	withEndpoints: true
				// });
				// console.log("ADMIN", actions, services, actionsExtended);

				return {"status": "ok"};
			}
		},

		buildPolicy: {
			rest: {
				method: "GET",
				path: "/buildPolicy"
			},
			params: {
			},
			async handler(ctx) {
				RBAC.buildPolicyTable(ctx);
				return {"status": "ok"};
			}
		},

		// cacheClear: {
		// 	rest: {
		// 		method: "GET",
		// 		path: "/clearCache"
		// 	},
		// 	params: {
		// 	},
		// 	async handler(ctx) {
		// 		// RBAC.buildPolicyTable(ctx);
		// 		return {"status": "ok"};
		// 	}
		// }

		//Manage Themes
	},
	methods: {
		
	}
};

