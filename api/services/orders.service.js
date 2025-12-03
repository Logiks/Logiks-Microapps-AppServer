"use strict";

module.exports = {
	name: "orders",

	actions: {
		/**
		 * List orders for current tenant.
		 * GET /api/orders/orders
		 */
		list: {
			rest: {
				method: "GET",
				path: "/orders"
			},
			meta: {
				// tenant-aware: requires "<tenantId>:orders:read"
				scopes: ["orders:read"]
			},
			async handler(ctx) {
				const user = ctx.meta.user || {};
				const tenantId = user.tenantId;

				// TODO: fetch from DB filtered by tenantId
				return [
					{ id: 1, tenantId, item: "Item A" },
					{ id: 2, tenantId, item: "Item B" }
				];
			}
		}
	}
};
