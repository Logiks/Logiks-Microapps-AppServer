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
        var data = await db_selectQ("appdb", "lgks_apikeys", "*", whereCond, {});
        
        if(!data || data.length<=0) return false;

        // var apiKeyInfo = data[0];

        // apiKeyInfo.allowed_apps = apiKeyInfo.allowed_apps.split(",");

        return apiKeyInfo;
    }
}
