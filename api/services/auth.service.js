"use strict";

const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const JWT_SECRET = CONFIG.authjwt.secret;
const JWT_ALGORITHM = CONFIG.authjwt.algorithm || "HS256";//RS256, HS256
const ACCESS_TOKEN_TTL = Number(CONFIG.authjwt.access_token_ttl || 3600);              // seconds
const REFRESH_TOKEN_TTL = Number(CONFIG.authjwt.refresh_token_ttl || 7 * 24 * 3600);   // seconds

// Redis DB for auth-related state (you can use a dedicated DB index)
const authRedis = _CACHE.getRedisInstance();

const S2STOKENS_MAX = 10;
const TLTOKENS_MAX = 10;
const GEO_DISTANCE_MAX = 10000;

const DEVICE_LOCK_ENABLED = false;
const GEOFENCES_ENABLED = false;

const TLTOKEN_SCOPES = ["/api"];
const S2STOKEN_SCOPES = ["/api/*"];

authRedis.on("error", (err) => {
	// eslint-disable-next-line no-console
	console.error("❌ Auth Redis error:", err);
});

module.exports = {
	name: "auth",

	actions: {
		/**
		 * Short Lived Tokens that give temporary access to limited part of system
		 * Used for opening application first page, etc
		 * POST /api/public/auth/tltoken
		 */
		tltoken: {
			rest: {
				method: "POST",
				path: "/tltoken"
			},
			meta: {
				// scopes: ["docs:read"] // only those with docs:read (tenant-aware) see docs
				// deviceType: { type: "string", optional: true, default: "web" },
				// deviceid: "string",//{ type: "string", optional: true, default: "" },
			},
			params: {
				appid: "string",
				geolocation: { type: "string", optional: true, default: "0,0" },
			},
			async handler(ctx) {
				return this.issueTimeLimitedToken(ctx);
			}
		},

		/**
		 * Server 2 Server token issuance for device level access or server to server communication, 
		 * they give absolute access to limited part of system
		 * 
		 * This used for IOT systems or S2S communications
		 * 
		 * POST /api/public/auth/s2stoken
		 */
		s2stoken: {
			rest: {
				method: "POST",
				path: "/s2stoken"
			},
			params: {
				appid: "string",
				appkey: "string",
				deviceid: "string",//{ type: "string", optional: true, default: "" },
				deviceType: { type: "string", optional: true, default: "web" },
				geolocation: { type: "string", optional: true, default: "0,0" },
			},
			async handler(ctx) {
				//Check appkey is valid with valid appid
				if(ctx.params.appid!=ctx.meta.appInfo.appid) {
					throw new LogiksError("APPID Mismatch", 401);
				}

				//check if ip lock is enabled for this device, if yes, then check remoteIP
				const ipAllowed = AUTHKEY.checkClientIP(ctx.meta.remoteIP, ctx.meta.appInfo.appid, false);
				if(!ipAllowed) {
					throw new LogiksError("IP Whitelisting Required for S2S Calls", 401);
				}
				
				//check if geofencing is enabled, if yes, then validate the geofencing and generart logs for every change

				//Check deviceid preloaded, else load it into waiting queue till approved

				const apiInfo = await AUTHKEY.getAPIKeyInfo(ctx.params.appkey, "s2s");
				if(!apiInfo) {
					throw new LogiksError("Invalid APPKEY", 401);
				}

				return this.issueS2SToken(ctx, apiInfo);
			}
		},

		//for magic link login

		/**
		 * Generate Auth Link
		 * POST /api/public/auth/authlink
		 */
		authlink: {
			rest: {
				method: "POST",
				path: "/authlink",
				geolocation: { type: "string", optional: true, default: "0,0" },
			},
			async handler(ctx) {
				if(!CONFIG.logiksauth.enable) {
					throw new LogiksError("LogiksAuth not configured", 401);
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

		/**
		 * Called while returning from LogiksAuth Pages
		 * POST /api/public/auth/logiksauth-login
		 */
		logiksAuthLogin: {
			rest: {
				method: "GET",
				path: "/logiksauth-login"
			},
			async handler(ctx) {
				console.log("FEDERATED_LOGIN_logiksAuthLogin", { url: req.url, method: req.method, headers: req.headers, query: req.query, body: req.body, params: req.params, meta: ctx.meta });
				//http://192.168.0.27:6008/?client_id=demo&client_key=BO-uTCu4VF0-XhffsBjCefBSrWorVfcFH_8x7m0dWVU&client_method=logiksauth
				return {
					"status": "success",
					"message": "LogiksAuth login is not yet implemented"
				}
			}
		},

		/**
		 * LogiksAuth Redirect Login Key Verification.
		 * POST /api/public/auth/authtoken
		 * To Be removed in future
		 * @todo remove
		 */
		// authtoken: {
		// 	rest: {
		// 		method: "POST",
		// 		path: "/authtoken"
		// 	},
		// 	params: {
		// 		appid: "string",
		// 		client_key: "string",
		// 		deviceType: { type: "string", optional: true, default: "web" },
		// 		geolocation: { type: "string", optional: true, default: "0,0" },
		// 	},
		// 	async handler(ctx) {
				
		// 		const { deviceType } = ctx.params;
		// 		const username = "";
		// 		const password = ""; 
		// 		const privilage= "admin";
		// 		const roles= ["admin"];
		// 		const scopes= [
		// 			"tenant-1:orders:read",
		// 			"tenant-1:orders:write",
		// 			"tenant-1:docs:read"
		// 		];

		// 		const userData = {
		// 			id: username,
		// 			username: username,
		// 			tenantId: username,

		// 			guid: ctx.params.appid,
		// 			userId: "ATKN",
		// 			geolocation: ctx.params.geolocation?ctx.params.geolocation:"0,0",

		// 			privilage: privilage,
		// 			roles: roles,
		// 			scopes: scopes
		// 		};

		// 		// if (username !== fakeUserFromDB.username) {
		// 		// 	throw new LogiksError("Invalid credentials", 401);
		// 		// }

		// 		// const valid = await bcrypt.compare(password, fakeUserFromDB.passwordHash);
		// 		// if (!valid) {
		// 		// 	throw new LogiksError("Invalid credentials", 401);
		// 		// }

		// 		const token = this.issueTokensForUser(userData, ctx.meta.remoteIP, deviceType, ctx);
		// 		await log_login(userData, "AUTHTOKEN-GENERATED", "/authtoken", ctx);
		// 		return token;
		// 	}
		// },

		//To allow 3rd party federated login (Google, Facebook, Apple, etc), called while returning to application
		federatedLogin: {
			rest: {
				method: "GET",
				path: "/federated-login/:source?"
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
				deviceid: { type: "string", optional: true, default: "" },
				deviceType: { type: "string", optional: true, default: "web" },
				geolocation: { type: "string", optional: true, default: "0,0" },
			},
			async handler(ctx) {
				var { username, password, deviceType, geolocation } = ctx.params;

				const userInfo = await USERS.verifyUser(username, password, ctx.meta.appInfo.appid);
				if(!userInfo) {
					await log_login_error({
						"guid": "-",
						"userId": username,
						"geolocation": geolocation
					}, "USER-LOGIN", "/login", "Invalid credentials", ctx);
					throw new LogiksError("Invalid credentials", 401);
				}
				var userDataUpdated = await generateUserMap(userInfo, geolocation, ctx.meta.remoteIP, ctx.meta.appInfo.appid);
				userDataUpdated.vcode = userInfo.vcode;
				
				//More fields to be used to authenticate user
				// {
				// 	tags: null,
				// 	registered_site: null,
				// 	vcode: null,
				// 	mauth: null,
				// 	refid: null,
				// }
				// console.log("userInfo", userInfo, userDataUpdated);

				//Password expiry
				if(userInfo.expires!=null && userInfo.expires.length>0) {
					const isPast = new Date(userInfo.expires) < new Date();
					if(isPast) {
						await log_login_error({
							"guid": userInfo.guid,
							"userId": username,
							"geolocation": geolocation
						}, "USER-LOGIN", "/login", "Password expired, contact admin for renewing your password", ctx);
						throw new LogiksError("Password expired, contact admin for renewing your password", 401);
					}
				}

				//check if geofencing is enabled, if yes, then validate the geofencing and generart logs for every change
				if(userInfo.geolocation && userInfo.geolocation.length>0) {
					if(geolocation=="0,0") {
						await log_login_error({
							"guid": userInfo.guid,
							"userId": username,
							"geolocation": geolocation
						}, "USER-LOGIN", "/login", "Geolocation mandatory for proceeding with login", ctx);
						throw new LogiksError("Geolocation mandatory for proceeding with login", 401);
					}
					const geoDistance = MISC.geoDistanceMeters(userInfo.geolocation, geolocation);
					if(geoDistance>GEO_DISTANCE_MAX) {
						await log_login_error({
							"guid": userInfo.guid,
							"userId": username,
							"geolocation": geolocation
						}, "USER-LOGIN", "/login", "Locked by Geofence, you are not in allowed geolocation (1)", ctx);
						throw new LogiksError("Locked by Geofence, you are not in allowed geolocation (1)", 401);
					}
				}

				//check if ip lock is enabled for this device, if yes, then check remoteIP
				if(userInfo.geoip && userInfo.geoip.length>0 && userInfo.geoip!=ctx.meta.remoteIP) {
					await log_login_error({
						"guid": userInfo.guid,
						"userId": username,
						"geolocation": geolocation
					}, "USER-LOGIN", "/login", "Locked by Geofence, you are not in allowed geolocation (2)", ctx);
					throw new LogiksError("Locked by Geofence, you are not in allowed geolocation (2)", 401);
				}

				//Check deviceid if device lock is enabled, if yes, then check in log_devices for last access for the user
				await check_log_device(userInfo, ctx);
				
				//check_geofencing with office locations
				const allowedGeoAccess = check_geofencing(userInfo, geolocation);
				if(!allowedGeoAccess) {
					await log_login_error({
						"guid": userInfo.guid,
						"userId": username,
						"geolocation": geolocation
					}, "USER-LOGIN", "/login", "Geofencing Locked, you are not within any allowed premises", ctx);
					throw new LogiksError("Geofencing Locked, you are not within any allowed premises", 401);
				}

				const token = this.issueTokensForUser(userDataUpdated, ctx.meta.remoteIP, deviceType, ctx);
				await log_login(userDataUpdated, "USER-LOGIN", "/login", ctx);
				return token;
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
				username: "string",
				password: "string",
				deviceType: { type: "string", optional: true, default: "web" },
				geolocation: { type: "string", optional: true, default: "0,0" },
			},
			async handler(ctx) {
				var { username, password, deviceType, geolocation } = ctx.params;
				if(!geolocation) geolocation = "0,0";

				const userInfo = await USERS.verifyUser(username, password, ctx.meta.appInfo.appid);
				if(!userInfo) {
					await log_login_error({
						"guid": "-",
						"userId": username,
						"geolocation": geolocation
					}, "REQUEST-OTP", "/request-otp", "Invalid credentials", ctx);
					throw new LogiksError("Invalid credentials", 401);
				}
				var userDataUpdated = await generateUserMap(userInfo, geolocation, ctx.meta.remoteIP, ctx.meta.appInfo.appid);

				const identifier = MISC.generateUUID("",4);
				const otp = (Math.floor(100000 + Math.random() * 900000)).toString();
				const key = `otp:${identifier}`;

				await authRedis.set(
					key,
					JSON.stringify({ otp, deviceType, user: userDataUpdated }),
					"EX",
					300 // 5 minutes
				);

				// TODO: integrate SMS/email provider
				console.log("OTP generated", { identifier, otp, deviceType, user: userDataUpdated });

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
				deviceType: { type: "string", optional: true, default: "web" },
				geolocation: { type: "string", optional: true, default: "0,0" },
			},
			async handler(ctx) {
				const { identifier, otp, deviceType } = ctx.params;

				const key = `otp:${identifier}`;
				const stored = await authRedis.get(key);

				if (!stored) {
					await log_login_error({
						"guid": "-",
						"userId": "-",
						"geolocation": geolocation
					}, "VERIFY-OTP", "/verify-otp", "Invalid or expired OTP (1)", ctx);
					throw new LogiksError("Invalid or expired OTP", 401);
				}

				const parsed = JSON.parse(stored);
				if (parsed.otp !== otp) {
					await log_login_error({
						"guid": "-",
						"userId": "-",
						"geolocation": geolocation
					}, "VERIFY-OTP", "/verify-otp", "Invalid or expired OTP (2)", ctx);
					throw new LogiksError("Invalid or expired OTP", 401);
				}

				await authRedis.del(key);

				// TODO: map identifier → real user
				const user = parsed.user;

				const token = this.issueTokensForUser(user, ctx.meta.remoteIP, deviceType, ctx);
				await log_login(user, "USER-LOGIN-OTP", "/verify-otp", ctx);
				return token;
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
				deviceType: "string",
				geolocation: "string",
			},
			async handler(ctx) {
				const { refreshToken, deviceType, geolocation } = ctx.params;
				let payload;

				try {
					payload = jwt.verify(refreshToken, JWT_SECRET);
				} catch (err) {
					await log_login_error({
						"guid": "-",
						"userId": "-",
						"geolocation": geolocation
					}, "USER-REFRESH-LOGIN", "/refresh", "Invalid refresh token (1)", ctx);
					throw new LogiksError("Invalid refresh token", 401);
				}

				if (payload.type !== "refresh") {
					await log_login_error({
						"guid": "-",
						"userId": "-",
						"geolocation": geolocation
					}, "USER-REFRESH-LOGIN", "/refresh", "Invalid refresh token (2)", ctx);
					throw new LogiksError("Invalid refresh token type", 401);
				}

				const jti = payload.jti;
				const key = `refresh:${jti}`;
				const stored = await authRedis.get(key);

				if (!stored) {
					await log_login_error({
						"guid": "-",
						"userId": "-",
						"geolocation": geolocation
					}, "USER-REFRESH-LOGIN", "/refresh", "Refresh token revoked", ctx);
					throw new LogiksError("Refresh token revoked", 401);
				}

				// Rotate: delete old
				await authRedis.del(key);

				var userInfo = await authRedis.get(`user:${ctx.meta.sessionId}`);
				try {
					userInfo = JSON.parse(userInfo);
				} catch(e) {
					await log_login_error({
						"guid": "-",
						"userId": "-",
						"geolocation": geolocation
					}, "USER-REFRESH-LOGIN", "/refresh", "User Info Missing, try login again", ctx);
					throw new LogiksError("User Info Missing, try login again", 401);
				}

				const token = this.issueTokensForUser(userInfo, ctx.meta.remoteIP, deviceType, ctx);
				await log_login(userInfo, "USER-REFRESH-LOGIN", "/refresh", ctx);
				return token;
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
					throw new LogiksError("Unauthorized", 401);
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
					await log_login_error({
						"guid": "-",
						"userId": "-",
						"geolocation": "0,0"
					}, "VERIFY-TOKEN", "/-", "Invalid token - ACCESS", ctx);
					throw new LogiksError("Invalid token", 401);
				}

				if (payload.type !== "access") {
					await log_login_error({
						"guid": payload.guid,
						"userId": payload.userId,
						"geolocation": payload.geolocation
					}, "VERIFY-TOKEN", "/-", "Invalid token type - ACCESS", ctx);
					throw new LogiksError("Invalid token type", 401);
				}

				if (payload.jti) {
					const blacklisted = await authRedis.get(`blacklist:${payload.jti}`);
					if (blacklisted) {
						await log_login_error({
							"guid": payload.guid,
							"userId": payload.userId,
							"geolocation": payload.geolocation
						}, "VERIFY-TOKEN", "/-", "Revoked token - ACCESS", ctx);
						throw new LogiksError("Token revoked", 401);
					}
				}
				const sessionId = payload.jti.replace("acc:","").replace("ref:","");

				payload = JSON.parse(ENCRYPTER.decrypt(payload.payload, JWT_SECRET));

				// console.log("XXXXX", payload, sessionId);
				return {
					userId: payload.userId,
					username: payload.username,
					tenantId: payload.tenantId,
					privilege: payload.privilege,
					roles: payload.roles || [],
					scopes: payload.scopes || [],
					deviceType: payload.deviceType,
					ip: payload.ip,
					sessionId: sessionId,
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
				const key = `S2STOKENS:${s2stoken}`;

				let stored = await authRedis.get(key);

				try {
					stored = JSON.parse(stored);
				} catch(e) {}

				if (!stored) {
					await log_login_error({
						"guid": "-",
						"userId": "-",
						"geolocation": "0,0"
					}, "VERIFY-TOKEN-S2S", "/-", "Invalid token - S2S", ctx);
					throw new LogiksError(
						"Invalid S2S token",
						401,
						"INVALID_S2S_TOKEN"
					);
				}
				
				stored.counter += 1;

				await authRedis.set(
					key,
					JSON.stringify(stored),
					"EX",
					300 // 5 minutes
				);

				if(stored.counter >= S2STOKENS_MAX) {
					await authRedis.del(key);

					await log_login_error({
						"guid": "-",
						"userId": "-",
						"geolocation": "0,0"
					}, "VERIFY-TOKEN-S2S", "/-", "Expired token - S2S", ctx);

					throw new LogiksError(
						"S2S Token can be used only for server-to-server communication for limited API access",
						401,
						"INVALID_S2S_TOKEN"
					);
				}
				
				return stored;
			}
		},
		//Verify Generated TL Token for TLTOKENS_MAX time use and IP match
		verifyTLToken: {
			params: {
				token: "string"
			},
			async handler(ctx) {
				// For S2S token, we might just check against a known list or database
				// Here, we just accept any token for demonstration
				const tltoken = ctx.params.token;
				const key = `TLTOKENS:${tltoken}`;

				let stored = await authRedis.get(key);

				try {
					stored = JSON.parse(stored);
				} catch(e) {}

				if (!stored) {
					await log_login_error({
						"guid": "-",
						"userId": "-",
						"geolocation": "0,0"
					}, "VERIFY-TOKEN-TLT", "/-", "Invalid token - TLT", ctx);

					throw new LogiksError(
						"Invalid TL token",
						401,
						"INVALID_TL_TOKEN"
					);
				}

				if(stored.ip!=ctx.meta.remoteIP) {
					await log_login_error({
						"guid": "-",
						"userId": "-",
						"geolocation": "0,0"
					}, "VERIFY-TOKEN-TLT", "/-", "Invalid IP for the given Token - TLT", ctx);

					throw new LogiksError(
						"Invalid TL token",
						401,
						"INVALID_TL_TOKEN"
					);
				}
				
				stored.counter += 1;

				await authRedis.set(
					key,
					JSON.stringify(stored),
					"EX",
					300 // 5 minutes
				);

				if(stored.counter >= TLTOKENS_MAX) {
					await authRedis.del(key);

					await log_login_error({
						"guid": "-",
						"userId": "-",
						"geolocation": "0,0"
					}, "VERIFY-TOKEN-TLT", "/-", "Expired token - TLT", ctx);

					throw new LogiksError(
						"TL Token can be used only for server-to-server communication for limited API access",
						401,
						"INVALID_TL_TOKEN"
					);
				}
				
				return stored;
			}
		},

		getMyInfo: {
			handler: async function(ctx) {
				var userInfo = await authRedis.get(`user:${ctx.meta.sessionId}`);
				try {
					userInfo = JSON.parse(userInfo);
				} catch(e) {
					console.error("Error finding UserInfo");
				}

				return userInfo;
			},
		}
	},
	methods: {
		async issueTimeLimitedToken(ctx) {
			const sessionId = `${ctx.params.appid}:${ctx.params.appid}:${Date.now()}`;

			const accessJti = `acc:${sessionId}`;
			// const refreshJti = `ref:${sessionId}`;

			const payloadBase = {
				"appId": ctx.params.appid,
				"ip": ctx.meta.remoteIP,
				"deviceType": "tlt"
			};

			const accessToken = jwt.sign(
				{
					type: "access",
					...payloadBase
				},
				JWT_SECRET,
				{
					algorithm: JWT_ALGORITHM,
					expiresIn: ACCESS_TOKEN_TTL,
					jwtid: accessJti
				}
			);

			const tltoken = UNIQUEID.generate(12);

			const tempObj = {
				appId: ctx.params.appid,
				guid: ctx.params.appid,
				userId: "tlt",
				geolocation: ctx.params.geolocation?ctx.params.geolocation:"0,0",
				accessToken: accessToken,
				expiresAt: Date.now() + (ACCESS_TOKEN_TTL * 1000),
				scopes: TLTOKEN_SCOPES,
				ip: ctx.meta.remoteIP,
				deviceType: "tlt",
				counter: 0
			};

			await authRedis.set(
					`TLTOKENS:${tltoken}`,
					JSON.stringify(tempObj),
					"EX",
					300 // 5 minutes
				);
			//log_login(userInfo, loginType, loginURI, loginStatus, ctx)
			await log_login(tempObj, "TLT-GENERATED", "/tltoken", ctx);

			return {
				"status": "success",
				"token_type": "TL",
				"token": tltoken,
				"accessToken": accessToken,
				"expiresIn": ACCESS_TOKEN_TTL,
				"appid": ctx.params.appid
			}
		},

		async issueS2SToken(ctx, apiInfo) {
			const sessionId = `${ctx.params.appid}:${ctx.params.appid}:${Date.now()}`;

			const accessJti = `acc:${sessionId}`;

			const payloadBase = {
				appId: ctx.params.appid,
				userId: apiInfo.id,
				username: apiInfo.userId,
				tenantId: apiInfo.guid,
				ip: ctx.meta.remoteIP,
				deviceType: "s2s",
				roles: apiInfo.roles || [],
				scopes: apiInfo.scopes || [],
			};

			const accessToken = jwt.sign(
				{
					type: "access",
					...payloadBase
				},
				JWT_SECRET,
				{
					algorithm: JWT_ALGORITHM,
					expiresIn: ACCESS_TOKEN_TTL,
					jwtid: accessJti
				}
			);

			const s2stoken = UNIQUEID.generate(12);

			const tempObj = {
				appId: ctx.params.appid,
				guid: apiInfo.guid,
				userId: apiInfo.userId,
				geolocation: ctx.params.geolocation?ctx.params.geolocation:"0,0",
				accessToken: accessToken,
				expiresAt: Date.now() + (ACCESS_TOKEN_TTL * 1000),
				scopes: S2STOKEN_SCOPES,
				ip: ctx.meta.remoteIP,
				deviceid: ctx.params.deviceid,
				deviceType: "s2s",
				counter: 0
			};

			await authRedis.set(
					`S2STOKENS:${s2stoken}`,
					JSON.stringify(tempObj),
					"EX",
					300 // 5 minutes
				);
			//log_login(userInfo, loginType, loginURI, loginStatus, ctx)
			await log_login(tempObj, "S2ST-GENERATED", "/tltoken", ctx);

			return {
				"status": "success",
				"token_type": "S2S",
				"token": s2stoken,
				"accessToken": accessToken,
				"expiresIn": ACCESS_TOKEN_TTL,
				"appid": ctx.params.appid
			}
		},
		
		/**
		 * Issue access + refresh token pair & manage Redis indices.
		 */
		async issueTokensForUser(user, ip, deviceType = "web", ctx) {
			const sessionId = `${user?.id}:${Date.now()}:${deviceType}`;

			const accessJti = `acc:${sessionId}`;
			const refreshJti = `ref:${sessionId}`;

			const payloadBase = {
				appId: ctx.meta.appInfo.appid,
				id: user.id,
				userId: user.userId,
				username: user.name,
				tenantId: user.tenantId,
				guid: user.guid,
				privilege: user.privilege,
				roles: user.roles || [],
				scopes: user.scopes || [],
				ip,
				deviceType
			};

			const accessToken = jwt.sign(
				{
					type: "access",
					// ...payloadBase
					payload: ENCRYPTER.encrypt(JSON.stringify(payloadBase), JWT_SECRET)
				},
				JWT_SECRET,
				{
					algorithm: JWT_ALGORITHM,
					expiresIn: ACCESS_TOKEN_TTL,
					jwtid: accessJti
				}
			);

			const refreshToken = jwt.sign(
				{
					type: "refresh",
					// ...payloadBase
					payload: ENCRYPTER.encrypt(JSON.stringify(payloadBase), JWT_SECRET)
				},
				JWT_SECRET,
				{
					algorithm: JWT_ALGORITHM,
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

			await authRedis.set(
				`user:${sessionId}`,
				JSON.stringify(user),
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
				// user: {
				// 	id: user.id,
				// 	userId: user.userId,
				// 	username: user.username,
				// 	tenantId: user.tenantId,
				// 	roles: user.roles || [],
				// 	scopes: user.scopes || []
				// }
			};
		}
	}
};


async function generateUserMap(userInfo, geolocation, geoIP, appid) {
	return {
		id: userInfo.id,
		userId: userInfo.userid,
		tenantId: userInfo.guid,
		guid: userInfo.guid,
		name: userInfo.name,
		reporting_to: userInfo.reporting_to,
		dob: userInfo.dob.split("T")[0],
		gender: userInfo.gender,
		mobile: userInfo.mobile,
		email: userInfo.email,
		address: userInfo.address,
		region: userInfo.region,
		country: userInfo.country,
		zipcode: userInfo.zipcode,
		roles: userInfo.roles_list,
		scopes: userInfo.scopes,//["tenant-1:orders:read", "tenant-1:orders:write", "tenant-1:docs:read"],
		group: {
			id: userInfo.groupid,
			name: userInfo.group_name,
			manager: userInfo.group_manager,
			parent: userInfo.group_parent,
			phone: userInfo.group_phone,
			email: userInfo.group_email,
			branch: userInfo.group_branch,
			area: userInfo.group_area,
			region: userInfo.group_region,
			state: userInfo.group_state,
			zone: userInfo.group_zone,
			country: userInfo.group_country
		},
		privilege: {
			id: userInfo.privilegeid,
			name: userInfo.privilege_name,
			hash: ENCRYPTER.generateHash(`${userInfo.privilegeid}_${userInfo.privilege_name}`)
		},
		access: {
			id: userInfo.accessid,
			name: userInfo.access_name,
			sites: userInfo.scope_sites=="*"? [appid]: userInfo.scope_sites.split(",")
		},
		privilege: userInfo.privilege_name,
		privacy: userInfo.privacy,
		security_policy: userInfo.security_policy,
		avatar: await USERS.getUserAvatar(userInfo.avatar, userInfo.avatar_type),
		timestamp: moment().format("Y-M-D HH:mm:ss"),
		geolocation: geolocation,
		geoip: geoIP
	};
}

async function log_login(userInfo, loginType, loginURI, ctx) {
	const dated = moment().format("Y-M-D HH:mm:ss");
	var userAgent = ctx.meta.headers["user-agent"];

	var createData = {
		"appid": ctx.meta.appInfo.appid, 
		"guid": userInfo.guid,
		"loginid": userInfo.userId, 
		"event_type": loginType, 
		"geolocation": userInfo.geolocation, 
		"uri": loginURI, 
		"client_ip": ctx.meta.remoteIP, 
		"server_ip": ctx.meta.serverIP || "0.0.0.0", 
		"host": ctx.meta.serverHost || "-", 
		"user_agent": userAgent || "-", 
		"device_fingerprint": ctx.params.deviceid || "-", 
		"medium": ctx.params.device || "api", 
		"reason": "LOGIN", 
		"status": "SUCCESS",
		"timestamp": dated, 
        "created_on": dated,
        "created_by": userInfo.userId,
        "edited_on": dated,
        "edited_by": userInfo.userId,
	};

	// console.log("LOG_LOGIN", createData);
	// CONFIG.log_sql = true;
	var a = await _DB.db_insertQ1("logdb", "log_logins", createData);

	await _DB.db_updateQ("appdb", "lgks_users", {
		last_login: dated,
		last_login_ip: ctx.meta.remoteIP
	}, {
		"userid": userInfo.userId
	});
	
	return;
}

async function log_login_error(userInfo, loginType, loginURI, errorMessage, ctx) {
	const dated = moment().format("Y-M-D HH:mm:ss");
	var userAgent = ctx.meta.headers["user-agent"];

	var createData = {
		"appid": ctx.meta.appInfo.appid, 
		"guid": userInfo.guid?userInfo.guid:"-",
		"loginid": userInfo.userId, 
		"event_type": `ERROR-${loginType}`, 
		"geolocation": userInfo.geolocation, 
		"uri": loginURI, 
		"host": ctx.meta.serverHost, 
		"client_ip": ctx.meta.remoteIP, 
		"server_ip": ctx.meta.serverIP || "0.0.0.0", 
		"user_agent": userAgent?userAgent:"-", 
		"device_fingerprint": ctx.params.deviceid?ctx.params.deviceid:"-", 
		"medium": ctx.params.device?ctx.params.device:"api", 
		"reason": errorMessage, 
		"status": "ERROR", 
		"timestamp": dated, 
        "created_on": dated,
        "created_by": userInfo.userId,
        "edited_on": dated,
        "edited_by": userInfo.userId,
	};

	// console.log("LOG_LOGIN_ERROR", createData);
	// CONFIG.log_sql = true;
	var a = await _DB.db_insertQ1("logdb", "log_logins", createData);

	return;
}

async function check_log_device(userInfo, ctx) {
	const dated = moment().format("Y-M-D HH:mm:ss");
	const geolocation = ctx.params.geolocation?ctx.params.geolocation:"0,0";
	const deviceId = ctx.params.deviceid?ctx.params.deviceid:"";
	if(!deviceId) {
		if(DEVICE_LOCK_ENABLED) {
			await log_login_error({
				"guid": userInfo.guid,
				"userId": userInfo.userId, 
				"geolocation": geolocation
			}, "USER-LOGIN", "/login", "DeviceID Missing cannot proceed", ctx);
			throw new LogiksError("DeviceID Missing cannot proceed", 401);
		}
	}

	var createData = {
		"appid": ctx.meta.appInfo.appid, 
		"guid": userInfo.guid?userInfo.guid:"-",
		"userid": userInfo.userId, 
		"device_uuid": deviceId, 
		"device_model": "-",
		"os_version": "-",
		"ip_address": ctx.meta.remoteIP,
		"geolocation": geolocation, 
		"is_active": "true",
		"lock_status": "ALLOWED",//LOCKED, ALLOWED, PENDING_APPROVAL
		"last_accessed": dated,
		"access_count": 1,
        "created_on": dated,
        "created_by": userInfo.userId,
        "edited_on": dated,
        "edited_by": userInfo.userId,
	};

	var deviceData = await _DB.db_selectQ("logdb", "log_devices", "*", {
		"blocked": "false",
		"is_active": "true",
		// "device_uuid": deviceId, 
		"userid": userInfo.userId, 
		"appid": ctx.meta.appInfo.appid, 
		"guid": userInfo.guid?userInfo.guid:"-",
	}, {}, " ORDER BY id DESC LIMIT 1");

	if(deviceData && deviceData.results?.length>0) {
		if(DEVICE_LOCK_ENABLED) {
			if(deviceData.results[0].device_uuid!=deviceId) {
				await log_login_error({
					"guid": userInfo.guid,
					"userId": userInfo.userId, 
					"geolocation": geolocation
				}, "USER-LOGIN", "/login", "DeviceID Changed, please contact admin", ctx);
				throw new LogiksError("DeviceID Changed, please contact admin", 401);
			}
		}
		if(deviceData.results[0].lock_status=="LOCKED") {
			await log_login_error({
				"guid": userInfo.guid,
				"userId": userInfo.userId, 
				"geolocation": geolocation
			}, "USER-LOGIN", "/login", "Device is Locked, use other device", ctx);
			throw new LogiksError("Device is Locked, use other device", 401);
		}
		if(deviceData.results[0].lock_status=="PENDING_APPROVAL") {
			await log_login_error({
				"guid": userInfo.guid,
				"userId": userInfo.userId, 
				"geolocation": geolocation
			}, "USER-LOGIN", "/login", "Device is not yet approved, please contact admin", ctx);
			throw new LogiksError("Device is not yet approved, please contact admin", 401);
		}
		
		var a = await _DB.db_updateQ("logdb", "log_devices", `access_count=access_count+1, last_accessed=now(), geolocation='${geolocation}', ip_address='${ctx.meta.remoteIP}'`, {
			id: deviceData.results[0].id
		});
		// console.log("UPDATED", a);
	} else {
		var a = await _DB.db_insertQ1("logdb", "log_devices", createData);
		// console.log("INSERT", a);
	}

	return true;
}

async function check_geofencing(userInfo, geolocation) {
	if(!GEOFENCES_ENABLED) return true;

	if(geolocation=="0,0") {
		await log_login_error({
			"guid": userInfo.guid,
			"userId": username,
			"geolocation": geolocation
		}, "USER-LOGIN", "/login", "Geolocation mandatory for proceeding with login", ctx);
		throw new LogiksError("Geolocation mandatory for proceeding with login", 401);
	}

	const geoData = await GEOFENCES.listGeofences(userInfo.guid, geolocation);
	
	// console.log("GEO_DATA", geoData);
	
	return true;
}