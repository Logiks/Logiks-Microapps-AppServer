/*
 * Tenant Controller
 * 
 * */

var tenantMap = {};

module.exports = {

    initialize: function() {
        console.log("\x1b[36m%s\x1b[0m","Tenant System Initialized");
    },

    getTenantInfo : async function(guid) {
        if(tenantMap[guid]) return tenantMap[guid];

        var whereCond = {
            "blocked": "false",
            "guid": guid
        };
        var data = await _DB.db_selectQ("appdb", "lgks_tenants", "*", whereCond, {});

        if(!data || !data.results || data.results.length<=0) return [];

        var tenantInfo = data.results[0];

        tenantInfo.allowed_apps = tenantInfo.allowed_apps.split(",");

        try {
            tenantInfo.applicationOverrides = JSON.parse(tenantInfo.application_overrides);
        } catch(err) {
            tenantInfo.applicationOverrides = {};
        }

        tenantMap[guid] = tenantInfo;

        return tenantMap[guid];
    },

    //Old Code will be removerd in future
    resolveSSOTenant: async function(ssoId, ssoSource) {
        const GUID = await ENCRYPTER.generateHash(`${ssoSource}:${ssoId}`);
        var whereLogic = {
            "blocked": "false",
        };
        whereLogic[`FIND_IN_SET(${_DB.db_clean(String(GUID))}, sso_codes)`] = "RAW";
        
        var data = await _DB.db_selectQ("appdb", "lgks_tenants", "*", whereLogic, {});

        if(!data || !data.results || data.results.length<=0) return false;

        return data.results[0].guid;
    },

    generateSSOId: async function(ssoSource, ssoId) {
        return await ENCRYPTER.generateHash(`${ssoSource}:${ssoId}`);
    }
}
