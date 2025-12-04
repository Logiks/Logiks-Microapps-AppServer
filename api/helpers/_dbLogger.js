//Database Logger Helper Functions
//How to use
// _DBLOGGER._log("activities", {""})

const DBLOGGER_KEY = "logdb";

module.exports = function(server) {

    initalize = function() {}

    _log = async function(dbTable, payload, appID) {
        return await new Promise((resolve, reject) => {
            db_insertQ1(DBLOGGER_KEY, `log_${dbTable}`, _.extend({
                "appid": appID
            }, MISC.generateDefaultDBRecord(payload, false)), function (ans, error) {
                if (ans) {
                    resolve(ans);
                } else {
                    resolve(false, error);
                }
            });
        })
    }

    return this;
}
