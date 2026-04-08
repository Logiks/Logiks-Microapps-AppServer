/*
 * Auth/Login Related Controller
 * */

module.exports = {

    initialize: function() {
        
    },

    doFederatedLogin: async function(uniqueId, ctx) {
        // console.log("FEDERATED_LOGIN", { "params": ctx.params, "headers": ctx.headers });
        // console.log("ctx.meta.appInfo", ctx.meta.appInfo);
        try {
            const userData = AUTHFEDERATED.processFederatedLoginResponse(ctx.meta.appInfo.appid, uniqueId, ctx);

            const allowFederatedRegistration = ctx.meta.appInfo?.settings?.allow_federated_registration || false;
            if(allowFederatedRegistration) {
                const userInfo1 = await USERS.findOrCreateFederatedUser(userData, ctx.params.source);
                if(!userInfo1) {
                    return {
                        "status": "error",
                        "message": "Error in creating/finding federated user, contact admin"
                    }
                }
                const userInfo = await USERS.getUserInfo(userInfo1.userid, {'lgks_users.guid': userInfo1.guid}, true);
                return {
                    "status": "success",
                    "user": userInfo
                }
            } else {
                const guid = await TENANT.resolveSSOTenant(userData.tenantid, ctx.params.source);
                const userInfo = await USERS.getUserInfo(userData.userid, {'lgks_users.guid': guid}, true)
                if(!userInfo) {
                    return {
                        "status": "error",
                        "message": "Error in creating/finding federated user, contact admin"
                    }
                }
                
                return {
                    "status": "success",
                    "user": userInfo
                }
            }
        } catch(e) {
            console.error("Error in federated login", e);
            return {
                "status": "error",
                "message": "Error in federated login: " + e.message
            }
        }
    }
}