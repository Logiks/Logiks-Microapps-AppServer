// Admin-only endpoint (requires admin role).

"use strict";

module.exports = {
	name: "admin",

	actions: {
		//Manage apps
		apps: {
			rest: {
				method: "POST",
				path: "/apps/:task?/:appid?"
			},
			params: {},
			async handler(ctx) {
				switch(ctx.params.task) {


					default:
						return APPLICATION.getAppList();
				}
			}
		},
		
		//Manage apps files
		files: {
			rest: {
				method: "POST",
				path: "/files"
			},
			params: {
				path: "string"
			},
			// could add scopes too if you want additional control
			async handler(ctx) {
				return [];
			}
		},

		filesPreview: {
			rest: {
				method: "POST",
				path: "/files/content"
			},
			params: {
				file: "string"
			},
			// could add scopes too if you want additional control
			async handler(ctx) {
				return "";
			}
		},

		filesUpload: {
			rest: {
				method: "POST",
				path: "/files/upload"
			},
			params: {
				file: "string",
				content: "string"
			},
			// could add scopes too if you want additional control
			async handler(ctx) {
				return {};
			}
		},

		//Control Center for the Server
		//stats
		//restart
		//check_update
		//run update
		//backup
		//app module map
		
		//Manage Themes
	}
};
