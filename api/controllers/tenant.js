/*
 * Tenant Controller
 * 
 * */

module.exports = {

    initialize: function() {

    },

    getTenantInfo : async function(guid) {
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

        return tenantInfo;
    }
}
