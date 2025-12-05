"use strict";

module.exports = {
	name: "query",

	actions: {
		query: {
			rest: {
				method: "POST",
				fullPath: "/api/query"
			},
            params: {
                query: "object"
            },
			async handler(ctx) {
				return [];
			}
		},
		queryid: {
			rest: {
				method: "POST",
				fullPath: "/api/query/:queryid"
			},
            params: {
                filter: "object"
            },
			async handler(ctx) {
				return [];
			}
		}
	}
};
