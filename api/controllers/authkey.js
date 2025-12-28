/*
 * AUTHKEY Controller
 * 
 * */

module.exports = {

    initialize : function() {

    },

    getAPIKeyInfo : async function(apiKey, callback) {
        var whereCond = {
            "blocked": "false",
            "auth_key": apiKey
        };
        var data = await _DB.db_selectQ("appdb", "lgks_apikeys", "*", whereCond, {});
        
        if(!data || !data.results || data.results.length<=0) return false;

        var apiKeyInfo = data.results[0];

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
