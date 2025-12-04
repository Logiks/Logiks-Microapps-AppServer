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
const session = require("express-session");
const { RedisStore } = require("connect-redis");
const DailyRotateFile = require("winston-daily-rotate-file");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");

const { ServiceBroker, Errors } = require("moleculer");
const ApiService = require("moleculer-web");
const Redis = require("ioredis");

const isProd = process.env.NODE_ENV === "production";

// Distributed rate limit settings
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 300);

// -------------------------
// SERVER START
// -------------------------
module.exports = {
	start: async function startServer() {
		try {
			// -------------------------
			// Redis for distributed rate limiting
			// -------------------------
			const rateRedis = new Redis(CONFIG.cache);

			rateRedis.on("error", (err) => {
				console.error("❌ Rate-limit Redis error:", err);
			});

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

				// Global middlewares. Applied to all routes.
				use: [
					cookieParser(),
					// helmet()
					helmet.contentSecurityPolicy({
						directives: {
							defaultSrc: ["'self'"],
							scriptSrc: ["'self'"],
							styleSrc: ["'self'", "https:"],
							imgSrc: ["'self'", "data:", "https:"],
							connectSrc: ["'self'"],
							fontSrc: ["'self'", "https:", "data:"],
							objectSrc: ["'none'"],
							frameAncestors: ["'none'"],
							baseUri: ["'self'"],
							formAction: ["'self'"]
						},
						crossOriginEmbedderPolicy: true,
						crossOriginOpenerPolicy: true,
						crossOriginResourcePolicy: { policy: "same-site" },
						referrerPolicy: { policy: "strict-origin-when-cross-origin" },
						hsts: {
							maxAge: 31536000,
							includeSubDomains: true,
							preload: true
						}
					})
				],

				settings: {
					port: process.env.PORT || 3000,
					ip: process.env.HOST || "0.0.0.0",
					httpServerTimeout: 30 * 1000,

					// SERVE STATIC FILES
					assets: {
						folder: path.join(ROOT_PATH, "public"),

						// Optional: enable caching headers
						options: {
							maxAge: "1d",        // cache assets for 1 days
							etag: true,          // enable etag validation
							lastModified: true,  // enable Last-Modified
							// index: true
						},
						// Enable GZIP/Brotli compression
						compression: {
							enabled: true,
							options: {
								threshold: 1024 // only compress files > 1KB
							}
						},
						// route: "/static"
						// Fallback index.html for SPA routing
        				index: "index.html"
					},

					routes: [
						// PUBLIC routes (no auth required)
						{
							path: "/api/public",
							authentication: false,
							authorization: false,
							opts: {
								authRequired: false
							},
							whitelist: CONFIG.noauth,
							bodyParsers: {
								json: true,
								urlencoded: { extended: true }
							},
							// Attach Express-compatible middlewares
							use: [
								session({
									store: new RedisStore({ client: _CACHE.getRedisInstance(), prefix: "sess:" }),
									name: "sid",
									secret: process.env.SESSION_SECRET || "dev_super_secret_change_me",
									resave: false,
									saveUninitialized: false,
									rolling: true, // refresh cookie on activity
									cookie: {
										httpOnly: true,
										secure: true,           // set false only for local HTTP dev
										sameSite: "lax",
										maxAge: 1000 * 60 * 60, // 1 hour
									}
								}),
								// Attach IP/UA on every request
								(req, res, next) => {
									req.clientIp = MISC.getClientIP(req);
									req.clientUa = req.headers["user-agent"] || "unknown";
									next();
								}
							],
							// Enable GZIP/Brotli compression
							compression: {
								enabled: true,
								options: {
									threshold: 1024 // only compress files > 1KB
								}
							},
							mappingPolicy: "all",
							cors: true,
							// cors: {
							// 	methods: ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"],
							// 	origin: "*",
							// },
							autoAliases: true,
							// aliases: {
							// 	"POST /auth/login": "auth.login",
							// 	"POST /auth/request-otp": "auth.requestOtp",
							// 	"POST /auth/verify-otp": "auth.verifyOtp",
							// 	"POST /auth/refresh": "auth.refresh",
								// "POST upload"(req, res) {
								// 	this.parseUploadedFile(req, res);
								// },
								// "GET custom"(req, res) {
								// 	res.end('hello from custom handler')
								// }
							// },

							onBeforeCall(ctx, route, req, res) {
								console.log("REQUEST_PUBLIC", { url: req.url, method: req.method, headers: req.headers, query: req.query, body: req.body, params: req.params, meta: ctx.meta });
								//res.setHeader("Expires", new Date(Date.now() + 7 * 86400 * 1000).toUTCString());

								// if (req.url === "/index.html") {
								// 	res.setHeader("Cache-Control", "no-cache");
								// } else {
								// 	res.setHeader("Cache-Control", "public, max-age=604800");
								// }

								if (req.method === "GET" && req.body && Object.keys(req.body).length > 0) {
									res.writeHead(400, { "Content-Type": "application/json" });
									res.end(JSON.stringify({
										error: "GET requests cannot contain a request body"
									}));
									// throw new Error("INVALID_GET_BODY");
									return;
								}

								// Security headers
								res.setHeader("X-Content-Type-Options", "nosniff");
								res.setHeader("X-Frame-Options", "DENY");
								res.setHeader("X-XSS-Protection", "1; mode=block");
								res.setHeader("X-Powered-By", "Logiks Microapps AppServer");
								res.setHeader("Expires", new Date(Date.now() + 7 * 86400 * 1000).toUTCString());

								// IP
								const ip =req.headers["x-forwarded-for"] ||
									req.connection.remoteAddress ||
									req.socket.remoteAddress ||
									"0.0.0.0";

								ctx.meta.remoteIP = ip;
							}
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
								// "swagger.openapi"
							],
							bodyParsers: {
								json: true,
								urlencoded: { extended: true }
							},
							// Attach Express-compatible middlewares
							use: [
								session({
									store: new RedisStore({ client: _CACHE.getRedisInstance(), prefix: "sess:" }),
									name: "sid",
									secret: process.env.SESSION_SECRET || "dev_super_secret_change_me",
									resave: false,
									saveUninitialized: false,
									rolling: true, // refresh cookie on activity
									cookie: {
										httpOnly: true,
										secure: true,           // set false only for local HTTP dev
										sameSite: "lax",
										maxAge: 1000 * 60 * 60, // 1 hour
									}
								}),
								// Attach IP/UA on every request
								(req, res, next) => {
									req.clientIp = MISC.getClientIP(req);
									req.clientUa = req.headers["user-agent"] || "unknown";
									next();
								}
							],
							// Enable GZIP/Brotli compression
							compression: {
								enabled: true,
								options: {
									threshold: 1024 // only compress files > 1KB
								}
							},
							mappingPolicy: "all",
							cors: true,
							// cors: {
							// 	methods: ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"],
							// 	origin: "*",
							// 	credentials: true
							// },
							autoAliases: true,
							// aliases: {
							// 	"POST /auth/login": "auth.login",
							// 	"POST /auth/request-otp": "auth.requestOtp",
							// 	"POST /auth/verify-otp": "auth.verifyOtp",
							// 	"POST /auth/refresh": "auth.refresh",
								// "POST upload"(req, res) {
								// 	this.parseUploadedFile(req, res);
								// },
								// "GET custom"(req, res) {
								// 	res.end('hello from custom handler')
								// }
							// },
							
							onBeforeCall: async function (ctx, route, req, res) {
								console.log("REQUEST_PRIVATE", { url: req.url, method: req.method, headers: req.headers, query: req.query, body: req.body, params: req.params, meta: ctx.meta });
								
								if (req.method === "GET" && req.body && Object.keys(req.body).length > 0) {
									res.writeHead(400, { "Content-Type": "application/json" });
									res.end(JSON.stringify({
										error: "GET requests cannot contain a request body"
									}));
									// throw new Error("INVALID_GET_BODY");
									return;
								}
								
								
								// Security headers
								res.setHeader("X-Content-Type-Options", "nosniff");
								res.setHeader("X-Frame-Options", "DENY");
								res.setHeader("X-XSS-Protection", "1; mode=block");
								res.setHeader("X-Powered-By", "Logiks Microapps AppServer");
								res.setHeader("Expires", new Date(Date.now() + 7 * 86400 * 1000).toUTCString());

								// IP
								const ip =req.headers["x-forwarded-for"] ||
									req.connection.remoteAddress ||
									req.socket.remoteAddress ||
									"0.0.0.0";

								ctx.meta.remoteIP = ip;

								// Distributed rate limiting
								await this.applyDistributedRateLimit(ctx, route, req, res);
							}
						}
					]
				},

				actions: {
					// list: {
					// 	// Expose as "/api/v2/posts/"
					// 	rest: "GET /",
					// 	handler(ctx) {}
					// },
				},

				methods: {
					/**
					 * Authentication: API key OR JWT (delegated to auth service).
					 */
					async authenticate(ctx, route, req, res) {
						const authHeader = req.headers["authorization"];
						const apiKey =
							req.headers["x-api-key"] ||
							req.headers["x-api_key"] ||
							req.query.api_key;
						const s2skey = req.query.tkn;
						const serverIp = req.socket.localAddress || req.connection.localAddress;
						const serverHost = req.headers.host;
						const clientIP = ctx.meta.remoteIP || "unknown";
						const appInfo = await BASEAPP.getAppInfo(serverHost);

						console.log("AUTH_HEADERS", { authHeader, apiKey, s2skey, serverIp, serverHost, appInfo });

						let user = null;

						//If S2S token matches, auto-authenticate as app service user, 
						//This is for limited access and only for server-to-server calls and limited by count
						if(s2skey) {
							// && appInfo && appInfo.s2stoken && s2skey === appInfo.s2stoken
							const payload = await ctx.call("auth.verifyS2SToken", { token: s2skey });
							if(!payload) {
								throw new Errors.MoleculerClientError(
									"S2S Token can be used only for server-to-server communication for limited API access",
									401,
									"INVALID_S2S_TOKEN"
								);
							}
							
							if(payload.ip!=clientIP) {
								throw new Errors.MoleculerClientError(
									"S2S Token can not be used from changing IP address",
									401,
									"INVALID_S2S_TOKEN"
								);
							}

							user = {
								id: appInfo.appid,
								userId: "S2S_"+s2skey,
								username: "S2S Service User",
								tenantId: appInfo.appid,
								roles: ["service"],
								scopes: payload.scopes || ["/api/tenant:*"],
							};
						}

						// --- API KEY AUTH ---
						if (apiKey) {
							const apiInfo = await BASEAPP.fetchAuthInfo(apiKey);

							if(!apiInfo) {
								throw new Errors.MoleculerClientError(
									"Invalid API key",
									401,
									"INVALID_API_KEY"
								);
							}

							// API keys can have global (wildcard) scopes if you want
							user = {
								apiKey,
								id: apiInfo.guid,
								userId: apiInfo.guid,
								username: apiInfo.guid,
								tenantId: apiInfo.guid,
								roles: ["api_key"],
								scopes: apiInfo.scope ? apiInfo.scope.split(",") : ["*"],
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
						// console.log("AUTH_USER", user, route);

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
						ctx.meta.appInfo = appInfo || {};
						ctx.meta.serverHost = serverHost || "";

						return user || null;
					},

					/**
					 * Authorization with roles + tenant-aware scopes.
					 * After authentication.
					 */
					async authorize(ctx, route, req, res) {
						//Session Handling done here
						const sess = req.session;
						
						const user = ctx.meta.user;
						const actionName = ctx.action?.name;
						const requiredScopes = ctx.action?.meta?.scopes || [];

						// console.log("DUE_AUTHORIZATION", sess, ctx.meta, actionName, requiredScopes);

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

			setInterval(() => {
				//broker.metrics && broker.metrics.clean();
				broker.ping().then(res => broker.logger.info(res));
			}, 5 * 60 * 1000);

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
