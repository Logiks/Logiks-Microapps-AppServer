"use strict";

const { Errors } = require("moleculer");
const { MoleculerClientError } = Errors;

module.exports = {
    name: "tenant",

    actions: {
        /**
         * Tenant-only endpoint (requires admin role).
         * GET /api/tenant
         */
        fetch: {
            rest: {
                method: "GET",
                path: "/fetch"
            },
            // could add scopes too if you want additional control
            async handler(ctx) {
                console.log("XXXX", ctx.meta);


                return [];
            }
        }
    }
};
