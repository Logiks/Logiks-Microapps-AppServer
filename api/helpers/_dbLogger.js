//Database Logger Helper Functions
//How to use
// _DBLOGGER._log("activities", "", "", {""})

const DBLOGGER_KEY = "logdb";
var DBLOGGER_TABLES = [];
module.exports = {

	initialize : async function() {
        let dbList = await _DB.db_query(DBLOGGER_KEY, "SHOW TABLES");
        DBLOGGER_TABLES = dbList.map(item => item.Tables_in_microapp_logsdb);//.replace('log_', '')
        console.log("\x1b[36m%s\x1b[0m", "DBLogger Engine Intialized");
    },

    _log : async function(logID, guid, appId, payload) {
        const dbTable = `log_${logID}`;
        if(DBLOGGER_TABLES.indexOf(dbTable)<0) return false;
        return await _DB.db_insertQ1(DBLOGGER_KEY, dbTable, _.extend({
                "guid": guid,
                "appid": appId
            }, MISC.generateDefaultDBRecord(payload, false)));
    }
}
