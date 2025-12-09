"use strict";

const mime = require("mime-types");

const themeCache = _CACHE.getCacheMap("THEMECACHE");
const settingsCache = _CACHE.getCacheMap("SETTINGSCACHE");
const pageCache = _CACHE.getCacheMap("APPLICATION_PAGECACHE");
const componentCache = _CACHE.getCacheMap("APPLICATION_COMPONENTCACHE");

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
						401,
						"INVALID_APPLICATION"
					);
				}

				delete applicationInfo.domain;
				delete applicationInfo.logins;

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
				if(ctx.params.recache===true) {
					if(settingsCache[ctx.meta.user.userId]) delete settingsCache[ctx.meta.user.userId];
				}

				if(settingsCache[ctx.meta.user.userId]) return settingsCache[ctx.meta.user.userId];

				var whereCond = {
					"blocked": "false",
					"guid": [["global", ctx.meta.user.tenantId], "IN"],
				};
				if(ctx.params.module && ctx.params.module!="*") {
					whereCond["module_name"] = ctx.params.module;
				}
				var data1 = await _DB.db_selectQ("appdb", "sys_settings", "module_name, setting_name, setting_value, setting_params", whereCond, {});
				var data2 = await _DB.db_selectQ("appdb", "user_settings", "module_name, setting_name, setting_value, setting_params", _.extend({
					"created_by": ctx.meta.user.userId
				}, whereCond), {});

				settingsCache[ctx.meta.user.userId] = _.extend({}, data1, data2);
				_CACHE.saveCacheMap("SETTINGSCACHE", settingsCache);

				return settingsCache[ctx.meta.user.userId]
			}
		},

        //Get Application Layout for the tenant
		layout: {
			rest: {
				method: "GET",
				fullPath: "/api/layout/:layoutid?"
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
						401,
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
				fullPath: "/api/navigator/:navid?"
			},
			async handler(ctx) {
				const appInfo = ctx.meta.appInfo;
				const userInfo = ctx.meta.user;
				const appID = appInfo.appid;

				const menuObj = await NAVIGATOR.getNavigation(appID, ctx.params.navid, userInfo);

				if(!menuObj) menuObj = {};

				return menuObj;
			}
		},

		page: {
			rest: {
				method: "GET",
				fullPath: "/api/page/:pageid"
			},
			async handler(ctx) {
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

				if(pageCache[pageFile]) return pageCache[pageFile].data;

				if(fs.existsSync(pageFile)) {
					const pageFileData = JSON.parse(fs.readFileSync(pageFile, "utf8"));

					pageCache[pageFile] = {
							data: pageFileData,
							version: Date.now(),
							updatedAt: Date.now()
						};
					_CACHE.saveCacheMap("PAGECACHE", pageCache);

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

		_CACHE.saveCacheMap("THEMECACHE", themeCache);

		return themeCache.get(themeId);
	} catch (err) {
		console.log(err);
		return null;
	}
}