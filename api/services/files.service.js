"use strict";

module.exports = {
    name: "files",

    actions: {
        
        files: {
			rest: {
				method: "POST",
				path: "/"
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
				path: "/preview"
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
				path: "/upload"
			},
			params: {
				file: "string",
				content: "string"
			},
			// could add scopes too if you want additional control
			async handler(ctx) {
				return {};
			}
		}
    }
};
