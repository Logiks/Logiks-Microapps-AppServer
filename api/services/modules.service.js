"use strict";

module.exports = {
	name: "modules",

	actions: {
		listModules: {
			rest: {
				method: "GET",
				path: "/"
			},
			async handler(ctx) {
				return [];
			}
		}
	}
};
