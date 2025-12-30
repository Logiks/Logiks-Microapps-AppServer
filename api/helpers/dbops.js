/*
 * DB Operations Controller
 * 
 * */

const dbOpsMap = _CACHE.getCacheMap("DBOPSMAP");

module.exports = {

    initialize: function() {
        console.log("\x1b[36m%s\x1b[0m","DBOperation Engine Initialized");
    },

    storeDBOpsQuery: async function(jsonQuery, fields, operation, forcefill, userInfo) {
        //jsonQuery = table, where, fields
        const dbOpsID = UNIQUEID.generate(12);

        dbOpsMap[dbOpsID] = {"operation": operation, "source": jsonQuery, "fields": fields, "forcefill": forcefill, "userInfo": userInfo};
        _CACHE.saveCacheMap("DBOPSMAP", dbOpsMap);

        return dbOpsID;
    },

    getDBOpsQuery: async function(dbOpsID, userInfo) {
        if(dbOpsMap[dbOpsID]) return _.cloneDeep(dbOpsMap[dbOpsID]);
        return false;
    },

    //formObj = source, fields, forcefill
    saveFormObject: async function(dbops, formObj, userInfo) {
        if(!["create","update","delete","read","fetch"].includes(dbops)) return false;

        return this.storeDBOpsQuery(formObj.source, formObj.fields, dbops, formObj.forcefill, userInfo);
    },
}
