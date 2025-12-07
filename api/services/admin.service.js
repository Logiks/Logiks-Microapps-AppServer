"use strict";

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
					throw new LogiksError("Forbidden", 403, "FORBIDDEN_ADMIN_ONLY");
				}

				// TODO: read user list from DB
				return [
					{ id: 1, username: "admin", tenantId: "tenant-1" },
					{ id: 2, username: "user1", tenantId: "tenant-1" }
				];
			}
		},

		files: {
			rest: {
				method: "POST",
				path: "/files"
			},
			params: {
				path: "string"
			},
			// could add scopes too if you want additional control
			async handler(ctx) {
				return [];
			}
		},

		filesPreview: {
			rest: {
				method: "POST",
				path: "/files/content"
			},
			params: {
				file: "string"
			},
			// could add scopes too if you want additional control
			async handler(ctx) {
				return "";
			}
		},

		filesUpload: {
			rest: {
				method: "POST",
				path: "/files/upload"
			},
			params: {
				file: "string",
				content: "string"
			},
			// could add scopes too if you want additional control
			async handler(ctx) {
				return {};
			}
		}
	}
};
