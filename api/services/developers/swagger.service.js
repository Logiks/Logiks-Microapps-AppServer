// /api/services/swagger.service.js
"use strict";

if(isProd || isStaging) {
	module.exports = {
		name: "developers.swagger",
		actions: {
		}
	};
} else {
	module.exports = {
		name: "developers.swagger",
		// version: 1,

		settings: {
			__file: __filename,

			title: "Logiks API",
			version: "1.0.0",
			description: "Auto-generated OpenAPI spec",
			// basePath: "/api",
			schemes: ["http", "https"]
		},

		actions: {
			spec: {
				rest: {
					method: "GET",
					path: "/openapi.json"
				},
				description: "Get OpenAPI (Swagger) specification in JSON format",
				handler(ctx) {
					return this.generateSpec(ctx);
				}
			}
		},

		methods: {
			generateSpec(ctx) {
				const actions = this.broker.registry.getActionList({
					onlyLocal: false,
					withEndpoints: true
				});

				const paths = {};

				for (const action of Object.values(actions)) {
					const rest = action.action?.rest;
					if (!rest) continue;
					if(action.name.includes("source") ||
						action.name.includes("www")) continue;

					const restDefs = Array.isArray(rest) ? rest : [rest];

					for (const def of restDefs) {
						let method, path, parameters = [], tag = action.name.split(".")?.[0] || "default";

						if (typeof def === "string") {
							[method, path] = def.split(" ");
						} else {
							method = def.method;
							path = def.path || def.fullPath || "/";
						}

						if(["/list-aliases"].includes(path)) continue;

						const openApiPath = path.replace(/:([^/]+)\?/g, function(match, param) {
							parameters.push({
								"name": param,
								"in": "path",
								"required": true,
								"schema": {
									"type": "string"
								},
								// "description": "Task to execute (e.g. start, stop, deploy)"
							});
							return "{" + param + "}";
						}).replace(/:([^/]+)/g, function(match, param) {
							parameters.push({
								"name": param,
								"in": "path",
								"required": true,
								"schema": {
									"type": "string"
								},
								// "description": "Task to execute (e.g. start, stop, deploy)"
							});
							return "{" + param + "}";
						});
						
						if (!paths[openApiPath]) {
							paths[openApiPath] = {};
						}

						paths[openApiPath][method.toLowerCase()] = {
							tags: [tag],
							parameters: parameters,
							// parameters: this.buildPathParams(path),
							summary: action.action?.description || action.name,
							operationId: action.name,
							requestBody: this.buildRequestBody(action),
							responses: {
								200: {
									description: "Success"
								}
							},
							security: [
								{ BearerAuth: [] }
							]
						};
					}
				}

				return {
					openapi: "3.0.0",
					info: {
						title: "Logiks MicroApps",
						version: CONFIG.VERSION,
						description: "Auto-generated OpenAPI spec from Logiks MicroApps Services"
					},
					servers: [
						{ url: ctx.meta.serverHost || "http://localhost:9999/" }
					],
					components: {
						securitySchemes: {
							BearerAuth: {
								type: "http",
								scheme: "bearer",
								bearerFormat: "JWT"
							}
						}
					},
					paths
				};
			},

			buildPathParams(path) {
				const params = [];
				const matches = path.match(/:([^/]+)/g) || [];

				for (const m of matches) {
					params.push({
						name: m.replace(":", ""),
						in: "path",
						required: true,
						schema: { type: "string" }
					});
				}

				return params;
			},

			buildRequestBody(action) {
				if (!action.params || !Object.keys(action.params).length) {
					return undefined;
				}

				return {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: Object.fromEntries(
									Object.entries(action.params).map(([k, v]) => [
										k,
										{ type: v.type || "string" }
									])
								)
							}
						}
					}
				};
			}
		}
	};

}
