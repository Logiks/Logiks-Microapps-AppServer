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
                // cmd: "string"
            },
			async handler(ctx) {
                console.log("TEST_CMD", ctx.params);
                
                const a1 = "X1";//await ctx.call(ctx.params.cmd);//"DOCS.createAction"
                return {"status": "okay", "results": a1};
            }
        },
        test2: {
            rest: {
				method: "POST",
				path: "/t2"
			},
            params: {
                pluginid: "string",
                module: "string",
                file: "string"
            },
			async handler(ctx) {
                ctx.params.cmd = `${ctx.params.pluginid}.source`;
                const fileContent = await ctx.call(ctx.params.cmd, {folder: ctx.params.module, file: ctx.params.file});
                return fileContent;
            }
        }
    }
}