"use strict";

const mime = require("mime-types");

const themeCache = {};//_CACHE.getCacheMap("THEMECACHE");
const pageCache = {};//_CACHE.getCacheMap("APPLICATION_PAGECACHE");
const componentCache = {};//_CACHE.getCacheMap("APPLICATION_COMPONENTCACHE");

module.exports = {
    name: "application",

    actions: {
        //Get Application Information
		fetch: {
			rest: {
				method: "GET",
				fullPath: "/api"
			},
			async handler(ctx) {
				// const serverHost = ctx.meta.serverHost;
				const applicationInfo = await BASEAPP.getAppInfo(ctx.meta.appInfo.appid);
				if(!applicationInfo) {
					throw new LogiksError(
						"Invalid Application key",
						404,
						"INVALID_APPLICATION"
					);
				}
				if(applicationInfo.logins) delete applicationInfo.logins;
				//Shivraj Depdencdency
				// if(applicationInfo.login) delete applicationInfo.login;

				const logins = await AUTHFEDERATED.listFederatedLogins(ctx.meta.appInfo.appid);
				applicationInfo.logins = logins;

				delete applicationInfo.domain;

				if(!applicationInfo.feature_flags) applicationInfo.feature_flags = {};
				applicationInfo.feature_flags = _.extend({}, applicationInfo.feature_flags, CTRLCENTER.getAppFeatureFlags(ctx));
				
				return applicationInfo;
			}
		},

		settings: {
			rest: {
				method: "POST",
				fullPath: "/api/settings"
			},
			params: {
				module: "string",
				// recache: "boolean"
			},
			async handler(ctx) {
				const SETTINGS_KEY = `${ctx.meta.user.tenantId}_${ctx.meta.user.userId}_${ctx.params.module || "-"}`;

				// CACHEMAP.get returns {} on a miss
				let settingsCache = ctx.params.recache===true ? {} : await CACHEMAP.get("SETTINGSCACHE", SETTINGS_KEY, false, ctx);
				if(settingsCache && Object.keys(settingsCache).length>0) return settingsCache;

				var whereCond = {
					"blocked": "false",
					"guid": [["global", ctx.meta.user.tenantId], "IN"],
				};
				if(ctx.params.module && ctx.params.module!="*") {
					whereCond["module_name"] = ctx.params.module;
				}
				var data1 = await _DB.db_selectQ("appdb", "sys_settings", "module_name, setting_key, setting_value, setting_params", whereCond, {});
				var data2 = await _DB.db_selectQ("appdb", "user_settings", "module_name, setting_key, setting_value, setting_params", _.extend({
					"created_by": ctx.meta.user.userId
				}, whereCond), {});

				// user rows override tenant/global rows for the same module + key
				settingsCache = {};
				[...(data1?.results || []), ...(data2?.results || [])].forEach(row => {
					if(!settingsCache[row.module_name]) settingsCache[row.module_name] = {};
					settingsCache[row.module_name][row.setting_key] = {
						value: row.setting_value,
						params: row.setting_params
					};
				});
				
				await CACHEMAP.set("SETTINGSCACHE", SETTINGS_KEY, settingsCache, ctx);

				return settingsCache;
			}
		},
		feature_flags: {
			rest: {
				method: "POST",
				fullPath: "/api/feature_flags"
			},
			params: {
				module: "string",
				// recache: "boolean"
			},
			async handler(ctx) {
				var whereCond = {
					"blocked": "false",
					"module": ctx.params.module,
					"guid": [["global", ctx.meta.user.tenantId], "IN"],
					"var_nature": "frontend"
				};
				
				var data1 = await _DB.db_selectQ("appdb", "lgks_ctrlcenter", "module, var_code, var_value", whereCond, {});

				return data1?.results || [];
			}
		},

		settings_save: {
			rest: {
				method: "POST",
				fullPath: "/api/settings/save"
			},
			params: {
				module: "string",
				module_name: "string",
				setting_name: "string",
				setting_value: "string|number|boolean|object|array",
				// setting_params: { type: "object", optional: true }
			},
			async handler(ctx) {
				const params = ctx.params;
				const userId = ctx.meta.user.userId;
				const guid = ctx.meta.user.tenantId;
				const dated = moment().format("YYYY-MM-DD HH:mm:ss");

				if(typeof params.setting_value == "object") params.setting_value = JSON.stringify(params.setting_value);

				// Check if setting already exists
				const existingSetting = await _DB.db_selectQ("appdb", "user_settings", "*", {
					"guid": guid,
					"created_by": userId,
					"module_name": params.module_name,
					"setting_key": params.setting_name,
					"blocked": "false"
				}, {});

				if(existingSetting && existingSetting.results && existingSetting.results.length > 0) {
					// Update existing setting
					await _DB.db_updateQ("appdb", "user_settings", {
						"setting_value": params.setting_value,
						"edited_by": userId,
						"edited_on": dated
					}, {
						"id": existingSetting.results[0].id
					});
				} else {
					// Insert new setting
					await _DB.db_insertQ1("appdb", "user_settings", {
						"guid": guid,
						"appid": ctx.meta?.appInfo?.appid || "-",
						"module_name": params.module_name,
						"setting_key": params.setting_name,
						"setting_value": params.setting_value,
						"setting_params": params.setting_params ? JSON.stringify(params.setting_params) : null,
						"created_by": userId,
						"created_on": dated,
						"edited_by": userId,
						"edited_on": dated
					});
				}

				// Invalidate cache
				await CACHEMAP.set("SETTINGSCACHE", `${guid}_${userId}_${params.module || "-"}`, {}, ctx);
				await CACHEMAP.set("SETTINGSCACHE", `${guid}_${userId}_*`, {}, ctx);

				return { status: "success", message: "Setting saved successfully." };
			}
		},

        //Get Application Layout for the tenant
		layout: {
			rest: {
				method: "GET",
				// fullPath: "/api/layout/:layoutid?"
				fullPath: "/api/layout{/:layoutid}"
			},
			async handler(ctx) {

				if(!ctx.params.layoutid) ctx.params.layoutid = "default";

				const appLayoutFile = `misc/apps/${ctx.meta.appInfo.appid}/layouts/${ctx.params.layoutid}.json`;
				if(fs.existsSync(appLayoutFile)) {
					const layoutData = JSON.parse(fs.readFileSync(appLayoutFile, "utf8"));
					return layoutData;
				} else {
					throw new LogiksError(
						"Invalid Application Layout Identifier",
						404,
						"INVALID_LAYOUT_KEY",
						ctx.params.layoutid
					);
				}
			}
		},

		//Get theme styling
		theme: {
			rest: {
				method: "GET",
				fullPath: "/api/theme/:themeid"
			},
			async handler(ctx) {
				const themeId =
						ctx.meta.user?.theme ||
						ctx.params.themeid ||
						ctx.meta.cookies?.theme ||
						"default";

				let themeData = themeCache[themeId];
				if(CONFIG.disable_cache.application) themeData = null;

				if (!themeData) {
					themeData = await loadTheme(themeId);
					if (!themeData) {
						throw new LogiksError(
							"Invalid Theme Identifier",
							404,
							"INVALID_THEME_KEY",
							themeId
						);
					}
				}
				
				const clientVersion = ctx.params.v || ctx.meta.query?.v;

				if (clientVersion && clientVersion === themeData.version) {
					ctx.meta.$statusCode = 304; // Not Modified
					return;
				}

				ctx.meta.$responseHeaders = {
					"Content-Type": "text/css",
					"Cache-Control": "public, max-age=31536000", // 1 year
					"ETag": themeData.version
				};

				return themeData.css;
			}
		},

		//Get media for theme file
		media: {
			rest: {
				method: "GET",
				fullPath: "/api/theme/:themeid/media/:filename"
			},
			async handler(ctx) {
				const { themeid, filename } = ctx.params;

				// Prevent directory traversal attack
				const safePath = path.normalize(filename).replace(/^(\.\.(\/|\\|$))+/, "");

				const filePath = path.resolve(`misc/themes/${themeid}/media/${safePath}`);
				
				if (!fs.existsSync(filePath)) {
					throw new LogiksError(
						"File not found",
						404,
						"MEDIA_NOT_FOUND"
					);
				}

				// Auto-detect content type
				const contentType = mime.lookup(filePath) || "application/octet-stream";

				// Required Moleculer settings for streaming
				ctx.meta.$responseType = "stream";
				ctx.meta.$responseHeaders = {
					"Content-Type": contentType,
					"Cache-Control": "public, max-age=86400" // 1 day
				};
				// ctx.meta.$responseHeaders["Content-Disposition"] = `attachment; filename="${filename}"`;

				// Return readable stream (memory safe)
				return fs.createReadStream(filePath);
			}
		},

		//Get menu and navigation for application
		navigator: {
			rest: {
				method: "GET",
				// fullPath: "/api/navigator/:navid?/:deviceType?"
				fullPath: "/api/navigator{/:navid}{/:deviceType}"
			},
			async handler(ctx) {
				const appInfo = ctx.meta.appInfo;
				const userInfo = ctx.meta.user;
				const appID = appInfo.appid;
				//deviceType
 
				var menuObj = await NAVIGATOR.getNavigation(appID, ctx.params.navid, ctx.params.deviceType, userInfo, {}, ctx);

				if(!menuObj) menuObj = [];

				return menuObj;
			}
		},

		page: {
			rest: {
				method: "GET",
				fullPath: "/api/page/:pageid"
			},
			async handler(ctx) {
				if(CONFIG.disable_cache.application) ctx.params.recache = true;

				const appInfo = ctx.meta.appInfo;
				const userInfo = ctx.meta.user;
				const pageID = ctx.params.pageid;

				if(!ctx.params.pageid || ctx.params.pageid.length<=0) {
					throw new LogiksError(
						"Invalid Page Identifier",
						404,
						"INVALID_PAGE_KEY",
						ctx.params.pageid
					);
				}

				const pageFile = `misc/apps/${ctx.meta.appInfo.appid}/pages/${ctx.params.pageid}.json`;

				if(ctx.params.recache===true) {
					if(pageCache[pageFile]) delete pageCache[pageFile];
				}

				if(pageCache[pageFile]) return pageCache[pageFile].data;

				if(fs.existsSync(pageFile)) {
					const pageFileData = JSON.parse(fs.readFileSync(pageFile, "utf8"));

					pageCache[pageFile] = {
							data: pageFileData,
							version: Date.now(),
							updatedAt: Date.now()
						};

					return pageFileData;
				} else {
					throw new LogiksError(
						"Page Not Found",
						404,
						"INVALID_PAGE_KEY",
						ctx.params.pageid
					);
				}
			}
		},

		component: {
			rest: {
				method: "GET",
				fullPath: "/api/component/:compid"
			},
			async handler(ctx) {
				if(CONFIG.disable_cache.application) ctx.params.recache = true;
				
				const appInfo = ctx.meta.appInfo;
				const userInfo = ctx.meta.user;

				const filePath = `misc/apps/${ctx.meta.appInfo.appid}/components/${ctx.params.compid}`;

				if(fs.existsSync(filePath)) {
					const contentType = mime.lookup(filePath) || "application/octet-stream";

					// Required Moleculer settings for streaming
					ctx.meta.$responseType = "stream";
					ctx.meta.$responseHeaders = {
						"Content-Type": contentType,
						"Cache-Control": "public, max-age=86400" // 1 day
					};
					// ctx.meta.$responseHeaders["Content-Disposition"] = `attachment; filename="${filename}"`;

					// Return readable stream (memory safe)
					return fs.createReadStream(filePath);
				} else {
					throw new LogiksError(
						"Invalid Component Identifier",
						404,
						"INVALID_COMPONENT_KEY",
						ctx.params.compid
					);
				}
			}
		},

		template: {
			rest: {
				method: "GET",
				fullPath: "/api/template/:templatecode"
			},
			async handler(ctx) {
				const templateCode = ctx.params.templatecode;
				const data = ctx.params.data || {};

				const templateContent = await TEMPLATES.loadTemplate(templateCode, data, ctx);

				return {
					template: templateContent.content,
					subject: templateContent.subject
				};
			}
		},

		appVers: {
			rest: {
				method: "GET",
				fullPath: "/api/appvers"
			},
			params: {
				packageid: "string"
			},
			async handler(ctx) {
				var appInfo = await APPLICATION.getAppInfo(ctx.meta.appInfo.appid);
				
				return {
					"appid": ctx.meta.appInfo.appid,
					"vers": (appInfo.env=="dev" || appInfo.env=="development")?_DB.db_nowunix():appInfo.vers,
					"env": appInfo.env
				}
			}
		}
    },
    methods: {

    }
}

async function loadTheme(themeId) {
	const themeFile = path.resolve(`misc/themes/${themeId}/style.css`);

	try {
		const [css, stats] = await Promise.all([
			fs.readFileSync(themeFile, "utf8"),
			fs.statSync(themeFile)
		]);
		const version = stats.mtimeMs.toString();
		
		themeCache[themeId] = {
			css,
			version,
			updatedAt: Date.now()
		};

		return themeCache[themeId];
	} catch (err) {
		console.log(err);
		return null;
	}
}