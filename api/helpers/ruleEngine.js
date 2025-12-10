//Rule Engine that uses  json-rules-engine
//https://www.npmjs.com/package/json-rules-engine

module.exports = {

	initialize : function() {
		console.log("\x1b[36m%s\x1b[0m","JSON Rule Engine Initialized");
	},

    listRules: async function(filter) {
        if(!filter) filter = {};
        
        var data = await _DB.db_selectQ("appdb", "sys_logiksrules", "*", _.extend({
                blocked: "false",
                // rulecode: ruleID
            }, filter),{});
        if(!data) data = [];
        
		return data;
	},

	processRule: async function(ruleID, dataFields) {
        var data = await _DB.db_selectQ("appdb", "sys_logiksrules", "*", {
                blocked: "false",
                rulecode: ruleID
            },{});
		if(!data) return false;

        //data = data[0];

        //engine
        //fields
        //conditions
        //actions

        return false;
	}
}