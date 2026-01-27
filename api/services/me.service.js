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