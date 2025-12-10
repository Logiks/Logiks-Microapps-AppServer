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
		}
	}
};
