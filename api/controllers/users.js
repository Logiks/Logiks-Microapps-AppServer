/*
 * Users Controller
 * 
 * */

module.exports = {

    initialize: function() {
        // console.log("\x1b[36m%s\x1b[0m","Users System Initialized");
        return true; //Public Controller
    },

    listUsers: async function(whereCond, callback) {
        if(whereCond==null) whereCond = {};
        const userInfo = await  _DB.db_selectQ("appdb", "lgks_users", "*", whereCond, {});
        return userInfo?.results;
    },

    getUserInfo: async function(userid, where = {}, more = false, callback) {
        if(!where) where = {};
        where.userid = userid;

        if(more===true) {
            // where["lgks_users.blocked"] = "RAW";
            // where["lgks_privileges.blocked"] = "RAW";
            where["lgks_users.privilegeid=lgks_privileges.id"] = "RAW";
            where["lgks_users.accessid=lgks_access.id"] = "RAW";
            
            var userInfo = await _DB.db_selectQ("appdb", 
                "lgks_users JOIN lgks_privileges ON lgks_privileges.id = lgks_users.privilegeid JOIN lgks_access ON lgks_access.id = lgks_users.accessid LEFT JOIN lgks_users_group ON lgks_users_group.id = lgks_users.groupid", 
                "lgks_users.*,lgks_privileges.name as privilege_name, lgks_access.name as access_name, lgks_access.sites as scope_sites, lgks_users_group.*", 
                where, {});
            if(!userInfo || !userInfo?.results || userInfo.results.length<=0) return false;

            userInfo = userInfo.results[0];
            delete userInfo.pwd;

            return userInfo;
        } else {
            var userInfo = await _DB.db_selectQ("appdb", "lgks_users", "*", where,{});
            if(!userInfo || !userInfo?.results || userInfo.results.length<=0) return false;

            userInfo = userInfo.results[0];
            delete userInfo.pwd;

            return userInfo;
        }
    },

    verifyUser: async function(userid, password, appId) {
        // console.log("verifyUser", userid, password);
        // CONFIG.log_sql = true;

        var userInfo = await _DB.db_selectQ("appdb", 
            "lgks_users JOIN lgks_privileges ON lgks_privileges.id = lgks_users.privilegeid JOIN lgks_access ON lgks_access.id = lgks_users.accessid LEFT JOIN lgks_users_group ON lgks_users_group.id = lgks_users.groupid", 
            //"lgks_users,lgks_privileges,lgks_access LEFT JOIN lgks_users_group ON lgks_users_group.id = lgks_users.groupid", 
            "lgks_privileges.name as privilege_name, lgks_access.name as access_name, lgks_access.sites as scope_sites, lgks_users_group.*, lgks_users.*, lgks_users.userid as userId", {
                "userid": userid,
                "lgks_users.blocked": 'false',
                "lgks_privileges.blocked": 'false',
                "(lgks_access.sites='*' OR FIND_IN_SET(?, lgks_access.sites))": "RAW",
            },{appId});
        if(!userInfo || !userInfo?.results || userInfo.results.length<=0) return false;
        
        userInfo = userInfo.results[0];
        // console.log("userInfo-1", userInfo);

        //Assuming hashed password from the frontend
        // var encrypted_password = ENCRYPTER.generateHash();
        const isValid = await ENCRYPTER.compareHash(password, userInfo.pwd);
        if(isValid) {
            try {
                if(userInfo.roles.substr(0,1)=="{") userInfo.roles = JSON.parse(userInfo.roles);
                else {
                    userInfo.roles = userInfo.roles.split(",");
                }

                const userRoles = await _DB.db_selectQ("appdb", "lgks_roles", "*", {
                    "blocked": "false",
                    "guid": [["global", userInfo.guid], "IN"],
                    "id": [userInfo.roles, "IN"]
                }, {});
                if(!userRoles.results) userRoles.results = [];

                userInfo.roles_list = userRoles.results.map(a=>a.name);
            } catch(e) {
                userInfo.roles = [];
                userInfo.roles_list = [];
            }

            try {
                const userScopes = await _DB.db_selectQ("appdb", "lgks_scopes", "*", {
                    "blocked": "false",
                    "guid": [["global", userInfo.guid], "IN"],
                    "id": userInfo.userid
                }, {});
                if(!userScopes.results) userScopes.results = [];
                
                userInfo.scopes = [];

                _.each(userScopes.results, function(row, k) {
                    userInfo.scopes = _.extend(userInfo.scopes, JSON.parse(row.scopes));
                })
            } catch(e) {
                userInfo.scopes = [];
            }

            delete userInfo.pwd;
            delete userInfo.pwd_salt;
            
            return userInfo;
        } else {
            return false;
        }
    },

    //Assuming hashed password from the frontend, so password = sha1 of user's actual password
    updateUserPassword: async function(guid, userid, password) {
        var encrypted_password = ENCRYPTER.generateHash(password);
        var dated = moment().format("Y-M-D HH:mm:ss");

        var updateData = {
            "edited_on": dated,
            "edited_by": "admin"
        }

        updateData.pwd = encrypted_password;

        var result = await _DB.db_updateQ("appdb", "lgks_users", updateData, {
            "guid": guid,
            "userid": userid,
        });

        return result;
    },

    getUserAvatar: async function(avatar, avatar_type) {
        return "";
    },

    getUserData: async function(sessionId, ctx) {
        if(sessionId) {
            var userInfo = await _CACHE.fetchDataSync(`user:${sessionId}`);
            return userInfo;
        } else {
            var userInfo = await _CACHE.fetchDataSync(`user:${ctx.meta.sessionId}`);
            try {
                return JSON.parse(userInfo);
            } catch(e) {
                return false;
            }
        }
    }
}
