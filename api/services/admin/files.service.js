//All Admin Related File Functionalities


"use strict";

const os = require("os");

module.exports = {
	name: "admin.files",

	actions: {
        //Manage apps files
		files: {
			rest: {
				method: "POST",
				path: "/"
			},
			params: {
				path: "string",
				appid: "string",
			},
			// could add scopes too if you want additional control
			async handler(ctx) {
				return [];
			}
		},

		filesPreview: {
			rest: {
				method: "POST",
				path: "/content"
			},
			params: {
				file: "string",
				appid: "string",
			},
			// could add scopes too if you want additional control
			async handler(ctx) {
				return "";
			}
		},

		filesUpload: {
			rest: {
				method: "POST",
				path: "/upload"
			},
			params: {
				file: "string",
				content: "string",
				appid: "string",
			},
			// could add scopes too if you want additional control
			async handler(ctx) {
				return {};
			}
		},
    },

    methods: {
    }
}