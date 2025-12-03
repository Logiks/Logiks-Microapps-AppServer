"use strict";

const { Errors } = require("moleculer");
const { MoleculerClientError } = Errors;

module.exports = {
	name: "admin",

	actions: {
		/**
		 * Admin-only endpoint (requires admin role).
		 * GET /api/admin/users
		 */
		users: {
			rest: {
				method: "GET",
				path: "/users"
			},
			// could add scopes too if you want additional control
			async handler(ctx) {
				const user = ctx.meta.user || {};
				if (!user.roles || !user.roles.includes("admin")) {
					throw new MoleculerClientError("Forbidden", 403, "FORBIDDEN_ADMIN_ONLY");
				}

				// TODO: read user list from DB
				return [
					{ id: 1, username: "admin", tenantId: "tenant-1" },
					{ id: 2, username: "user1", tenantId: "tenant-1" }
				];
			}
		}
	}
};
