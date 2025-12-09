//Database Logger Helper Functions
//How to use
// _DBLOGGER._log("activities", {""})

const DBLOGGER_KEY = "logdb";

module.exports = {

	initialize : function() {
        console.log("\x1b[36m%s\x1b[0m", "DBLogger Engine Intialized");
    },

    _log : async function(dbTable, payload, appID) {
        return await _DB.db_insertQ1(DBLOGGER_KEY, `log_${dbTable}`, _.extend({
                "appid": appID
            }, MISC.generateDefaultDBRecord(payload, false)));
    }
}
