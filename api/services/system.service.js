"use strict";

// In-memory worker registry (use Redis/DB in prod if needed)
const SERVICE_WORKERS = new Map();

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
				role: "string",
				host: "string",
				pid: "number",
				color: "string",
				services: { type: "array", items: "string" },
				menus: "object"
			},
			async handler(ctx) {
				const w = ctx.params;

				console.log("NEW_SERVICE_WORKER", w.nodeID, w);

                SERVICE_WORKERS.set(w.nodeID, {
					...w,
					status: "active",
					lastSeen: Date.now()
				});

				LOGGER.get("server").info("📌 Worker registered", w);

				// ✅ Example tasks you may perform here:
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
		 * ✅ Worker heartbeat
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
		 * ✅ Drain a worker before shutdown (rolling restart)
		 */
		drainWorker: {
			params: {
				nodeID: "string"
			},
			handler: (ctx) => {
				const { nodeID } = ctx.params;
				if(!SERVICE_WORKERS) return { ok: true };
				const worker = SERVICE_WORKERS.get(nodeID);
				if (worker) {
					worker.status = "draining";
					SERVICE_WORKERS.set(nodeID, worker);

					LOGGER.get("server").warn("🚫 Worker draining", worker);
				}

				return { ok: true };
			}
		},

		/**
		 * ✅ Blue/Green switch — route traffic only to this color
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
		}
	}
};
