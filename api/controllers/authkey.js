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
    }
}
