"use strict";

module.exports = {
	name: "public",

	actions: {
		ping: {
			rest: {
				method: "GET",
				// path: "/ping"
				fullPath: "/api/ping"
			},
			handler() {
				return {
					status: "ok",
					timestamp: Date.now()
				};
			}
		},
		health: {
			rest: {
				method: "GET",
				fullPath: "/health"
			},
			handler() {
				return {
					status: "ok",
					health: "healthy",
					timestamp: Date.now()
				};
			}
		},
		file: {
			rest: {
				method: "GET",
				fullPath: "/api/public/files/:fileUri"
			},
			params: {
				"fileId": "string"
			},
			async handler(ctx) {
				const fileResponse = await FILES.getFilePublished(ctx.params.fileUri,  "stream");
				if(fileResponse && fileResponse.stream)
					return fileResponse.stream;
				else
					return "File not found";
			}
		}
	}
};
