/*
 * DB Operations Controller
 * 
 * */

const dbOpsMap = _CACHE.getCacheMap("DBOPSMAP");

module.exports = {

    initialize: function() {
        console.log("\x1b[36m%s\x1b[0m","DBOperation Engine Initialized");
    },

    storeDBOpsQuery: async function(jsonQuery, fields, operation, userInfo) {
        //jsonQuery = table, where, fields
        const dbOpsID = UNIQUEID.generate(12);

        dbOpsMap[dbOpsID] = {"operation": operation, "source": jsonQuery, "fields": fields};
        _CACHE.saveCacheMap("DBOPSMAP", dbOpsMap);

        return dbOpsID;
    },

    getDBOpsQuery: async function(dbOpsID, userInfo) {
        if(dbOpsMap[dbOpsID]) return _.cloneDeep(dbOpsMap[dbOpsID]);
        return false;
    },
}
