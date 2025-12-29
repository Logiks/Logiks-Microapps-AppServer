/*
 * AUTHKEY Controller
 * 
 * */

module.exports = {

    initialize : function() {

    },

    getAPIKeyInfo : async function(apiKey, key_type) {
        var whereCond = {
            "blocked": "false",
            "auth_key": apiKey,
            // "key_type": key_type || "user" //api, s2s, user
        };
        whereCond[`FIND_IN_SET('${key_type}', key_type)`] = "RAW";

        var data = await _DB.db_selectQ("appdb", "lgks_apikeys", "*", whereCond, {});
        
        if(!data || !data.results || data.results.length<=0) return false;

        var apiKeyInfo = data.results[0];

        //MAP with a user if possible
        // if(apiKeyInfo.user_id && apiKeyInfo.user_id!="") {
        //     var userData = await _DB.db_selectQ("appdb", "lgks_users", "*", {"userId": apiKeyInfo.user_id, "blocked": "false"}, {});
        //     if(userData && userData.results && userData.results.length>0) {
        //         apiKeyInfo.userInfo = userData.results[0];
        //     }
        // }
        apiKeyInfo.userId = apiKeyInfo.for_user || apiKeyInfo.guid;
        // var userData = await _DB.db_selectQ("appdb", "lgks_users", "*", {"userId": userId, "blocked": "false"}, {});

        try {
            apiKeyInfo.roles = JSON.parse(apiKeyInfo.roles);
        } catch(e) {
            apiKeyInfo.roles = ["*"];
        }
        try {
            apiKeyInfo.scopes = JSON.parse(apiKeyInfo.scopes);
        } catch(e) {
            apiKeyInfo.scopes = ["*"];// ? apiInfo.scope.split(",") : ["*"], ["tenant:*"]
        }
        

        return apiKeyInfo;
    },

    checkClientIP: async function(clientIP, appId, onlyFailIfWhitelisted = true) {
        var whereCond = {
            "blocked": "false",
            "ipaddress": clientIP,
            "site": [[appId, "*"], "IN"],
            // "guid": [["global"], "IN"]
        };
        var data = await _DB.db_selectQ("appdb", "lgks_security_iplist", "*", whereCond, {});
        
        if(!data || !data.results || data.results.length<=0) {
            if(onlyFailIfWhitelisted) return true;
            return false;
        }

        var ipInfo = data.results[0];
        if(ipInfo.allow_type=="blacklist") return false;
        
        return true;
    }
}
