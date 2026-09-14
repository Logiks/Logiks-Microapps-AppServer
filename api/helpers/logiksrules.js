/*
 * Logiks Rules Engine
 * 
 * Domain model:
 *   Module   -> has many Tasks
 *   Task     -> has many Policies (ordered by `priority`, ascending = evaluated first)
 *   Rule   -> { conditions: [{attr, op, val}], logic: 'AND'|'OR', assignee }
 *
 * Resolution rule: first-match-wins, in priority order.
 * 
 * Rule Engine that uses  json-rules-engine
 * https://www.npmjs.com/package/json-rules-engine
 * https://www.json-rule-editor.com/#/home
 */

const { Engine } = require('json-rules-engine')

module.exports = {

	initialize : function() {
		console.log("\x1b[36m%s\x1b[0m","Logiks Rule Engine Initialized");
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

    simulateRule: async function(conditions, actions, facts = {}, debug = false) {
        let engine = new Engine()
        engine.addRule({
            name: "simulated_rule",
            conditions: conditions,
            event: actions
        });

        if(facts) {
            //engine.addFact('validTags', ['dev', 'staging', 'load', 'prod'])
            _.each(facts, function(data, key) {
                engine.addFact(key, data);
            });
        }

        const { events, failureEvents } = await engine.run(facts);
        // console.log("RESULTS", events, failureEvents);

        if(events && events.length>0) return {"status": "success", "events": events};
        else return {"status": "failure", "failed_events": failureEvents};
    },

    simulateGroup: async function(rules = [], facts = {}, debug = false) {
        let engine = new Engine()
        engine.addRule({
            name: "simulated_rule",
            conditions: conditions,
            event: actions
        });

        rules.forEach(row => {
            if (!row.conditions || !row.actions) return; // skip malformed rows defensively
            try {
                engine.addRule({
                    name: row.title || row.rulecode || "simulated_rule",
                    conditions: row.conditions,
                    event: row.actions,
                    priority: row.priority || 1000,
                });
            } catch (e) {
                console.error(`\x1b[31m[RuleEngine] Skipped malformed rule ${row.rulecode} (id:${row.id}): ${e.message}\x1b[0m`);
            }
        });

        if(facts) {
            //engine.addFact('validTags', ['dev', 'staging', 'load', 'prod'])
            _.each(facts, function(data, key) {
                engine.addFact(key, data);
            });
        }

        const { events, failureEvents } = await engine.run(facts);
        // console.log("RESULTS", events, failureEvents);

        if(events && events.length>0) return {"status": "success", "events": events};
        else return {"status": "failure", "failed_events": failureEvents};
    },

    processRuleGroup: async function(guid, module, rulegroup, dataFields, addonFacts, debug = false) {
        var data = await _DB.db_selectQ("appdb", "sys_logiksrules", "*", {
                blocked: "false",
                is_published: "true",
                guid: guid,
                module: module,
                rulegroup: rulegroup,
                // vers: vers,
                "effective_from<=NOW()": "RAW",
            },{}, "ORDER BY priority DESC");
		if(!data || !data?.results || data.results.length<=0) {
            return {"status": "error", "message": "Rule Not Found"};
        }

        const rows = (data && data.results) || [];
        const time1 = process.hrtime.bigint();
        const engine = new Engine();

        rows.forEach(row => {
            if (!row.conditions || !row.actions) return; // skip malformed rows defensively
            try {
                engine.addRule({
                    name: row.title || row.rulecode,
                    conditions: row.conditions,
                    event: row.actions,
                    priority: row.priority || 1000,
                });
            } catch (e) {
                console.error(`\x1b[31m[RuleEngine] Skipped malformed rule ${row.rulecode} (id:${row.id}): ${e.message}\x1b[0m`);
            }
        });

        if(addonFacts) {
            //engine.addFact('validTags', ['dev', 'staging', 'load', 'prod'])
            _.each(addonFacts, function(data, key) {
                engine.addFact(key, data);
            });
        }

        let facts = dataFields;

        const { events, failureEvents } = await engine.run(facts);
        // console.log("RESULTS", events, failureEvents);

        const duration = Number(process.hrtime.bigint() - time1) / 1e6;

        logExecution(rows, _.extend({}, facts, addonFacts), events, failureEvents, duration, false, dataFields?.userid || addonFacts?.user?.guid || "system");

        if(events && events.length>0) return {"status": "success", "events": events};
        else return {"status": "failure", "failed_events": failureEvents};
	},

	processRule: async function(guid, ruleID, dataFields, addonFacts, debug = false) {
        var data = await _DB.db_selectQ("appdb", "sys_logiksrules", "*", {
                blocked: "false",
                is_published: "true",
                guid: guid,
                rulecode: ruleID,
                // vers: vers,
                "effective_from<=NOW()": "RAW",
            },{}, "ORDER BY priority DESC");
		if(!data || !data?.results || data.results.length<=0) {
            return {"status": "error", "message": "Rule Not Found"};
        }

        data = data.results[0];

        if(!data.fields) data.fields = {};
        if(!data.actions) data.actions = {};

        var vStatus = VALIDATIONS.validateRule(dataFields, data.fields);
        if (!vStatus.status) {
            return {"status": "error", "message": "Input Validation Failed", "errors": vStatus.errors};
        }

        let facts = dataFields;
        const time1 = process.hrtime.bigint();

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

                const duration = Number(process.hrtime.bigint() - time1) / 1e6;

                logExecution(data, _.extend({}, facts, addonFacts), events, failureEvents, duration, false, dataFields?.userid || addonFacts?.user?.guid || "system");

                if(events && events.length>0) return {"status": "success", "events": events};
                else return {"status": "failure", "failed_events": failureEvents};
                break;
            default:
                return {"status": "error", "message": "Engine not supported"};
        }
	}
}

function logExecution(ruleData, facts, events, failedEvents, duration, cacheHit, triggeredBy) {
    var dated = moment().format("Y-MM-DD HH:mm:ss");

    if(Array.isArray(ruleData)) {
        _DB.db_insertQ1("logdb", "log_logiksrules", {
            guid: ruleData[0].guid,
            rulegroup: ruleData[0].rulegroup,
            run_type: "group",
            module: ruleData[0].module,
            category: ruleData[0].category,
            vers: ruleData[0].vers,
            engine: ruleData[0].engine,
            conditions: ruleData.map(r => r.conditions),
            actions: ruleData.map(r => r.actions),
            data_facts: facts,
            status: events.length > 0 ? "success" : "failure",
            matched_events: events,
            failed_events: failedEvents,
            error_message: null,
            duration_ms: duration,
            cache_hit: cacheHit,
            "created_on": dated,
            "created_by": triggeredBy,
            "edited_on": dated,
            "edited_by": triggeredBy,
        });
    } else {
        _DB.db_insertQ1("logdb", "log_logiksrules", {
            guid: ruleData.guid,
            rulecode: ruleData.rulecode,
            run_type: "single",
            module: ruleData.module,
            category: ruleData.category,
            vers: ruleData.vers,
            engine: ruleData.engine,
            conditions: ruleData.conditions,
            actions: ruleData.actions,
            data_facts: facts,
            status: events.length > 0 ? "success" : "failure",
            matched_events: events,
            failed_events: failedEvents,
            error_message: null,
            duration_ms: duration,
            cache_hit: cacheHit,
            "created_on": dated,
            "created_by": triggeredBy,
            "edited_on": dated,
            "edited_by": triggeredBy,
        });
    }

    
}