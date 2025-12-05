"use strict";

module.exports = {
	name: "data",

	actions: {
		listGroups: {
			rest: {
				method: "GET",
				path: "/"
			},
			async handler(ctx) {
				return [];
			}
		},
		fetchFiltered: {
			rest: {
				method: "POST",
				fullPath: "/api/data/fetch"
			},
            params: {
                groupid: "string",
                filter: "object"
            },
			async handler(ctx) {
				return [];
			}
		},
		fetch: {
			rest: {
				method: "GET",
				fullPath: "/api/data/:groupid"
			},
			async handler(ctx) {
				return [];
			}
		}
	}
};
