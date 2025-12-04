// /api/services/swagger.service.js
"use strict";

module.exports = {
	name: "swagger",

	actions: {
		openapi: {
			rest: {
				method: "GET",
				path: "/openapi.json"
			},
			// meta: {
			// 	scopes: ["docs:read"] // only those with docs:read (tenant-aware) see docs
			// },
			async handler(ctx) {
				const actions = this.broker.registry.getActionList({
					withEndpoints: true,
					onlyLocal: true
				});

				const paths = {};

				for (const item of actions) {
					const def = item.action;
					const fullName = def.name; // e.g. "auth.login"

					// Only actions with rest definitions
					if (!def.rest) continue;

					let method = "get";
					let subPath = "";
					let basePath = "/api"; // default

					if (typeof def.rest === "string") {
						// rest: "/foo"
						subPath = def.rest;
					} else {
						// rest: { method, path }
						method = (def.rest.method || "get").toLowerCase();
						subPath = def.rest.path || "/";
						// Optional: if you want separate base paths for public vs private
						if (fullName.startsWith("auth.") || fullName.startsWith("public.")) {
							basePath = "/api/public";
						}
					}

					const openapiPath = `${basePath}${subPath}`;
					if (!paths[openapiPath]) {
						paths[openapiPath] = {};
					}

					const requiresAuth = this._actionRequiresAuth(def, fullName);

					paths[openapiPath][method] = {
						tags: [fullName.split(".")[0]],
						summary: def.summary || fullName,
						description: def.description || "",
						security: requiresAuth ? [{ BearerAuth: [] }] : [],
						responses: {
							"200": {
								description: "Success"
							}
						}
					};
				}

				return {
					openapi: "3.0.0",
					info: {
						title: "Moleculer API",
						version: "1.0.0"
					},
					paths,
					components: {
						securitySchemes: {
							BearerAuth: {
								type: "http",
								scheme: "bearer",
								bearerFormat: "JWT"
							}
						}
					}
				};
			}
		}
	},

	methods: {
		/**
		 * Heuristic: which actions require auth?
		 * You can refine this based on naming or meta flags.
		 */
		_actionRequiresAuth(actionDef, fullName) {
			// Auth endpoints themselves are public
			if (
				fullName.startsWith("auth.login") ||
				fullName.startsWith("auth.requestOtp") ||
				fullName.startsWith("auth.verifyOtp") ||
				fullName.startsWith("auth.refresh") ||
				fullName.startsWith("public.")
			) {
				return false;
			}

			// If action has scopes in meta -> protected
			if (Array.isArray(actionDef.meta?.scopes) && actionDef.meta.scopes.length) {
				return true;
			}

			// Default: protected except explicitly public
			return true;
		}
	}
};
