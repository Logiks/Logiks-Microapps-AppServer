/*
 * Users Controller
 * 
 * */

const { TOTP } = require("totp-generator");
const { diff } = require("deep-diff");

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

    findOrCreateFederatedUser: async function(federatedData, federatedSource) {
        const guid = await TENANT.resolveSSOTenant(federatedData.tenantid, federatedSource);
        
        return USERS.getUserInfo(federatedData.userid, {guid: guid}).then(async (userInfo)=>{
            if(userInfo) {
                //User Exists, just return the info
                //updateData.last_updated

                const userInfoFiltered = Object.keys(federatedData).reduce((acc, key) => {
                        if (key in userInfo) acc[key] = userInfo[key];
                        return acc;
                    }, {});
                const differences = diff(userInfoFiltered, federatedData);
                console.log("FEDERATED_USER_DIFFERENCES", differences);
                
                // await _DB.db_updateQ("appdb", "lgks_users", updateData, {
                //     userid: userInfo.userid,
                //     guid: userInfo.guid,
                // });

                return userInfo;
            } else {
                //Create New User
                var newUserData = {
                    "guid": guid,
                    "userid": federatedData.userid,
                    "pwd": "",
                    "name": federatedData.displayname || federatedData.userid,
                    "email": federatedData.email || "",
                    "mobile": federatedData.mobile || "",
                    "privilegeid": federatedData.privilegeid || 10, //Default to normal user
                    "accessid": federatedData.accessid || 1, //Default to normal access
                    "groupid": federatedData.groupid || 1,
                    "roles": federatedData.roles ? federatedData.roles.join(",") : "",
                    
                    "reporting_to": federatedData.reporting_to || "",
                    "hr_manager": federatedData.hr_manager || "",
                    "dob": federatedData.dob || "0000-00-00",
                    "gender": federatedData.gender || "male",

                    "department": federatedData.department || "-",
                    "designation": federatedData.designation || "-",
                    "office": federatedData.office || "",
                    "company": federatedData.company || guid || "",

                    "address": federatedData.address || "",
                    "region": federatedData.region || "",
                    "country": federatedData.country || "IN",
                    "zipcode": federatedData.zipcode || "",
                    
                    "avatar_type": federatedData.avatar_type || "gravatar",
                    "avatar": federatedData.email || "",

                    "remarks": "",
                    "vcode": "",//Verification code for email or mobile verification
                    "mauth": "",
                    "refid": "",//Used during registration or for linking accounts

                    "expires": moment().add(6, 'months').format("YYYY-MM-DD HH:mm:ss"),

                    "tags": "federated,azuread_user",
                    "privacy": "protected",
                    "security_policy": "closed",

                    "blocked": "false",
                    "created_on": moment().format("Y-M-D HH:mm:ss"),
                    "created_by": "system",
                    "edited_on": moment().format("Y-M-D HH:mm:ss"),
                    "edited_by": "system",
                };

                var insertResult = await _DB.db_insertQ1("appdb", "lgks_users", newUserData);
                if(insertResult && insertResult.insertId) {
                    return USERS.getUserInfo(federatedData.userid, {guid: guid});
                } else {
                    return false;
                }
            }
        });
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
                "lgks_privileges.name as privilege_name, lgks_access.name as access_name, lgks_access.sites as scope_sites, lgks_users_group.*, lgks_users.*, lgks_users.userid as userId, lgks_users.edited_on as last_updated",
                where, {});
            if(!userInfo || !userInfo?.results || userInfo.results.length<=0) return false;

            userInfo = userInfo.results[0];

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
            var userInfo = await _DB.db_selectQ("appdb", "lgks_users", "*, edited_on as last_updated", where,{});
            if(!userInfo || !userInfo?.results || userInfo.results.length<=0) return false;

            userInfo = userInfo.results[0];
            delete userInfo.pwd;
            delete userInfo.pwd_salt;

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
        var encrypted_password = await ENCRYPTER.generateHash(password);
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
            var userInfo = await _CACHE.fetchDataSync(`user:${ctx?.meta?.sessionId}`);
            try {
                return JSON.parse(userInfo);
            } catch(e) {
                return false;
            }
        }
    },

    hasMFA: async function(guid, userid) {
        //mfa_type,mfa_code,mfa_expires,mfa_xtras_1,mfa_xtras_2,mfa_xtras_3
        var mfaInfo = await _DB.db_selectQ("appdb", "lgks_mfa", "*", {
            "guid": [["global", guid], "IN"],
            "userid": userid,
            "blocked": 'false',
        }, {});
        if(!mfaInfo || !mfaInfo?.results || mfaInfo.results.length<=0) return false;
        
        mfaInfo = mfaInfo.results[0];
        return mfaInfo;
    },

    generateMFASecret: function(guid, userid, mfaType = false) {
        _DB.db_insertQ1("appdb", "lgks_mfa", {
            "guid": guid,
            "userid": userid,
            "mfa_type": mfaType || CONFIG.mfa.mfa_default_type || "totp",
            "mfa_code": TOTP.generateSecret(), //You can also use any random string generator or OTP generator library
            "mfa_expires": moment().add(1, 'year').format("Y-M-D HH:mm:ss"),
            "mfa_xtras_1": "email", //mfa_xtras_1 can be used to store the preferred delivery method like email, sms, whatsapp etc.
            "mfa_xtras_2": "", //mfa_xtras_2 can be used to store the destination address like email id or mobile number
            "mfa_xtras_3": "",
            "created_on": moment().format("Y-M-D HH:mm:ss"),
            "created_by": userid,
            "edited_on": moment().format("Y-M-D HH:mm:ss"),
            "edited_by": userid,
        });
    },

    generateTOTPCode: async function(guid, userid, userInfo, remoteIP, deviceType, geolocation) {
        const mfainfo = await USERS.hasMFA(guid, userid);
        if(!mfainfo) return false;
        
        const otpIdentifier = MISC.generateUUID("",4);
        const otpKey = `otp:${otpIdentifier}`;

        switch(mfainfo.mfa_type) {
            case "totp":
                var expires_in = 60; // Store OTP in cache with 5 minutes TTL
                var mfa_expires = moment().add(expires_in, 'seconds').format("Y-M-D HH:mm:ss");
                const mfa_code = mfainfo.mfa_code; //This is the secret key stored in the database for the user, eg. "JBSWY3DPEHPK3PXP"
                const newOTP = await TOTP.generate(mfa_code, {
                        digits: CONFIG.mfa.mfa_length || 6,
                        algorithm: "SHA-512",
                        period: expires_in,
                        timestamp: moment().unix(),
                    })
                var otpCode = newOTP.otp;//newOTP.expires
                // console.log(`Generated OTP: ${otp}`);
                // console.log(`Expires at: ${new Date(expires * 1000)}`);
                _CACHE.storeDataEx(otpKey, { otp: otpCode, deviceType, user: userInfo, remoteIP, mfainfo }, expires_in); // Store OTP in cache with expires_in seconds TTL

                return {"identifier": otpIdentifier, "expires": mfa_expires};
            break;

            case "otp":
                var expires_in = 300; // Store OTP in cache with 5 minutes TTL
                var mfa_expires = moment().add(expires_in, 'seconds').format("Y-M-D HH:mm:ss");
                var otpCode = MISC.generateUUID("",CONFIG.mfa.mfa_length);//(Math.floor(100000 + Math.random() * 900000)).toString();
                _CACHE.storeDataEx(otpKey, { otp: otpCode, deviceType, user: userInfo, remoteIP, mfainfo }, expires_in); // Store OTP in cache with expires_in seconds TTL

                //mfa_xtras_1 can be used to store the preferred delivery method like email, sms, whatsapp etc.
                //mfa_xtras_2 can be used to store the destination address like email id or mobile number
                //mfa_xtras_3 can be used to store any additional info if needed
                switch(mfainfo.mfa_xtras_1) {
                    case "sms":
                        //send sms with otpCode to userInfo.mobile
                    break;

                    case "whatsapp":
                        //send whatsapp message with otpCode to userInfo.mobile
                    break;

                    case "email":
                        //send email with otpCode to userInfo.email
                    default:
                        //Default to email
                }
                return {"identifier": otpIdentifier, "expires": mfa_expires};
            break;

            default:
                return false;
        }
    },

    valiateOTPCode: async function(otpIdentifier, otpCode) {
        const otpKey = `otp:${otpIdentifier}`;
        const otpData = _CACHE.fetchDataSync(otpKey);
        // _CACHE.deleteKey(otpKey);

        if(!otpData) return false;

        const otpStored = otpData.otp;
        const deviceType = otpData.deviceType;
        const remoteIP = otpData.remoteIP;
        const user = otpData.user;
        const mfainfo = otpData.mfainfo;

        if(!mfainfo) return false;

        switch(mfainfo.mfa_type) {
            case "totp":
                // const totp = new OTPAuth.TOTP({
                //     issuer: "MyApp",
                //     label: userid,
                //     secret: OTPAuth.Secret.fromBase32(mfainfo.mfa_code),
                //     algorithm: 'SHA1',
                //     digits: 6,
                //     period: 30,
                // });
                // return totp.validate({token: code, window: 1}); //Allowing 1 step window for clock skew
            break;

            case "hotp":
                //Implement HOTP validation logic here
            break;

            case "otp":
                return otpStored == otpCode;
            break;

            default:
                return false;
        }
    }
}
