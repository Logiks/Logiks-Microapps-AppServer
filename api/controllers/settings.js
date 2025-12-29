/*
 * Settings Controller for Application and Users
 * 
 * */

module.exports = {

    initialize : function() {
        // console.log("\x1b[36m%s\x1b[0m","Settings Controller Initialized");
        return true;
    },

    getUserSettings: async function(guid, userId, setting_key, defaultValue = null) {
        var whereCond = {
            "blocked": "false",
            "userId": userId,
            "guid": guid
        };
        if(setting_key!==false) {
            whereCond["setting_key"] = setting_key;
        }

        var settingsData = await _DB.db_selectQ("appdb", "lgks_settings", "*", whereCond, {});
        if(!settingsData || !settingsData.results || settingsData.results.length<=0) {
            //Auto Register Default Value
            if(defaultValue) {
                await this.registerUserSettings(guid, userId, setting_key, defaultValue);
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

    registerUserSettings: async function(guid, userId, setting_key, setting_value, category="general") {
        var dated = moment().format("Y-M-D HH:mm:ss");
        var createdData = {
            "guid": guid,
            "userid": userId,
            "setting_key": setting_key,
            "settings_value": (typeof setting_value=="object")?JSON.stringify(setting_value):setting_value,
            "category": category,
            "created_on": dated,
            "created_by": userId,
            "edited_on": dated,
            "edited_by": userId,
        };
        await _DB._insertQ1("appdb", "lgks_settings", createdData);
        return true;
    },
}
