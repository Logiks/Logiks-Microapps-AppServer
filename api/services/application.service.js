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
				const serverHost = ctx.meta.serverHost;
				const applicationInfo = await BASEAPP.getAppInfo(serverHost);
				if(!applicationInfo) {
					throw new Errors.MoleculerClientError(
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
					throw new Errors.MoleculerClientError(
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
				fullPath: "/api/theme/:themeid?"
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
						throw new Errors.MoleculerClientError(
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
				fullPath: "/api/theme/:themeid?/:filename"
			},
			async handler(ctx) {
				const { themeid, filename } = ctx.params;

				// Prevent directory traversal attack
				const safePath = path.normalize(filename).replace(/^(\.\.(\/|\\|$))+/, "");

				const filePath = path.resolve(`misc/themes/${themeid}/media/${safePath}`);
				
				if (!fs.existsSync(filePath)) {
					throw new Errors.MoleculerClientError(
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

		//Get media for theme file
		navigator: {
			rest: {
				method: "GET",
				fullPath: "/api/navigator/:navid?"
			},
			async handler(ctx) {


				return {};
			}
		},

		//Get menu and navigation for application
		navigator: {
			rest: {
				method: "GET",
				fullPath: "/api/navigator/:navid?"
			},
			async handler(ctx) {


				return {};
			}
		},

		component: {
			rest: {
				method: "GET",
				fullPath: "/api/component/:compid"
			},
			async handler(ctx) {

				return {};
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