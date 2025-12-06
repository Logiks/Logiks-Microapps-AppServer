"use strict";

module.exports = {
	name: "query",

	actions: {
		query: {
			rest: {
				method: "POST",
				fullPath: "/"
			},
            params: {
                query: "object"
            },
			async handler(ctx) {
				console.log(ctx.params);

				return [];
			}
		},
		queryid: {
			rest: {
				method: "POST",
				fullPath: "/:queryid"
			},
            params: {
                filter: "object"
            },
			async handler(ctx) {
				console.log(ctx.params);
				
				return [];
			}
		}
	}
};
