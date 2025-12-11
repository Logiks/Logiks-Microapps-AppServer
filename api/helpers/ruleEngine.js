//Rule Engine that uses  json-rules-engine
//https://www.npmjs.com/package/json-rules-engine
//https://www.json-rule-editor.com/#/home

const { Engine } = require('json-rules-engine')

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
        if(!data || !data?.results || data.results.length<=0) data = [];
        
		return data?.results;
	},

	processRule: async function(ruleID, dataFields, addonFacts) {
        var data = await _DB.db_selectQ("appdb", "sys_logiksrules", "*", {
                blocked: "false",
                rulecode: ruleID
            },{});
		if(!data || !data?.results || data.results.length<=0) return false;

        data = data.results[0];

        if(!data.fields) data.fields = {};
        if(!data.actions) data.actions = {};

        var vStatus = VALIDATIONS.validateRule(dataFields, data.fields);
        if (!vStatus.status) {
            return {"status": "error", "message": "Input Validation Failed", "errors": vStatus.errors};
        }

        let facts = dataFields;

        switch(data.engine) {
            case "v1":
                let engine = new Engine()
                engine.addRule({
                    name: data.title,
                    conditions: data.conditions,
                    event: data.actions
                });

                if(addonFacts) {
                    //engine.addFact('validTags', ['dev', 'staging', 'load', 'prod'])
                    _.each(addonFacts, function(data, key) {
                        engine.addFact(key, data);
                    });
                }

                const { events, failureEvents } = await engine.run(facts);
                // console.log("RESULTS", events, failureEvents);

                if(events && events.length>0) return {"status": "success", "events": events};
                else return {"status": "failure", "failed_events": failureEvents};
                break;
            default:
                return {"status": "error", "message": "Engine not supported"};
        }
	}
}