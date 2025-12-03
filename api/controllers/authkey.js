/*
 * AUTHKEY Controller
 * 
 * */

module.exports = function(server) {

    initialize = function() {

    }

    fetchAuthInfo = function(authKey) {
        return new Promise((resolve, reject) => {
            db_selectQ("MYSQL0", "auth_apikeys", "*", {
                "auth_key": authKey,
                "blocked": "false"
            }, {}, function (authInfo) {
                if(authInfo) {
                    resolve(authInfo[0]);
                } else {
                    reject(false);
                }
            });
        });
    }

    return this;
}
