//Environment Variables Helper

var ENVIRONMENTS = {};

module.exports = {

    initialize : function() {
        this.loadEnvironment();

        console.log("\x1b[36m%s\x1b[0m","Environment Variables Loaded");
        return true;
    },

    loadEnvironment: async function() {
        ENVIRONMENTS = {};
        var envData = await _DB.db_selectQ("appdb", "lgks_environment", "*", {
                blocked: "false"
            },{});
        if(!envData || !envData.results || envData.results.length<=0) return false;
        for(var i=0; i<envData.results.length; i++) {
            if(!ENVIRONMENTS[envData.results[i]['guid']]) ENVIRONMENTS[envData.results[i]['guid']] = {};
            ENVIRONMENTS[envData.results[i]['guid']][envData.results[i].var_code.toUpperCase()] = envData.results[i].var_value;
        }

        // console.log(ENVIRONMENTS);
    },

    registerEnvVariable : function(ctx, module, varName, varValue, varParams = {}, varNature = 'backend') {
        if(!ENVIRONMENTS[ctx?.meta?.user?.guid || "global"]) ENVIRONMENTS[ctx?.meta?.user?.guid || "global"] = {};
        ENVIRONMENTS[ctx?.meta?.user?.guid || "global"][varName] = varValue;

        var dated = moment().format("Y-M-D HH:mm:ss");
        _DB.db_insertQ1("appdb", "lgks_environment", {
            "guid": ctx?.meta?.user?.guid || "global", 
            "module": module, 
            "var_title": varName, 
            "var_code": `${module}:${varName}`.toUpperCase().trim(), 
            "var_value": varValue, 
            "var_params": JSON.stringify(varParams), 
            "var_nature": varNature, 
            "privilege": "admin",
            "blocked": "false", 
            "created_on": dated, 
            "created_by": ctx?.meta?.user?.userId || "system", 
            "edited_on": dated, 
            "edited_by": ctx?.meta?.user?.userId || "system", 
        });

        return varValue;
    },

    updateEnvVariable : function(ctx, varCode, varValue, varParams = {}, varNature = 'backend', varPrivilege = 'admin') {
        if(!ENVIRONMENTS[ctx?.meta?.user?.guid || "global"]) return false;

        var dated = moment().format("Y-M-D HH:mm:ss");
        _DB.db_updateQ1("appdb", "lgks_environment", {
            "var_value": varValue, 
            "var_params": JSON.stringify(varParams), 
            "var_nature": varNature, 
            "privilege": varPrivilege,
            "edited_on": dated, 
            "edited_by": ctx?.meta?.user?.userId || "system", 
        }, {
            "var_code": varCode
        });

        ENVIRONMENTS[ctx?.meta?.user?.guid || "global"][`${module}:${varName}`.toUpperCase().trim()] = varValue;
    },

    deleteEnvVariable : function(ctx, varCode) {
        if(!ENVIRONMENTS[ctx?.meta?.user?.guid || "global"]) return false;

        var dated = moment().format("Y-M-D HH:mm:ss");
        _DB.db_updateQ1("appdb", "lgks_environment", {
            "blocked": "true", 
            "edited_on": dated, 
            "edited_by": ctx?.meta?.user?.userId || "system", 
        }, {
            "var_code": varCode
        });

        delete ENVIRONMENTS[ctx?.meta?.user?.guid || "global"][varCode];
    },

    importEnvVariables: async function(ctx, module, envList) {
        for(var i=0; i<envList.length; i++) {
            var existingVar = ENVIRONMENTS[ctx?.meta?.user?.guid || "global"][`${module}:${envList[i].var_name}`.toUpperCase().trim()];
            if(existingVar===undefined) {
                this.registerEnvVariable(ctx, module, envList[i].var_name, envList[i].var_value, envList[i].var_params || {}, envList[i].var_nature || 'backend');
            } else {
                this.updateEnvVariable(ctx, `${module}:${envList[i].var_name}`.toUpperCase().trim(), envList[i].var_value, envList[i].var_params || {}, envList[i].var_nature || 'backend');
            }
        }
    },
    
    //nature = backend/frontend/mobile
    fetchEnvByNature: async function(ctx, nature) {
        var tempEnv = {};
        var envData = await _DB.db_selectQ("appdb", "lgks_environment", "*", {
                guid: ctx?.meta?.user?.guid || "global", 
                var_nature: nature,
                blocked: "false"
            },{});
        if(!envData || !envData.results || envData.results.length<=0) return false;

        for(var i=0; i<envData.results.length; i++) {
            tempEnv[envData.results[i].var_code.toUpperCase()] = envData.results[i].var_value;
        }

        return tempEnv;
    },

    getEnvModule: function(ctx, moduleName) {
        if(!ENVIRONMENTS[ctx?.meta?.user?.guid || "global"]) return false;

        var moduleEnv = {};
        _.each(ENVIRONMENTS[ctx?.meta?.user?.guid || "global"], function(value, key) {
            if(key.startsWith(moduleName.toUpperCase()+":")) {
                moduleEnv[key] = value;
            }
        });
        return moduleEnv;
    },

    getEnvVariable: function(ctx, varName, defaultValue=null) {
        if(!ENVIRONMENTS[ctx?.meta?.user?.guid || "global"]) return false;

        if(ENVIRONMENTS[ctx?.meta?.user?.guid || "global"][varName] && ENVIRONMENTS[ctx?.meta?.user?.guid || "global"][varName].length>0) {
            return ENVIRONMENTS[ctx?.meta?.user?.guid || "global"][varName];
        }
        return defaultValue;
    },

    //metaInfo = ctx.meta
    fetchEnvInfo: async function(metaInfo) {
        return await generateEnvObj(metaInfo);
    },
}

