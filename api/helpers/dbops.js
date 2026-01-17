/*
 * DB Operations Controller
 * 
 * */

const dbOpsMap = _CACHE.getCacheMap("DBOPSMAP");

module.exports = {

    initialize: function() {
        console.log("\x1b[36m%s\x1b[0m","DBOperation Engine Initialized");
    },

    storeDBOpsQuery: async function(jsonQuery, fields, operation, forcefill, userInfo, params) {
        //jsonQuery = table, where, fields
        const dbOpsID = params? `${params.moduleId}@${params.objId}@${params.refid || ''}`: UNIQUEID.generate(12);
        
        dbOpsMap[dbOpsID] = {"operation": operation, "source": jsonQuery, "fields": fields, "forcefill": forcefill, "userInfo": userInfo};
        _CACHE.saveCacheMap("DBOPSMAP", dbOpsMap);

        return dbOpsID;
    },

    getDBOpsQuery: async function(dbOpsID, userInfo, ctx) {
        if(dbOpsMap[dbOpsID]) return _.cloneDeep(dbOpsMap[dbOpsID]);
        // console.log("getDBOpsQuery", dbOpsID);

        var queryIDTemp = `${dbOpsID}`.split("@");
        var params = {};
        params.module = queryIDTemp[0];
        params.item = queryIDTemp[1];
        if(queryIDTemp[2]) params.operation = queryIDTemp[2];
        if(queryIDTemp[3]) params.refid = queryIDTemp[3];

        await ctx.call("modules.fetchModule", params);

        // DBOPS.storeDBOpsQuery(dbOpsMap[dbOpsID], userObj, queryID, {});

        return dbOpsMap[dbOpsID];
    },

    //formObj = source, fields, forcefill
    saveFormObject: async function(dbops, formObj, userInfo) {
        if(!["create","update","delete","read","fetch"].includes(dbops)) return false;

        return this.storeDBOpsQuery(formObj.source, formObj.fields, dbops, formObj.forcefill, userInfo);
    },
}
