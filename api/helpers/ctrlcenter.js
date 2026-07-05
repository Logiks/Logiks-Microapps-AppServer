//Control Center for various control activities like linking urls, start time, build no, etc
//Never Cache - Full Realtime

module.exports = {

    initialize : function() {
    },

    listControls: async function(nature = "backend", module = false, guid = false) {
        const whereLogic = {
            blocked: "false",
        };
        if(guid) whereLogic['guid'] = guid;
        if(module) whereLogic['module'] = module;

        var data = await _DB.db_selectQ("appdb", "lgks_ctrlcenter", "module, var_title, var_code, var_value", whereLogic,{});
        if(!data || !data?.results || data.results.length<=0) data = {results: []};

        return data.results;
    },

    getControl: async function(ctrlId, nature = "backend", module = false, guid = false) {
        const whereLogic = {
            blocked: "false",
            var_code: ctrlId
        };
        if(guid) whereLogic['guid'] = guid;
        if(module) whereLogic['module'] = module;

        var data = await _DB.db_selectQ("appdb", "lgks_ctrlcenter", "module, var_title, var_code, var_value", whereLogic,{});
        if(!data || !data?.results || data.results.length<=0) data = {results: []};

        return data.results;
    }
}