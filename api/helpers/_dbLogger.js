//Database Logger Helper Functions
//How to use
// _DBLOGGER._log("activities", "", "", {""})

const DBLOGGER_KEY = "logdb";
var DBLOGGER_TABLES = [];
const ALLOWED_LOGS = ["log_activities_user", "log_errors_frontend"];//"errors_backend", "system_events", "api_requests", "custom_logs"

module.exports = {

	initialize : async function() {
        const dbResponse = await _DB.db_query(DBLOGGER_KEY, "SHOW TABLES");
        const dbList = dbResponse?.results || [];
        
        DBLOGGER_TABLES = dbList.map(item => item.Tables_in_microapp_logsdb);//.replace('log_', '')
        dbList.forEach(item => {
            if(item.Tables_in_microapp_logsdb.toLowerCase().includes("frontend") 
                    && item.Tables_in_microapp_logsdb.toLowerCase().includes("frontend") 
                    && ALLOWED_LOGS.indexOf(item.Tables_in_microapp_logsdb)<0) {
                ALLOWED_LOGS.push(item.Tables_in_microapp_logsdb);
            }
        });
        
        console.log("\x1b[36m%s\x1b[0m", "DBLogger Engine Intialized");
    },

    _log : async function(logID, payload, ctx) {
        const dbTable = `log_${logID}`;
        
        if(DBLOGGER_TABLES.indexOf(dbTable)<0) return false;
        if(ALLOWED_LOGS.indexOf(logID)<0) return false;

        return await _DB.db_insertQ1(DBLOGGER_KEY, dbTable, _.extend({
                "guid": ctx?.meta?.user?.guid || "-",
                "appid": ctx?.meta?.appInfo?.appid || "system",
            }, payload, MISC.generateDefaultDBRecord(ctx, false)));
    }
}
