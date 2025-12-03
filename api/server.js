"use strict";

/**
 * Main Moleculer server bootstrap
 *
 * Required npm deps:
 *   npm i moleculer moleculer-web ioredis winston winston-loki jsonwebtoken bcrypt
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const DailyRotateFile = require("winston-daily-rotate-file");

const { ServiceBroker, Errors } = require("moleculer");
const ApiService = require("moleculer-web");
const Redis = require("ioredis");
const winston = require("winston");
// const LokiTransport = require("winston-loki");

const isProd = process.env.NODE_ENV === "production";

// Distributed rate limit settings
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 300);

// const LOKI_URL = process.env.LOKI_URL || null;

// -------------------------
// Redis for distributed rate limiting
// -------------------------
const rateRedis = new Redis(CONFIG.cache);

rateRedis.on("error", (err) => {
	console.error("❌ Rate-limit Redis error:", err);
});

// -------------------------
// SERVER START
// -------------------------
module.exports = {
	start: async function startServer() {
		try {
			const broker = new ServiceBroker({
				nodeID: process.env.SERVER_ID || os.hostname(),
				namespace: process.env.NAMESPACE || "default",
				transporter: process.env.TRANSPORTER,

				// Redis Cacher (distributed)
				cacher: process.env.CLUSTER_CACHE === "true" ? {
					type: "Redis",
					options: {
						ttl: Number(process.env.CLUSTER_CACHE_TTL || 60),
						redis: CONFIG.cache
					}
				} : null,

				metadata: {
					authToken: process.env.CLUSTER_TOKEN
				},

				serializer: "JSON",

				requestTimeout: 10 * 1000,
				retryPolicy: {
					enabled: true,
					retries: 3,
					delay: 1000,
					maxDelay: 5000,
					factor: 2
				},
				circuitBreaker: {
					enabled: true,
					threshold: 0.5,
					windowTime: 60,
					minRequestCount: 10
				},
				bulkhead: {
					enabled: true,
					concurrency: 10,
					maxQueueSize: 100
				},
				metrics: true,
				statistics: true,
				heartbeatInterval: 10,
				heartbeatTimeout: 30,

				logger: [
					{
						type: "Console",
						options: {
							level: process.env.SERVER_CONSOLE_LOG_LEVEL || (isProd ? "error" : "debug"),
						}
					},
					// {
					// 	type: "File",
					// 	options: {
					// 		//formatter: (level, args, bindings) => [`[${level.toUpperCase()}]`, ...args],
							
					// 		// Logging level
					// 		level: "info",
					// 		// Folder path to save files. You can use {nodeID} & {namespace} variables.
					// 		folder: `${ROOT_PATH}/logs/`,
					// 		// Filename template. You can use {date}, {nodeID} & {namespace} variables.
					// 		filename: "moleculer-{date}.log",
					// 		// Line formatter. It can be "json", "short", "simple", "full", a `Function` or a template string like "{timestamp} {level} {nodeID}/{mod}: {msg}"
					// 		formatter: "json",
					// 		// Custom object printer. If not defined, it uses the `util.inspect` method.
					// 		objectPrinter: null,
					// 		// End of line. Default values comes from the OS settings.
					// 		eol: "\n",
					// 		// File appending interval in milliseconds.
					// 		interval: 1 * 1000
					// 	}
					// },
					{
						type: "Winston",
						options: {
							// Logging level
							level: "info",

							winston: {
								// More settings: https://github.com/winstonjs/winston#creating-your-own-logger
								transports: [
									// new winston.transports.Console(),
									//new winston.transports.File({ filename: `${ROOT_PATH}/logs/moleculer.log` })
									new DailyRotateFile({
										filename: `${ROOT_PATH}/logs/moleculer.log`.replace(".log", "-%DATE%.log"),
										level: "info",
										datePattern: "YYYY-MM-DD",
										zippedArchive: true,
										maxSize: "10m",
										maxFiles: "10d",
									})
								]
							}
						}
					},
				],
				logLevel: process.env.SERVER_CONSOLE_LOG_LEVEL || (isProd ? "error" : "debug"),//info, debug, trace, error, warn
			});

			// -------------------------
			// API GATEWAY SERVICE
			// -------------------------
			broker.createService({
				name: `${process.env.SERVER_ID}_MAIN`,
				mixins: [ApiService],

				settings: {
					port: process.env.PORT || 3000,
					ip: "0.0.0.0",
					httpServerTimeout: 30 * 1000,

					routes: [
						// PUBLIC routes (no auth required)
						{
							path: "/api/public",
							authentication: true,
							authorization: false,
							opts: {
								authRequired: false
							},
							whitelist: [
								"auth.login",
								"auth.requestOtp",
								"auth.verifyOtp",
								"auth.refresh",
								"public.*"
							],
							bodyParsers: {
								json: true,
								urlencoded: { extended: true }
							},
							mappingPolicy: "all",
							cors: true
						},

						// PRIVATE routes (auth + scopes required)
						{
							path: "/api",
							authentication: true,
							authorization: true,
							opts: {
								authRequired: true
							},
							whitelist: [
								"**",
								"swagger.openapi"
							],
							bodyParsers: {
								json: true,
								urlencoded: { extended: true }
							},
							mappingPolicy: "all",
							cors: true,
							onBeforeCall: async function (ctx, route, req, res) {
								// Security headers
								res.setHeader("X-Content-Type-Options", "nosniff");
								res.setHeader("X-Frame-Options", "DENY");
								res.setHeader("X-XSS-Protection", "1; mode=block");
								res.setHeader("X-Powered-By", "");

								// IP
								const ip =
									req.headers["x-forwarded-for"] ||
									req.connection.remoteAddress ||
									req.socket.remoteAddress ||
									"unknown";

								ctx.meta.remoteIP = ip;

								// Distributed rate limiting
								await this.applyDistributedRateLimit(ctx, route, req, res);
							}
						}
					]
				},

				methods: {
					// Tenant-aware scope matcher
					hasTenantScope(user, requiredScopes) {
						if (!requiredScopes || requiredScopes.length === 0) return true;
						if (!user) return false;

						const userScopes = Array.isArray(user.scopes) ? user.scopes : [];
						const tenantId = user.tenantId || "*";

						return requiredScopes.every((required) => {
							// required: "orders:read"
							const tenantScoped = `${tenantId}:${required}`;
							const wildcardScoped = `*:${required}`;

							return (
								userScopes.includes(tenantScoped) ||
								userScopes.includes(wildcardScoped) ||
								userScopes.includes(required)
							);
						});
					},

					/**
					 * Authentication: API key OR JWT (delegated to auth service).
					 */
					async authenticate(ctx, route, req, res) {
						const authHeader = req.headers["authorization"];
						const apiKey =
							req.headers["x-api-key"] ||
							req.headers["x-api_key"] ||
							req.query.api_key;

						let user = null;

						// --- API KEY AUTH ---
						if (apiKey) {
							const allowed = Object.keys(CONFIG.API_KEYS)

							if (!allowed.length) {
								throw new Errors.MoleculerClientError(
									"API key auth not configured",
									500,
									"API_KEY_CONFIG_MISSING"
								);
							}

							if (!allowed.includes(apiKey)) {
								throw new Errors.MoleculerClientError(
									"Invalid API key",
									401,
									"INVALID_API_KEY"
								);
							}

							// API keys can have global (wildcard) scopes if you want
							user = {
								apiKey,
								tenantId: "*",
								roles: ["api_key"],
								scopes: ["*:docs:read"]
							};
						}

						// --- JWT AUTH ---
						if (authHeader && authHeader.startsWith("Bearer ")) {
							const token = authHeader.slice(7);
							// Store raw token for logout usage
							ctx.meta.accessTokenRaw = token;

							try {
								const payload = await ctx.call("auth.verifyAccessToken", { token });
								user = {
									...(user || {}),
									id: payload.userId,
									userId: payload.userId,
									username: payload.username,
									tenantId: payload.tenantId,
									roles: payload.roles || [],
									scopes: payload.scopes || []
								};
							} catch (err) {
								throw new Errors.MoleculerClientError(
									"Invalid or expired token",
									401,
									"INVALID_TOKEN"
								);
							}
						}

						const isPublic = route?.opts?.authRequired === false;

						if (!user && !isPublic) {
							throw new Errors.MoleculerClientError(
								"Authentication required",
								401,
								"NO_AUTH"
							);
						}

						if (user) {
							ctx.meta.user = user;
						}

						return user || null;
					},

					/**
					 * Authorization with roles + tenant-aware scopes.
					 */
					async authorize(ctx, route, req, res) {
						const user = ctx.meta.user;
						const actionName = ctx.action?.name;
						const requiredScopes = ctx.action?.meta?.scopes || [];

						// Admin namespace requires admin role
						if (actionName && actionName.startsWith("admin.")) {
							if (!user || !user.roles || !user.roles.includes("admin")) {
								throw new Errors.MoleculerClientError(
									"Forbidden",
									403,
									"FORBIDDEN_ADMIN_ONLY"
								);
							}
						}

						if (!this.hasTenantScope(user, requiredScopes)) {
							throw new Errors.MoleculerClientError(
								"Missing required scopes",
								403,
								"INSUFFICIENT_SCOPE"
							);
						}

						return ctx;
					},

					/**
					 * Redis-based distributed rate limit (per identifier).
					 */
					async applyDistributedRateLimit(ctx, route, req, res) {
						const now = Date.now();
						const user = ctx.meta.user;
						const apiKey =
							req.headers["x-api-key"] ||
							req.headers["x-api_key"] ||
							req.query.api_key;

						const ip = ctx.meta.remoteIP || "unknown";

						const identifier =
							(user && (user.userId || user.username)) ||
							apiKey ||
							ip;

						const key = `ratelimit:${identifier}`;
						const ttl = RATE_LIMIT_WINDOW_MS;

						let current;
						try {
							current = await rateRedis.incr(key);
							if (current === 1) {
								await rateRedis.pexpire(key, ttl);
							}
						} catch (err) {
							LOGGER.get("server").error("Rate limit Redis error", { error: err });
							return;
						}

						if (current > RATE_LIMIT_MAX) {
							const retryAfterSec = Math.ceil(ttl / 1000);
							res.setHeader("Retry-After", retryAfterSec.toString());

							throw new Errors.MoleculerClientError(
								"Too many requests",
								429,
								"TOO_MANY_REQUESTS"
							);
						}
					}
				}
			});

			// -------------------------
			// AUTO-LOAD SERVICES
			// -------------------------
			const servicesPath = path.resolve("./api/services");

			if (fs.existsSync(servicesPath)) {
				fs.readdirSync(servicesPath).forEach((file) => {
					if (file.endsWith(".js")) {
						const filePath = path.join(servicesPath, file);
						try {
							broker.loadService(filePath);
							LOGGER.get("server").info(`Loaded service ${file}`);
						} catch (err) {
							LOGGER.get("server").error(`Failed loading service ${file}`, { error: err });
							process.exit(1);
						}
					}
				});
			} else {
				LOGGER.get("server").warn("No services directory found at ./api/services");
			}

			// -------------------------
			// GRACEFUL SHUTDOWN
			// -------------------------
			const shutdown = async () => {
				LOGGER.get("server").info("Graceful shutdown initiated...");
				try {
					await broker.stop();
					LOGGER.get("server").info("Broker stopped cleanly");
					process.exit(0);
				} catch (err) {
					LOGGER.get("server").error("Shutdown error", { error: err });
					process.exit(1);
				}
			};

			process.on("SIGINT", shutdown);
			process.on("SIGTERM", shutdown);
			process.on("uncaughtException", (err) => {
				LOGGER.get("server").error("Uncaught Exception", { error: err });
				shutdown();
			});

			// -------------------------
			// START BROKER
			// -------------------------
			await broker.start();
			LOGGER.get("server").info("AppServer server startup complete", {
				port: process.env.PORT || 3000
			});
		} catch (err) {
			console.error("❌ Fatal startup error:", err);
			process.exit(1);
		}
	}
};
