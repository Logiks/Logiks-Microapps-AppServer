"use strict";

const mime = require("mime-types");

const themeCache = new Map();

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
				module: "string"
			},
			async handler(ctx) {
				var whereCond = {
					"blocked": "false",
					"guid": [["global", ctx.meta.user.guid], "IN"],
				};
				if(ctx.params.module && ctx.params.module!="*") {
					whereCond["module_name"] = ctx.params.module;
				}
				var data1 = await db_selectQ("appdb", "sys_settings", "module_name, setting_name, setting_value, setting_params", whereCond, {});
				var data2 = await db_selectQ("appdb", "user_settings", "module_name, setting_name, setting_value, setting_params", whereCond, {});

				return _.extend({}, data1, data2);
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

				let themeData = themeCache.get(themeId);

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

				const appMenuDir = `misc/apps/${appID}/menus/${ctx.params.navid}/`;
				if(fs.existsSync(appMenuDir)) {
					const menuObj = await loadAllJsonFromFolder(appMenuDir);
					
					return menuObj.filter(a=> {
						if(a.privilege) {
							a.privilege = a.privilege.split(",");
							// console.log(a.title, a.privilege);
							if(!(a.privilege.indexOf("*")>=0 || a.privilege.indexOf(userInfo.privilege)>=0 || a.privilege.indexOf(userInfo.userId)>=0)) {
								return false;
							}
						}
						if(!(a.guid && (a.guid=="*" || a.guid=="global" || a.guid==userInfo.guid))) {
							return false;
						}
						return true;
					});
				} else {
					return {};
				}
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
				if(fs.existsSync(pageFile)) {
					const pageFileData = JSON.parse(fs.readFileSync(pageFile, "utf8"));
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

				const compFiles = [
					`misc/apps/${ctx.meta.appInfo.appid}/components/${ctx.params.compid}.jsx`,
					`misc/apps/${ctx.meta.appInfo.appid}/components/${ctx.params.compid}.html`,
					`misc/apps/${ctx.meta.appInfo.appid}/components/${ctx.params.compid}.htmlx`,

					`misc/apps/${ctx.meta.appInfo.appid}/components/${ctx.params.compid}`,
					`misc/apps/${ctx.meta.appInfo.appid}/components/${ctx.params.compid}`,
					`misc/apps/${ctx.meta.appInfo.appid}/components/${ctx.params.compid}`
				];

				var i = 0;
				for(i=0; i<compFiles.length; i++) {
					if(fs.existsSync(compFiles[i])) {
						const filePath = compFiles[i];

						// console.log("fileName", i, filePath);

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
						break;
					}
				}
				

				throw new LogiksError(
					"Invalid Component Identifier",
					404,
					"INVALID_COMPONENT_KEY",
					ctx.params.compid
				);
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
		
		themeCache.set(themeId, {
			css,
			version,
			updatedAt: Date.now()
		});

		return themeCache.get(themeId);
	} catch (err) {
		console.log(err);
		return null;
	}
}

async function loadAllJsonFromFolder(folderPath) {
  const files = await fs.readdirSync(folderPath);

  const jsonFiles = files.filter(f => f.endsWith(".json"));

  const jobs = jsonFiles.map(async file => {
    const fullPath = path.join(folderPath, file);
    try {
      const data = await fs.readFileSync(fullPath, "utf8");
      return JSON.parse(data);
    } catch (e) {
      console.error(`❌ ${file} ignored: ${e.message}`);
      return null;
    }
  });

  const results = await Promise.all(jobs);

  return results.filter(Boolean); // remove failed reads
}