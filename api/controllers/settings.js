/*
 * Settings Controller for Application and Users
 * 
 * lgks_settings : Application Level Settings per Tenant for SuperAdmin
 * sys_settings  : Module Level Settings per GUID and APPID for Admin
 * user_settings : User Level Settings per GUID and APPID for Users
 * 
 * */

module.exports = {

    initialize : function() {
        // console.log("\x1b[36m%s\x1b[0m","Settings Controller Initialized");
        return true;
    },

    //For Application Level Settings per Tenant - lgks_settings
    getAppSettings: async function(guid, appid, setting_key, defaultValue = null, category="general") {
        var whereCond = {
            "blocked": "false",
            "guid": guid,
            "appid": appid,
            "setting_key": setting_key
        };
        
        var settingsData = await _DB.db_selectQ("appdb", "lgks_settings", "id, settings_value, setting_key, category", whereCond, {});
        if(!settingsData || !settingsData.results || settingsData.results.length<=0) {
            //Auto Register Default Value
            if(defaultValue) {
                var dated = moment().format("Y-M-D HH:mm:ss");
                var createdData = {
                    "guid": guid,
                    "appid": appid,
                    "setting_key": setting_key,
                    "settings_value": (typeof defaultValue=="object")?JSON.stringify(defaultValue):defaultValue,
                    "category": category,
                    "created_on": dated,
                    "created_by": "auto",
                    "edited_on": dated,
                    "edited_by": "auto",
                };
                await _DB._insertQ1("appdb", "lgks_settings", createdData);
            }
            return defaultValue;
        }
        try {
            const tempValue = JSON.parse(settingsData.results[0].settings_value, true);
            return tempValue;
        } catch(e) {
            return settingsData.results[0].settings_value;
        }
    },

    //For Module Level Settings per GUID and APPID -> sys_settings
    getModuleSettings: async function(guid, appid, module_name, setting_key, defaultValue = null, params = {}) {
        var whereCond = {
            "blocked": "false",
            "guid": guid,
            "appid": appid,
            "module_name": module_name,
            "setting_key": setting_key
        };
        
        var settingsData = await _DB.db_selectQ("appdb", "sys_settings", "id, settings_value, setting_key, category", whereCond, {});
        if(!settingsData || !settingsData.results || settingsData.results.length<=0) {
            //Auto Register Default Value
            if(defaultValue) {
                var dated = moment().format("Y-M-D HH:mm:ss");
                if(!params) params = {};
                var createdData = {
                    "guid": guid,
                    "appid": appid,
                    "module_name": module_name,
                    "setting_key": setting_key,
                    "settings_value": (typeof defaultValue=="object")?JSON.stringify(defaultValue):defaultValue,
                    "setting_params": (typeof params=="object")?JSON.stringify(params):params,
                    "created_on": dated,
                    "created_by": "auto",
                    "edited_on": dated,
                    "edited_by": "auto",
                };
                await _DB._insertQ1("appdb", "sys_settings", createdData);
            }
            return defaultValue;
        }
        try {
            const tempValue = JSON.parse(settingsData.results[0].settings_value, true);
            return tempValue;
        } catch(e) {
            return settingsData.results[0].settings_value;
        }
    },

    loadUserSettings: async function(guid, appId, userId, module_name, setting_key, defaultValue = null, params = {}) {
        var whereCond = {
            "blocked": "false",
            "guid": guid,
            "appid": appId,
            "created_by": userId,
            "module_name": module_name,
            "setting_key": setting_key
        };
        
        var settingsData = await _DB.db_selectQ("appdb", "user_settings", "*", whereCond, {});
        if(!settingsData || !settingsData.results || settingsData.results.length<=0) {
            //Auto Register Default Value
            if(defaultValue) {
                var dated = moment().format("Y-M-D HH:mm:ss");
                if(!params) params = {};
                var createdData = {
                    "guid": guid,
                    "appid": appid,
                    "module_name": module_name,
                    "setting_key": setting_key,
                    "settings_value": (typeof defaultValue=="object")?JSON.stringify(defaultValue):defaultValue,
                    "setting_params": (typeof params=="object")?JSON.stringify(params):params,
                    "created_on": dated,
                    "created_by": "auto",
                    "edited_on": dated,
                    "edited_by": "auto",
                };
                await _DB._insertQ1("appdb", "sys_settings", createdData);
            }
            return defaultValue;
        }
        try {
            const tempValue = JSON.parse(settingsData.results[0].settings_value, true);
            return tempValue;
        } catch(e) {
            return settingsData.results[0].settings_value;
        }
    },
}
