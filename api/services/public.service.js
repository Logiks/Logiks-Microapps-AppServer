"use strict";

module.exports = {
	name: "public",

	actions: {
		ping: {
			rest: {
				method: "GET",
				path: "/ping"
			},
			handler() {
				return {
					status: "ok",
					timestamp: Date.now()
				};
			}
		}
	}
};
