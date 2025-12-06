/*
 * Tenant Controller
 * 
 * */

module.exports = function(server) {

    initialize = function() {

    }

    getTenantInfo = async function(guid, callback) {
        var whereCond = {
            "blocked": "false",
            "guid": guid
        };
        var data = await db_selectQ("appdb", "lgks_tenants", "*", whereCond, {});

        if(!data || data.length<=0) return false;

        var tenantInfo = data[0];

        tenantInfo.allowed_apps = tenantInfo.allowed_apps.split(",");

        try {
            tenantInfo.applicationOverrides = JSON.parse(tenantInfo.application_overrides);
        } catch(err) {
            tenantInfo.applicationOverrides = {};
        }

        return tenantInfo;
    }

    return this;
}
