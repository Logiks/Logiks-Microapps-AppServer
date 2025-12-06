/*
 * Users Controller
 * 
 * */

module.exports = function(server) {

    initialize = function() {
        // console.log("\x1b[36m%s\x1b[0m","Users System Initialized");
    }

    listUsers = async function(whereCond, callback) {
        if(whereCond==null) whereCond = {};
        const userInfo = await  db_selectQ("appdb", "lgks_users", "*", whereCond, {});
        return userInfo;
    }

    getUserInfo = async function(userid, callback) {
        const userInfo = await db_selectQ("appdb", "lgks_users", "*", {
                userid: userid,
            },{});
        return userInfo;
    }

    verifyUser = async function(userid, password, callback) {
        //var final_password = md5(CONFIG.ENC_SALT+""+password);
        // console.log("verifyUser", userid, password);

        var userInfo = await db_selectQ("appdb", "lgks_users,lgks_privileges,lgks_access,lgks_users_group", 
            "lgks_users.*,lgks_privileges.name as privilege_name, lgks_access.sites as scope_sites,lgks_users_group.bank,lgks_users_group.branch,lgks_users_group.state,lgks_users_group.zone,lgks_users_group.area", {
                "userid": userid,
                "lgks_users.blocked": 'false',
                "lgks_privileges.blocked": 'false',
                "lgks_users.privilegeid=lgks_privileges.id": "RAW",
                "lgks_users.accessid=lgks_access.id": "RAW",
                "lgks_users.groupid=lgks_users_group.id": "RAW",
            },{}, function (userInfo) {
                if(!userInfo) {
                    callback(false, "Userid or Password incorrect");
                    return;
                }
                
                callback(finalUserInfo)
            });
        if(!userInfo) return false;
        
        userInfo = userInfo[0];
        var encrypted_password = sha1(md5(password));
        if(userInfo.pwd!=encrypted_password) {
            callback(false, "Userid or Password incorrect");
            return;
        }
        // console.log("userInfo-1", userInfo);
        var finalUserInfo = {
            "guid": userInfo['guid'],
            "userid": userInfo['userid'],
            "privilege": userInfo['privilege_name'],
            "priviledge": userInfo['privilege_name'],
            "role": userInfo['privilege_name'],
            "scope": userInfo['scope_sites'],
            "full_name": userInfo['name'],
            "designation": userInfo['organization_position'],
            "bank": userInfo['bank'],
            "branch": userInfo['branch'],
            "state": userInfo['state'],
            "zone": userInfo['zone'],
            "area": userInfo['area']
        };
        return userInfo;
    }

    getUserInfoById = async function(userid, callback) {
        var userInfo = await db_selectQ("appdb", "lgks_users,lgks_privileges,lgks_access,lgks_users_group", 
            "lgks_users.*,lgks_privileges.name as privilege_name, lgks_access.sites as scope_sites,lgks_users_group.bank,lgks_users_group.branch,lgks_users_group.state,lgks_users_group.zone,lgks_users_group.area", {
                "userid": userid,
                "lgks_users.blocked": 'false',
                "lgks_privileges.blocked": 'false',
                "lgks_users.privilegeid=lgks_privileges.id": "RAW",
                "lgks_users.accessid=lgks_access.id": "RAW",
                "lgks_users.groupid=lgks_users_group.id": "RAW",
            },{});
        
        if(!userInfo) return false;

        userInfo = userInfo[0];
        // console.log("userInfo-1", userInfo);
        var finalUserInfo = {
            "guid": userInfo['guid'],
            "userid": userInfo['userid'],
            "privilege": userInfo['privilege_name'],
            "priviledge": userInfo['privilege_name'],
            "role": userInfo['privilege_name'],
            "scope": userInfo['scope_sites'],
            "full_name": userInfo['name'],
            "designation": userInfo['organization_position'],
            "bank": userInfo['bank'],
            "branch": userInfo['branch'],
            "state": userInfo['state'],
            "zone": userInfo['zone'],
            "area": userInfo['area']
        };

        return userInfo;
    }


    return this;
}