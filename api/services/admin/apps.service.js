//For managing applications on server

module.exports = {
	name: "admin.apps",

	actions: {
        //Manage apps
        apps: {
            rest: {
                method: "POST",
                path: "/:task?/:appid?"
            },
            params: {},
            async handler(ctx) {
                ctx.call("admin.verifyAdmin", {}, { meta: ctx.meta })
                
                switch(ctx.params.task) {
                    case "create":
                        break;
                    case "delete":
                        break;
                    case "update":
                        break;
                    case "info":
                        var appInfo = APPLICATION.getAppInfo(ctx.params.appid);

                        appInfo.appFolder = fs.existsSync(`plugins/${ctx.params.appid}`);

                        return appInfo;
                        break;
                    case "list":
                        return APPLICATION.getAppList();
                        break;
                    default:
                        return {"status": "okay", "commands": [
                            "list",
                            "create",
                            "delete",
                            "update",
                            "info"
                        ]};
                }
            }
        },
    }
}