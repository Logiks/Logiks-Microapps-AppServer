"use strict";


module.exports = {
    name: "me",

    actions: {
        myInfo: {
			rest: {
				method: "GET",
				fullPath: "/api/me"
			},
			async handler(ctx) {
				// console.log(ctx.meta);
				return {
					"info": await ctx.call("auth.getMyInfo")
				}
			}
		},

		myScope: {
			rest: {
				method: "GET",
				fullPath: "/api/scopes"
			},
			async handler(ctx) {
				const userInfo = await USERS.getUserInfo(ctx.meta.user.userId, {
					guid: ctx.meta.user.guid,
					blocked: "false",
					// scopeid: ctx.params.scopeid || "default"
				});
				if(userInfo.scopes[ctx.params.scopeid]) return userInfo.scopes[ctx.params.scopeid];
				else return {};
			}
		},

		passwordUpdate: {
			rest: {
				method: "POST",
				fullPath: "/api/me/updatepass"
			},
			params:{
				oldPassword: "string",
				newPassword: "string",
				passwordType: { type: "string", optional: true }
			},
			async handler(ctx) {
				var response = await USERS.updateUserPassword(ctx.meta.user.guid, ctx.meta.user.userId, ctx.params.newPassword, ctx.params.oldPassword);
				return response;
			}
		},

		reloadPolicies: {
			rest: {
				method: "POST",
				fullPath: "/api/me/reloadPolicies"
			},
			async handler(ctx) {
				const response = await RBAC.reloadPolicies(ctx);
				return response;
			}
		}
		
    }
}