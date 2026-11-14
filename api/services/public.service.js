"use strict";

module.exports = {
	name: "public",

	settings: {
        __file: __filename
    },

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
				"fileUri": "string"
			},
			async handler(ctx) {
				const fileResponse = await FILES.getFilePublished(ctx.params.fileUri,  "stream");
				if(fileResponse && fileResponse.stream) {
					const fileName = String(fileResponse.filename || "file").split("_").splice(1).join("_") || "file";
					const served = UPLOADS.serveHeaders(fileName);
					ctx.meta.$responseHeaders = served.headers;
					ctx.meta.$responseType = served.contentType;

					return fileResponse.stream;
				} else
					throw new LogiksError("File not found", 404, "FILE_NOT_FOUND");
			}
		}
	}
};