async function generateEnvObj(metaInfo) {
    if(metaInfo['META_PROCESSED']===true) return metaInfo;

    var newMeta = _.cloneDeep(metaInfo);

    const newUser = await USERS.getUserData(newMeta.sessionId);

    newMeta["SESS_LOGIN_TIME"] = newMeta.user.timestamp;

    newMeta["SESS_GUID"] = newUser.guid;
    newMeta["SESS_USER_ID"] = newUser.userId;
    newMeta["SESS_USERID"] = newUser.userId;
    newMeta["USERID"] = newUser.userId;
    newMeta["SESS_TENANT_ID"] = newUser.tenantId;
    newMeta["SESS_USER_NAME"] = newUser.username;
    newMeta["SESS_REPORTING_TO"] = newUser.reporting_to;
    newMeta["SESS_USER_MOBILE"] = newUser.mobile;
    newMeta["SESS_USER_CELL"] = newMeta["SESS_USER_MOBILE"];
    newMeta["SESS_USER_EMAIL"] = newUser.email;
    newMeta["SESS_USER_COUNTRY"] = newUser.country;
    newMeta["SESS_USER_ZIPCODE"] = newUser.zipcode;
    newMeta["SESS_USER_GEOLOC"] = newUser.geolocation;
    newMeta["SESS_USER_AVATAR"] = newUser.avatar?newUser.avatar:"";

    newMeta["SESS_ACCESS_ID"] = newUser.access?.id;
    newMeta["SESS_ACCESS_NAME"] = newUser.access?.name;
    newMeta["SESS_ACCESS_SITES"] = newUser.access?.sites;
    
    newMeta["SESS_PRIVILEGE_ID"] = newUser.privilege?.id;
    newMeta["SESS_PRIVILEGE_NAME"] = newUser.privilege?.name;
    newMeta["SESS_PRIVILEGE_HASH"] = newUser.privilege?.hash;

    newMeta["SESS_GROUP_ID"] = newUser.group?.id;
    newMeta["SESS_GROUP_NAME"] = newUser.group?.name;
    newMeta["SESS_GROUP_MANAGER"] = newUser.group?.manager;
    // newMeta["SESS_GROUP_DESCS"] = newUser.group?.groupDescs;

    newMeta["SESS_ACTIVE_SITE"] = newMeta.appInfo.appid;
    newMeta["SESS_LOGIN_SITE"] = newMeta.appInfo.appid;
    newMeta["SESS_SITEID"] = newMeta.appInfo.appid;
    // newMeta["ADMIN_PRIVILEGE_RANGE"] = "";

    newMeta["SESS_CURRENT_DATE"] = moment().format("Y-M-D");
    newMeta["SESS_CURRENT_DATE_DMY"] = moment().format("D-M-Y");
    newMeta["SESS_CURRENT_DATETIME"] = moment().format("Y-M-D HH:mm:ss");
    newMeta["SESS_CURRENT_DAY"] = moment().format("D");
    newMeta["SESS_CURRENT_DAYNAME"] = moment().format("dddd");
    newMeta["SESS_CURRENT_MONTH"] = moment().format("M");
    newMeta["SESS_CURRENT_MONTH_NAME"] = moment().format("MMMM");
    newMeta["SESS_CURRENT_TIME"] = moment().format("HH:mm:ss");
    newMeta["SESS_CURRENT_YEAR"] = moment().format("Y");
    newMeta["SESS_DATE_YESTERDAY"] = moment().subtract(1, 'days').format("Y-M-D");

    // newMeta["SESS_PROFILE_ID"] = newUser.profile.id;
    // newMeta["SESS_PROFILE_CODE"] = newUser.profile.code;
    // newMeta["SESS_PROFILE_DESIGNATION"] = newUser.profile.designation;
    // newMeta["SESS_PROFILE_SUBTYPE"] = newUser.profile.subtype;
    // newMeta["SESS_REPORTING_TO"] = newUser.profile.reporting_to;
    // newMeta["SESS_REPORTING_TO_HR"] = newUser.profile.reporting_to_hr;

    // newMeta["SESS_BRANCH_ID"] = newUser.branch.id;
    // newMeta["SESS_BRANCH_CODE"] = newUser.branch.code;
    // newMeta["SESS_BRANCH_NAME"] = newUser.branch.name;

    newMeta["SESS_POLICY"] = {};
    newMeta["SESS_ROLE_LIST"] = newUser.roles;
    newMeta["SESS_SCOPE_LIST"] = newUser.scopes;

    newMeta["SESS_GEOLOCATION"] = newMeta.geolocation?newMeta.geolocation:newUser.geolocation;
    newMeta["GEOLOCATION"] = newMeta["SESS_GEOLOCATION"];
    newMeta["CLIENT_IP"] = newMeta.remoteIP;
    newMeta["SERVER_IP"] =  newMeta.serverIP?newMeta.serverIP:newMeta.serverHost;
    
    //Load Environment Variables
    _.each(ENVIRONMENTS, function(value, key) {
        newMeta[key] = value;
    });

    newMeta['META_PROCESSED'] = true;

    // console.log("META_INFO", newMeta);

    return newMeta;
}