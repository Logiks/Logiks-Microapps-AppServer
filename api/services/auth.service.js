"use strict";

const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const Redis = require("ioredis");
const { Errors } = require("moleculer");

const { MoleculerClientError } = Errors;

const JWT_SECRET = CONFIG.authjwt.secret;
const ACCESS_TOKEN_TTL = Number(CONFIG.authjwt.access_token_ttl || 3600);              // seconds
const REFRESH_TOKEN_TTL = Number(CONFIG.authjwt.refresh_token_ttl || 7 * 24 * 3600);   // seconds

// Redis DB for auth-related state (you can use a dedicated DB index)
const authRedis = new Redis(CONFIG.cache);

const S2STOKENS = {};
const TLTOKENS = {};
const S2STOKENS_MAX = 10;
const TLTOKENS_MAX = 10;

authRedis.on("error", (err) => {
	// eslint-disable-next-line no-console
	console.error("❌ Auth Redis error:", err);
});

module.exports = {
	name: "auth",

	actions: {
		/**
		 * Server 2 Server token issuance.
		 * POST /api/public/auth/s2stoken
		 */
		s2stoken: {
			rest: {
				method: "POST",
				path: "/s2stoken"
			},
			params: {
				appid: "string",
				appkey: "string" 
			},
			// meta: {
			// 	scopes: ["/api/tenant:*"] // Limited access for S2S tokens
			// },
			async handler(ctx) {
				
				return this.issueS2SToken(ctx);
			}
		},

		/**
		 * Time Limited token issuance.
		 * POST /api/public/auth/s2stoken
		 */
		tltoken: {
			rest: {
				method: "POST",
				path: "/tltoken"
			},
			params: {
				appid: "string"
			},
			async handler(ctx) {
				
				return this.issueTimeLimitedToken(ctx);
			}
		},

		/**
		 * Generate Auth Link (for magic link login).
		 * POST /api/public/auth/authlink
		 */
		authlink: {
			rest: {
				method: "POST",
				path: "/authlink"
			},
			async handler(ctx) {
				if(!CONFIG.logiksauth.enable) {
					throw new MoleculerClientError("LogiksAuth not configured", 401);
				}
				// ctx.params.body.return_url

				const returnURL = `${CONFIG.base_url}auth/logiksauth-login`;
				const authURL = `${CONFIG.logiksauth.url}authenticate?appid=${CONFIG.logiksauth.appid}&scope=${CONFIG.logiksauth.scope}&returnURL=${encodeURIComponent(returnURL)}`;
				const logoutURL = `${CONFIG.logiksauth.url}logout?appid=${CONFIG.logiksauth.appid}&returnURL=${encodeURIComponent(returnURL)}`;

				return {
					"status": "success",
					"authlink": authURL,
					"logout": logoutURL
				}
			}
		},

		logiksAuthLogin: {
			rest: {
				method: "GET",
				path: "/logiksauth-login"
			},
			async handler(ctx) {
				console.log("FEDERATED_LOGIN_logiksAuthLogin", { url: req.url, method: req.method, headers: req.headers, query: req.query, body: req.body, params: req.params, meta: ctx.meta });
				return {
					"status": "success",
					"message": "LogiksAuth login is not yet implemented"
				}
			}
		},

		//To allow 3rd party federated login (Google, Facebook, Apple, etc)
		federatedLogin: {
			rest: {
				method: "GET",
				path: "/fenderated-login"
			},
			async handler(ctx) {
				console.log("FEDERATED_LOGIN", { url: req.url, method: req.method, headers: req.headers, query: req.query, body: req.body, params: req.params, meta: ctx.meta });
				return {
					"status": "success",
					"message": "Federated login is not yet implemented"
				}
			}
		},

		/**
		 * Username/password login → access + refresh token.
		 * POST /api/public/auth/login
		 */
		login: {
			rest: "POST /login",
			params: {
				username: "string",
				password: "string",
				deviceType: { type: "string", optional: true, default: "web" }
			},
			async handler(ctx) {
				const { username, password, deviceType } = ctx.params;

				// TODO: replace with real DB lookup
				const fakeUserFromDB = {
					id: 101,
					username: "admin",
					tenantId: "tenant-1",
					passwordHash: await bcrypt.hash("admin123", 10),
					roles: ["admin"],
					scopes: [
						"tenant-1:orders:read",
						"tenant-1:orders:write",
						"tenant-1:docs:read"
					]
				};

				if (username !== fakeUserFromDB.username) {
					throw new MoleculerClientError("Invalid credentials", 401);
				}

				const valid = await bcrypt.compare(password, fakeUserFromDB.passwordHash);
				if (!valid) {
					throw new MoleculerClientError("Invalid credentials", 401);
				}

				return this.issueTokensForUser(fakeUserFromDB, ctx.meta.remoteIP, deviceType);
			}
		},

		/**
		 * Request OTP.
		 * POST /api/public/auth/request-otp
		 */
		requestOtp: {
			rest: {
				method: "POST",
				path: "/request-otp"
			},
			params: {
				identifier: "string",
				deviceType: { type: "string", optional: true, default: "web" }
			},
			async handler(ctx) {
				const { identifier, deviceType } = ctx.params;

				const otp = (Math.floor(100000 + Math.random() * 900000)).toString();
				const key = `otp:${identifier}`;

				await authRedis.set(
					key,
					JSON.stringify({ otp, deviceType }),
					"EX",
					300 // 5 minutes
				);

				// TODO: integrate SMS/email provider
				console.log("OTP generated", { identifier, otp, deviceType });

				return { success: true, message: "OTP sent (stub)", ttl: 300 };
			}
		},

		/**
		 * Verify OTP → access + refresh token.
		 * POST /api/public/auth/verify-otp
		 */
		verifyOtp: {
			rest: {
				method: "POST",
				path: "/verify-otp"
			},
			params: {
				identifier: "string",
				otp: "string",
				deviceType: { type: "string", optional: true, default: "web" }
			},
			async handler(ctx) {
				const { identifier, otp, deviceType } = ctx.params;

				const key = `otp:${identifier}`;
				const stored = await authRedis.get(key);

				if (!stored) {
					throw new MoleculerClientError("Invalid or expired OTP", 401);
				}

				const parsed = JSON.parse(stored);
				if (parsed.otp !== otp) {
					throw new MoleculerClientError("Invalid or expired OTP", 401);
				}

				await authRedis.del(key);

				// TODO: map identifier → real user
				const user = {
					id: 202,
					username: identifier,
					tenantId: "tenant-2",
					roles: ["user"],
					scopes: [
						"tenant-2:orders:read" // limited scopes for OTP-based login
					]
				};

				return this.issueTokensForUser(user, ctx.meta.remoteIP, deviceType);
			}
		},

		/**
		 * Refresh token (rotating).
		 * POST /api/public/auth/refresh
		 */
		refresh: {
			rest: {
				method: "POST",
				path: "/refresh"
			},
			params: {
				refreshToken: "string",
				deviceType: { type: "string", optional: true, default: "web" }
			},
			async handler(ctx) {
				const { refreshToken, deviceType } = ctx.params;
				let payload;

				try {
					payload = jwt.verify(refreshToken, JWT_SECRET);
				} catch (err) {
					throw new MoleculerClientError("Invalid refresh token", 401);
				}

				if (payload.type !== "refresh") {
					throw new MoleculerClientError("Invalid refresh token type", 401);
				}

				const jti = payload.jti;
				const key = `refresh:${jti}`;
				const stored = await authRedis.get(key);

				if (!stored) {
					throw new MoleculerClientError("Refresh token revoked", 401);
				}

				// Rotate: delete old
				await authRedis.del(key);

				const user = {
					id: payload.userId,
					username: payload.username,
					tenantId: payload.tenantId,
					roles: payload.roles || [],
					scopes: payload.scopes || []
				};

				return this.issueTokensForUser(user, ctx.meta.remoteIP, deviceType);
			}
		},

		/**
		 * Logout current device (single session).
		 * POST /api/auth/logout
		 */
		logout: {
			rest: {
				method: "POST",
				path: "/logout"
			},
			meta: {
				scopes: [] // any authenticated user
			},
			params: {
				refreshToken: { type: "string", optional: true },
				accessToken: { type: "string", optional: true }
			},
			async handler(ctx) {
				const { refreshToken, accessToken } = ctx.params;

				// Revoke refresh
				if (refreshToken) {
					try {
						const payload = jwt.verify(refreshToken, JWT_SECRET);
						if (payload.type === "refresh" && payload.jti) {
							await authRedis.del(`refresh:${payload.jti}`);
						}
					} catch (e) {
						// ignore
					}
				}

				// Blacklist access
				const raw = accessToken || ctx.meta.accessTokenRaw;
				if (raw) {
					try {
						const payload = jwt.verify(raw, JWT_SECRET);
						if (payload.type === "access" && payload.jti && payload.exp) {
							const ttlSec = payload.exp - Math.floor(Date.now() / 1000);
							if (ttlSec > 0) {
								await authRedis.set(
									`blacklist:${payload.jti}`,
									"1",
									"EX",
									ttlSec
								);
							}
						}
					} catch (e) {
						// ignore
					}
				}

				return { success: true };
			}
		},

		/**
		 * Logout from ALL devices for this tenant+user.
		 * POST /api/auth/logout-all
		 */
		logoutAll: {
			rest: {
				method: "POST",
				path: "/logout-all"
			},
			meta: {
				scopes: [] // any authenticated user
			},
			async handler(ctx) {
				const user = ctx.meta.user;

				if (!user || !user.userId || !user.tenantId) {
					throw new MoleculerClientError("Unauthorized", 401);
				}

				const tenantId = user.tenantId;
				const userId = user.userId;

				const refreshSetKey = `user_sessions:${tenantId}:${userId}`;
				const refreshJtis = await authRedis.smembers(refreshSetKey);

				if (Array.isArray(refreshJtis) && refreshJtis.length > 0) {
					for (const jti of refreshJtis) {
						await authRedis.del(`refresh:${jti}`);
					}
				}

				// Blacklist current access token
				const raw = ctx.meta.accessTokenRaw || ctx.params.accessToken;
				if (raw) {
					try {
						const payload = jwt.verify(raw, JWT_SECRET);
						if (payload.type === "access" && payload.jti && payload.exp) {
							const ttlSec = payload.exp - Math.floor(Date.now() / 1000);
							if (ttlSec > 0) {
								await authRedis.set(
									`blacklist:${payload.jti}`,
									"1",
									"EX",
									ttlSec
								);
							}
						}
					} catch (e) {
						// ignore
					}
				}

				await authRedis.del(refreshSetKey);

				return {
					success: true,
					message: "Logged out from all devices successfully"
				};
			}
		},

		/**
		 * Verify access token (called by API gateway).
		 */
		verifyAccessToken: {
			params: {
				token: "string"
			},
			async handler(ctx) {
				const { token } = ctx.params;
				let payload;

				try {
					payload = jwt.verify(token, JWT_SECRET);
				} catch (err) {
					throw new MoleculerClientError("Invalid token", 401);
				}

				if (payload.type !== "access") {
					throw new MoleculerClientError("Invalid token type", 401);
				}

				if (payload.jti) {
					const blacklisted = await authRedis.get(`blacklist:${payload.jti}`);
					if (blacklisted) {
						throw new MoleculerClientError("Token revoked", 401);
					}
				}

				return {
					userId: payload.userId,
					username: payload.username,
					tenantId: payload.tenantId,
					roles: payload.roles || [],
					scopes: payload.scopes || [],
					deviceType: payload.deviceType,
					ip: payload.ip
				};
			}
		},

		//Verify Generated S2S Token for 1 time use
		verifyS2SToken: {
			params: {
				token: "string"
			},
			async handler(ctx) {
				// For S2S token, we might just check against a known list or database
				// Here, we just accept any token for demonstration
				const s2stoken = ctx.params.token;

				if (!S2STOKENS[s2stoken]) {
					throw new Errors.MoleculerClientError(
						"Invalid S2S token",
						401,
						"INVALID_S2S_TOKEN"
					);
				}
				
				S2STOKENS[s2stoken].counter += 1;
				if(S2STOKENS[s2stoken].counter >= S2STOKENS_MAX) {
					delete S2STOKENS[s2stoken];

					throw new Errors.MoleculerClientError(
						"S2S Token can be used only for server-to-server communication for limited API access",
						401,
						"INVALID_S2S_TOKEN"
					);
				}
				
				return S2STOKENS[s2stoken]
			}
		},
		//Verify Generated S2S Token for 1 time use
		verifyTLToken: {
			params: {
				token: "string"
			},
			async handler(ctx) {
				// For S2S token, we might just check against a known list or database
				// Here, we just accept any token for demonstration
				const tltoken = ctx.params.token;

				if (!TLTOKENS[tltoken]) {
					throw new Errors.MoleculerClientError(
						"Invalid S2S token",
						401,
						"INVALID_S2S_TOKEN"
					);
				}
				
				TLTOKENS[tltoken].counter += 1;
				if(TLTOKENS[tltoken].counter >= TLTOKENS_MAX) {
					delete TLTOKENS[tltoken];

					throw new Errors.MoleculerClientError(
						"TL Token can be used only for server-to-server communication for limited API access",
						401,
						"INVALID_TL_TOKEN"
					);
				}
				
				return TLTOKENS[tltoken]
			}
		}
	},
	methods: {
		async issueS2SToken(ctx) {
			const sessionId = `${ctx.params.appid}:${ctx.params.appid}:${Date.now()}`;

			const accessJti = `acc:${sessionId}`;
			const refreshJti = `ref:${sessionId}`;

			const payloadBase = {
				"appId": ctx.params.appid,
				"ip": ctx.meta.remoteIP,
				"deviceType": "s2s"
			};

			const accessToken = jwt.sign(
				{
					type: "access",
					...payloadBase
				},
				JWT_SECRET,
				{
					expiresIn: ACCESS_TOKEN_TTL,
					jwtid: accessJti
				}
			);

			const s2stoken = UNIQUEID.generate(12);

			S2STOKENS[s2stoken] = {
				appId: ctx.params.appid,
				accessToken: accessToken,
				expiresAt: Date.now() + (ACCESS_TOKEN_TTL * 1000),
				scopes: ["/api/tenant:*"],
				ip: ctx.meta.remoteIP,
				deviceType: "s2s",
				counter: 0
			};

			return {
				"status": "success",
				"token_type": "S2S",
				"token": s2stoken,
				"accessToken": accessToken,
				"expiresIn": ACCESS_TOKEN_TTL,
				"appid": ctx.params.appid
			}
		},

		async issueTimeLimitedToken(ctx) {
			const sessionId = `${ctx.params.appid}:${ctx.params.appid}:${Date.now()}`;

			const accessJti = `acc:${sessionId}`;
			const refreshJti = `ref:${sessionId}`;

			const payloadBase = {
				"appId": ctx.params.appid,
				"ip": ctx.meta.remoteIP,
				"deviceType": "s2s"
			};

			const accessToken = jwt.sign(
				{
					type: "access",
					...payloadBase
				},
				JWT_SECRET,
				{
					expiresIn: ACCESS_TOKEN_TTL,
					jwtid: accessJti
				}
			);

			const tltoken = UNIQUEID.generate(12);

			TLTOKENS[tltoken] = {
				appId: ctx.params.appid,
				accessToken: accessToken,
				expiresAt: Date.now() + (ACCESS_TOKEN_TTL * 1000),
				scopes: ["/api/tenant:*"],
				ip: ctx.meta.remoteIP,
				deviceType: "s2s",
				counter: 0
			};

			return {
				"status": "success",
				"token_type": "TL",
				"token": tltoken,
				"accessToken": accessToken,
				"expiresIn": ACCESS_TOKEN_TTL,
				"appid": ctx.params.appid
			}
		},
		/**
		 * Issue access + refresh token pair & manage Redis indices.
		 */
		async issueTokensForUser(user, ip, deviceType = "web") {
			const sessionId = `${user.id}:${Date.now()}:${deviceType}`;

			const accessJti = `acc:${sessionId}`;
			const refreshJti = `ref:${sessionId}`;

			const payloadBase = {
				userId: user.id,
				username: user.username,
				tenantId: user.tenantId,
				roles: user.roles || [],
				scopes: user.scopes || [],
				ip,
				deviceType
			};

			const accessToken = jwt.sign(
				{
					type: "access",
					...payloadBase
				},
				JWT_SECRET,
				{
					expiresIn: ACCESS_TOKEN_TTL,
					jwtid: accessJti
				}
			);

			const refreshToken = jwt.sign(
				{
					type: "refresh",
					...payloadBase
				},
				JWT_SECRET,
				{
					expiresIn: REFRESH_TOKEN_TTL,
					jwtid: refreshJti
				}
			);

			// Store individual refresh token
			await authRedis.set(
				`refresh:${refreshJti}`,
				JSON.stringify({
					userId: user.id,
					tenantId: user.tenantId,
					deviceType,
					sessionId,
					ip
				}),
				"EX",
				REFRESH_TOKEN_TTL
			);

			// Index of all refresh tokens per tenant+user
			await authRedis.sadd(
				`user_sessions:${user.tenantId}:${user.id}`,
				refreshJti
			);
			await authRedis.expire(
				`user_sessions:${user.tenantId}:${user.id}`,
				REFRESH_TOKEN_TTL
			);

			return {
				accessToken,
				refreshToken,
				tokenType: "Bearer",
				expiresIn: ACCESS_TOKEN_TTL,
				user: {
					id: user.id,
					userId: user.id,
					username: user.username,
					tenantId: user.tenantId,
					roles: user.roles || [],
					scopes: user.scopes || []
				}
			};
		}
	}
};
