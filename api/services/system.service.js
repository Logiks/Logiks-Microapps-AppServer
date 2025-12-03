"use strict";

module.exports = {
	name: "system",

    created() {
		// In-memory worker registry (use Redis/DB in prod if needed)
		this.workers = new Map();
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
				services: { type: "array", items: "string" }
			},
			async handler(ctx) {
				const w = ctx.params;

                this.workers.set(w.nodeID, {
					...w,
					status: "active",
					lastSeen: Date.now()
				});

				this.logger.info("📌 Worker registered", w);

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
				const existing = this.workers.get(w.nodeID);
				if (existing) {
					existing.lastSeen = w.ts;
					this.workers.set(w.nodeID, existing);
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

				const worker = this.workers.get(nodeID);
				if (worker) {
					worker.status = "draining";
					this.workers.set(nodeID, worker);

					this.logger.warn("🚫 Worker draining", worker);
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
				this.logger.warn("🔁 Active worker color switched to", this.activeColor);
				return { activeColor: this.activeColor };
			}
		}
	}
};
