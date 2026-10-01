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
				async handler(ctx) {
					return this.generateSpec(ctx);
				}
			}
		},

		methods: {
			// Finds the API Gateway service's built-in `listAliases` action. It is
			// the only source of truth for the final, resolved REST paths (route
			// mount prefix + service-name segment + action path, with moleculer-web's
			// `{/:param}` optional-segment syntax already flattened) - re-deriving
			// that resolution from raw `action.rest` defs here would duplicate (and
			// drift from) moleculer-web's own alias-building logic.
			findGatewayListAliasesAction() {
				const actions = this.broker.registry.getActionList({
					onlyLocal: false,
					withEndpoints: true
				});

				const found = Object.values(actions).find(a => a.action?.rest === "GET /list-aliases");
				return found?.name;
			},

			async generateSpec(ctx) {
				const gatewayAction = this.findGatewayListAliasesAction();
				if (!gatewayAction) {
					this.logger.warn("developers.swagger: could not locate API Gateway's listAliases action; spec will be empty");
					return this.buildDocument({});
				}

				const aliases = await ctx.call(gatewayAction, { withActionSchema: true, grouping: false }, { meta: ctx.meta });

				const paths = {};
				// Same alias/action can be auto-mounted under more than one route
				// (eg. both the authenticated "/api" and public "/api/public" routes)
				// so track what's already been documented to avoid clobbering it.
				const seen = new Set();

				for (const alias of aliases) {
					if (!alias.fullPath || !alias.methods) continue;
					if (alias.actionName === gatewayAction) continue;
					if (alias.actionName && (alias.actionName.includes("source") || alias.actionName.includes("www"))) continue;

					const method = (Array.isArray(alias.methods) ? alias.methods[0] : alias.methods || "").toLowerCase();
					if (!method || method === "*") continue;

					const key = `${method} ${alias.fullPath}`;
					if (seen.has(key)) continue;
					seen.add(key);

					const { openApiPath, parameters } = this.toOpenApiPath(alias.fullPath);
					const tag = (alias.actionName || "default").split(".")?.[0] || "default";

					if (!paths[openApiPath]) {
						paths[openApiPath] = {};
					}

					paths[openApiPath][method] = {
						tags: [tag],
						parameters,
						summary: alias.action?.description || alias.actionName,
						operationId: alias.actionName,
						requestBody: this.buildRequestBody(alias.action),
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

				return this.buildDocument(paths, ctx);
			},

			// Converts a resolved alias path into an OpenAPI path template plus its
			// `path`-in parameters. moleculer-web alias paths wrap optional segments
			// in `{...}` (eg. ":module{/:ctrlId}"), which is never flattened back
			// into plain `:param` form on `fullPath` - strip that grouping syntax
			// before turning `:param` into OpenAPI's `{param}`, otherwise the two
			// brace conventions collide into garbage like "{module{}/{ctrlId}}".
			toOpenApiPath(fullPath) {
				const parameters = [];
				// Stripping "{...}" can leave a doubled separator where the group
				// itself started with "/" right after the route's own joining slash
				// (eg. ".../apps" + "/" + "{/:task}" -> ".../apps//:task").
				const flattened = fullPath.replace(/[{}]/g, "").replace(/\/{2,}/g, "/");

				const openApiPath = flattened.replace(/:([^/]+)\?/g, (match, param) => {
					parameters.push({
						name: param,
						in: "path",
						required: true,
						schema: { type: "string" }
					});
					return "{" + param + "}";
				}).replace(/:([^/]+)/g, (match, param) => {
					parameters.push({
						name: param,
						in: "path",
						required: true,
						schema: { type: "string" }
					});
					return "{" + param + "}";
				});

				return { openApiPath, parameters };
			},

			buildRequestBody(action) {
				if (!action?.params || !Object.keys(action.params).length) {
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
			},

			buildDocument(paths, ctx) {
				const usedTags = new Set();
				for (const methods of Object.values(paths)) {
					for (const def of Object.values(methods)) {
						(def.tags || []).forEach(t => usedTags.add(t));
					}
				}

				return {
					openapi: "3.0.0",
					info: {
						title: "Logiks MicroApps AppServer API",
						version: CONFIG.VERSION,
						description: "REST surface of the Logiks Microapps AppServer, reconstructed at request time from the moleculer-web API Gateway's own resolved route aliases (so it always reflects the services actually registered on this node).\n\nAuth: most endpoints live under the private `/api` route and require either a Bearer JWT (`Authorization: Bearer <token>`), an API key (`X-API-Key` header or `api_key` query param), a time-limited token (`tkn` query param), or a server-to-server token (`s2stkn` query param). Endpoints under `/auth/*`, `/webhooks/*`, `/api/public/*`, and `/health` do not require authentication.\n\nNote: because the private `/api` route whitelists `**`, most endpoints documented here under their dedicated mount (`/auth/*`, `/webhooks/*`, `/api/public/*`) are also reachable a second time under `/api/...`, an accidental byproduct of the wildcard whitelist. Both are listed here since both actually work; prefer the dedicated mount."
					},
					servers: [
						{ url: this.toAbsoluteUrl(ctx?.meta?.serverHost), description: "This node" }
					],
					tags: this.describeTags(usedTags),
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

			// ctx.meta.serverHost is just `req.headers.host` ("host:port"), no scheme.
			toAbsoluteUrl(serverHost) {
				if (!serverHost) return "http://localhost:9999";
				return /^https?:\/\//.test(serverHost) ? serverHost : `http://${serverHost}`;
			},

			describeTags(usedTags) {
				const known = {
					admin: "Admin console: apps, control panels, node/plugin inspection, and admin-owned file/media management.",
					agents: "AICore agents and personas: definitions, invocation, and session history.",
					application: "Application metadata, layout, navigator, pages, themes, components, and feature settings.",
					auth: "Login, token issuance/refresh/verification, federated login, and logout. Public (no bearer auth required).",
					data: "Read-only lookup/reference data groups.",
					dbops: "Generic CRUD-style database operations against configured data sources.",
					developers: "Developer tooling: route listing/inspection and the auto-generated OpenAPI spec (dev/UAT only).",
					files: "Tenant file storage: browsing, upload, preview, trash, and purge.",
					me: "Current authenticated user's profile, scopes, and password management.",
					modules: "Microapp module resolution: components, UI assets, and module-scoped service requests.",
					pages: "Public, SEO-friendly page rendering.",
					public: "Unauthenticated public endpoints: health checks and public file access.",
					query: "Stored/raw query execution and management.",
					sse: "Server-Sent Events streaming.",
					system: "System/worker-level controls.",
					tasks: "AICore agentic tasks: repeatable/scheduled task definitions, execution, and cancellation.",
					tenant: "Tenant lookup.",
					test: "Internal test endpoints.",
					userstates: "Per-user, per-module UI/application state persistence.",
					utils: "Misc utilities: rule/validation execution, payload runners, activity logging, and cache inspection.",
					webhooks: "Inbound webhook receivers."
				};

				return [...usedTags].sort().map(name => ({
					name,
					description: known[name] || undefined
				}));
			}
		}
	};

}
