"use strict";

// In-memory worker registry (use Redis/DB in prod if needed)
const SERVICE_WORKERS = new Map();

const ROUTE_MAP = {};

module.exports = {
	name: "system",

    created() {
		this.activeColor = process.env.ACTIVE_WORKER_COLOR || "blue"; // blue/green switch
	},

	actions: {
		/**
		 * Called automatically by worker on startup.
		 * Used for:
		 * - Data migration
		 * - Cache pre-warm
		 * - DB seed
		 * - System registration
		 */
		registerWorker: {
			params: {
				nodeID: "string",
				token: "string",
				role: "string",
				host: "string",
				pid: "number",
				pwd: "string",
				color: "string",
				services: { type: "array", items: "string" },
				menus: "object",
				plugins: "array",
				policies: "object",
			},
			async handler(ctx) {
				const w = ctx.params;

				if(w.token!=process.env.CLUSTER_TOKEN) {
					console.log("CLUSTER_TOKEN_ERROR", "Worker registeration failed due to cluster token mismatch");
					LOGGER.get("server").info("Worker registeration failed due to cluster token mismatch", w);
					
					SERVER.getBroker().removeNode(w.nodeID);
					
					return {
						success: false,
						message: "Cluster Token Mismatch"
					};
				}

                SERVICE_WORKERS.set(w.nodeID, {
					...w,
					status: "active",
					lastSeen: Date.now()
				});

				LOGGER.get("server").info("📌 Worker registered", w);
				
				// Example tasks you may perform here:
				// ----------------------------------------
				// 1. Run DB migrations
				// await this.broker.call("db.migrate");

				// 2. Seed data (only once if needed)
				// await this.broker.call("db.seedIfRequired");

				// 3. Warm caches
				// await this.broker.call("cache.warmup");

				// 4. Store worker registry in DB/Redis
				// await this.broker.call("cluster.storeWorker", data);

                // inside system.registerWorker
                // const lock = await this.broker.cacher?.get("db_migration_lock");

                // if (!lock) {
                //     await this.broker.cacher?.set("db_migration_lock", true, 60);
                //     await this.broker.call("db.migrate");
                //     await this.broker.cacher?.del("db_migration_lock");
                // }

				return {
					success: true,
					message: "Worker registered successfully"
				};
			}
		},
        /**
		 * Worker heartbeat
		 */
		workerHeartbeat: {
			params: {
				nodeID: "string",
				color: "string",
				ts: "number"
			},
			handler: (ctx) => {
				const w = ctx.params;
				if(!SERVICE_WORKERS) return { ok: true };
				const existing = SERVICE_WORKERS.get(w.nodeID);
				if (existing) {
					existing.lastSeen = w.ts;
					SERVICE_WORKERS.set(w.nodeID, existing);
				}
				return { ok: true };
			}
		},

		/**
		 * Drain a worker before shutdown (rolling restart)
		 */
		drainWorker: {
			params: {
				nodeID: "string"
			},
			handler: (ctx) => {
				//console.log("drainWorker", ctx.params, SERVICE_WORKERS);
				const { nodeID } = ctx.params;
				if(!SERVICE_WORKERS) return { ok: true };

				const worker = SERVICE_WORKERS.get(nodeID);
				if (worker) {
					worker.status = "draining";
					LOGGER.get("server").warn("🚫 Worker draining", worker);

					SERVICE_WORKERS.set(nodeID, worker);

					setTimeout(function() {
						SERVICE_WORKERS.delete(nodeID);
					}, 5000);
				}

				return { ok: true };
			}
		},

		/**
		 * Blue/Green switch — route traffic only to this color
		 */
		switchActiveColor: {
			rest: {
				method: "POST",
				path: "/system/switch-color"
			},
			params: {
				color: { type: "string", enum: ["blue", "green"] }
			},
			handler: (ctx) => {
				this.activeColor = ctx.params.color;
				LOGGER.get("server").warn("🔁 Active worker color switched to", this.activeColor);
				return { activeColor: this.activeColor };
			}
		},

		helpers: {
			params: {
				cmd: "string",
				params: "array"
			},
			handler: async (ctx) => {
				switch(ctx.params.cmd) {
					case "list_helpers":
						return {
							"status": "success",
							"data": _ENV.HELPERS
						};
						break;
					default:
						const cmd = ctx.params.cmd.split(".");
						const params = ctx.params.params;
						if(_ENV.HELPERS.indexOf(cmd[0].toUpperCase())<0) {
							return {
								"status": "error",
								"message": "Helper Not Found",
								"errors": ["Helper not found"]
							};
						}
						if(!global[cmd[0].toUpperCase()][cmd[1]]) {
							return {
								"status": "error",
								"message": "Helper Does not Contain the required method",
								"errors": ["Mtehod not found"]
							};
						}
						const data = await global[cmd[0].toUpperCase()][cmd[1]](...params);

						// console.log(cmd, params);
						return {
							"status": "success",
							"data": data
						};
				}
			}
		},
		controllers: {
			params: {
				cmd: "string",
				params: "array"
			},
			handler: async (ctx) => {
				switch(ctx.params.cmd) {
					case "list_controllers":
						return {
							"status": "success",
							"data": _ENV.CONTROLLERS_PUBLIC
						};
						break;
					default:
						const cmd = ctx.params.cmd.split(".");
						const params = ctx.params.params;
						if(_ENV.CONTROLLERS_PUBLIC.indexOf(cmd[0].toUpperCase())<0) {
							return {
								"status": "error",
								"message": "Contoller Not Found",
								"errors": ["Contoller not found"]
							};
						}
						if(!global[cmd[0].toUpperCase()][cmd[1]]) {
							return {
								"status": "error",
								"message": "Contoller Does not Contain the required method",
								"errors": ["Mtehod not found"]
							};
						}
						const data = await global[cmd[0].toUpperCase()][cmd[1]](...params);

						// console.log(cmd, params);
						return {
							"status": "success",
							"data": data
						};
				}
			}
		},
		plugins: {
			params: {
				// nodeID: "string"
			},
			handler: async (ctx) => {
				const { nodeID, more } = ctx.params;
				
				var RESULTS = {};

				if(more) {
					RESULTS = {};
					if(nodeID) {
						SERVICE_WORKERS.forEach((node, key) => {
							if(nodeID == key) {
								RESULTS[key] = {"PLUGINS": [], "SERVICES": [], "MENUS": []};

								RESULTS[key].PLUGINS = node.plugins;
								RESULTS[key].SERVICES = node.services.filter(a=>a!="$node");
								RESULTS[key].MENUS = Object.keys(node.menus);
							}
						});
					} else {
						SERVICE_WORKERS.forEach((node, key) => {
							RESULTS[key] = {"PLUGINS": [], "SERVICES": [], "MENUS": []};
							RESULTS[key].PLUGINS = node.plugins;
							RESULTS[key].SERVICES = node.services.filter(a=>a!="$node");
							RESULTS[key].MENUS = Object.keys(node.menus);
						});
					}
				} else {
					RESULTS = {"PLUGINS": [], "SERVICES": [], "MENUS": []};
					if(nodeID) {
						SERVICE_WORKERS.forEach((node, key) => {
							if(nodeID == key) {
								RESULTS.PLUGINS = [...RESULTS.PLUGINS, ...node.plugins];
								RESULTS.SERVICES = [...RESULTS.SERVICES, ...node.services.filter(a=>a!="$node")];
								RESULTS.MENUS = [...RESULTS.MENUS, ...Object.keys(node.menus)];
							}
						});
					} else {
						SERVICE_WORKERS.forEach((node, key) => {
							RESULTS.PLUGINS = [...RESULTS.PLUGINS, ...node.plugins];
							RESULTS.SERVICES = [...RESULTS.SERVICES, ...node.services.filter(a=>a!="$node")];
							RESULTS.MENUS = [...RESULTS.MENUS, ...Object.keys(node.menus)];
						});
					}
				}

				return RESULTS;
			}
		},

		policyCatalog: function() {
			var RESULTS = {};
			SERVICE_WORKERS.forEach((node, key) => {
				RESULTS = {...RESULTS, ...node.policies}
			});

			return RESULTS;
		},

		//Private Function
		selfRestart() {
			this.logger.warn(`SELF RESTART triggered on ${this.broker.nodeID}`);

			setTimeout(() => {
				// SAFEST METHOD — Let PM2 restart it
				process.exit(0);

				// Or replace with a specific PM2 restart:
				// exec(`pm2 restart moleculer-gateway`);
			}, 500);

			return {
				node: this.broker.nodeID,
				status: "restarting"
			};
		},

		routeStatsSummary() {
			const result = {};

			for (const [route, s] of Object.entries(ROUTE_MAP)) {
				result[route] = {
					count: s.count,
					avgMs: Number((s.total / s.count).toFixed(2)),
					maxMs: s.max
				};
			}

			return result;
		}
	},

	events: {
		"system.request_completed"(data) {
			const key = `${data.method} ${data.path}`;
			// console.log("API REQUEST STATS", key, data);

			if (!ROUTE_MAP[key]) {
				ROUTE_MAP[key] = {
					count: 0,
					total: 0,
					max: 0
				};
			}

			const stats = ROUTE_MAP[key];
			stats.count++;
			stats.total += data.duration;
			stats.max = Math.max(stats.max, data.duration);
		}
	},
};

async function loadPluginAttributes(pluginId) {

}