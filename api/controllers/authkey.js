/*
 * AUTHKEY Controller
 * 
 * */

module.exports = function(server) {

    initialize = function() {

    }

    getAPIKeyInfo = async function(apiKey, callback) {
        var whereCond = {
            "blocked": "false",
            "auth_key": apiKey
        };
        var data = await new Promise((resolve, reject) => {
            db_selectQ("appdb", "lgks_apikeys", "*", whereCond, {}, function (apiKeyInfo) {
                if (apiKeyInfo) {
                    resolve(apiKeyInfo);
                } else {
                    resolve(false);
                }
            });
        })
        if(!data || data.length<=0) return false;

        // var apiKeyInfo = data[0];

        // apiKeyInfo.allowed_apps = apiKeyInfo.allowed_apps.split(",");

        return apiKeyInfo;
    }

    return this;
}
