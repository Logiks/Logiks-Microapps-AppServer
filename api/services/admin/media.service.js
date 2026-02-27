//Local Media Folder under public folder

module.exports = {
	name: "admin.media",

	actions: {
        listMedia: {
			rest: {
				method: "POST",
				path: "/"
			},
			params: {
				path: "string",
			},
			// could add scopes too if you want additional control
			async handler(ctx) {
				return [];
			}
		},

        previewMedia: {
			rest: {
				method: "GET",
				path: "/preview"
			},
			params: {
				path: "string",
			},
			// could add scopes too if you want additional control
			async handler(ctx) {
				return [];
			}
		},

        uploadMedia: {
			rest: {
				method: "POST",
				path: "/upload"
			},
			params: {
				path: "string",
			},
			// could add scopes too if you want additional control
			async handler(ctx) {
				return [];
			}
		},

        deleteMedia: {
			rest: {
				method: "POST",
				path: "/delete"
			},
			params: {
				path: "string",
			},
			// could add scopes too if you want additional control
			async handler(ctx) {
				return [];
			}
		},
    }
}