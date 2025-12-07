"use strict";

module.exports = {
	name: "test",

	actions: {
		test1: {
            rest: {
				method: "POST",
				path: "/"
			},
            params: {
                cmd: "string"
            },
			async handler(ctx) {
                const a1 = await ctx.call(ctx.params.cmd);//"DOCS.createAction"
                return {"status": "okay", "results": a1};cm
            }
        }
    }
}