// /api/services/swagger.service.js
"use strict";

if(isProd || isStaging) {
	module.exports = {
		name: "developers",
		actions: {
		}
	};
} else {
	module.exports = {
		name: "developers",
		// version: 1,

		settings: {
			exposePrivate: false,   // show private actions or not
        	__file: __filename
		},

		actions: {
			listRoutesJSON: {
				rest: {
					method: "GET",
					path: "/routes.json"
				},
				description: "List all available API routes with params & metadata as JSON format",
				params: {
					allAPI: { type: "string", optional: true, default: false },//Functions that can be called over API
					allServices: { type: "string", optional: true, default: false },//Functions that can be called using ctx.call
					// publicOnly: { type: "string", optional: true, default: true },
					search: { type: "string", optional: true }
				},
				async handler(ctx) {
					return this.actions.listRoutes(ctx.params);
				}
			},
			listRoutes: {
				rest: {
					method: "GET",
					path: "/routes"
				},
				description: "List all available API routes with params & metadata",
				params: {
					allAPI: { type: "string", optional: true, default: false },//Functions that can be called over API
					allServices: { type: "string", optional: true, default: false },//Functions that can be called using ctx.call
					// publicOnly: { type: "string", optional: true, default: true },
					search: { type: "string", optional: true }
				},
				async handler(ctx) {
					const { allAPI, allServices, publicOnly, search } = ctx.params;
					const actions = this.broker.registry.getActionList({
							onlyLocal: false,
							withEndpoints: true,
							skipInternal: true
						});
					
					const results = Object.values(actions)
						.filter(a => {
							// const file = a.service?.settings?.__file;
							if (allServices && !a.action.rest) return true;
							if (allAPI && a.action.rest) return true;
							// if(publicOnly) return a.path?.includes("public");
							return false;
						}).filter(a => {
							if (search && search.length > 0) {
								const s = search.toLowerCase();
								if (a.name.toLowerCase().includes(s)) return true;
								if (a.action.description && a.action.description.toLowerCase().includes(s)) return true;
								if (a.path && a.path.toLowerCase().includes(s)) return true;
								return false;
							} else return true;
						})
						.map(a => this.formatAction(a));
					
					return {
						"total": results.length,
						"routes": results
					};
				}
			},

			/**
			 * Get single route detail
			 */
			fetchRoute: {
				rest: "GET /routes/:name",
				params: {
					name: "string"
				},
				description: "Get detail of a specific API route",
				handler(ctx) {
					const actions = this.broker.registry.getActionList({
							onlyLocal: false,
							withEndpoints: true,
							skipInternal: true
						});
					const action = actions.find(a => a.name === ctx.params.name);
					if (!action) {
						throw new Error("Route not found");
					}
					return this.formatAction(action);
				}
			}
        },

		methods: {
			formatAction(action) {
				const params = action.action?.params || {};

				return {
					name: action.name,
					service: action.action?.rawName,
					version: action.action?.version || 0,
					endpoints: action.endpoints,

					description: action.action?.description || "",
					visibility: action.action?.rest ? "published" : "private",

					params: Object.entries(params).map(([key, def]) => ({
						name: key,
						type: def?.type || "any",
						required: !def?.optional,
						default: def?.default,
						rules: def
					})),

					rest: action.action?.rest || null,
					path: action.action?.rest?.path || action.action?.rest?.fullPath || null,
					method: action.action?.rest?.method || "N/A"
				};
			}
		}
    }
}
