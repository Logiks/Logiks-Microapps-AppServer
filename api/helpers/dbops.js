/*
 * DB Operations Controller
 * 
 * */

module.exports = {

    initialize: function() {
        console.log("\x1b[36m%s\x1b[0m","DBOperation Engine Initialized");
    },

    storeDBOpsQuery: async function(jsonQuery, fields, operation, forcefill, userInfo, params, hooks) {
        //jsonQuery = table, where, fields
        const dbOpsID = params? encodeURIComponent(`${params.moduleId}@${params.objId}@${params.refid || ''}`): UNIQUEID.generate(12);
        
        const dbOPSObj = {"operation": operation, "source": jsonQuery, "fields": fields, "forcefill": forcefill, "userInfo": userInfo, "hooks": hooks};
        
        CACHEMAP.set("DBOPSMAP", dbOpsID, dbOPSObj);

        return dbOpsID;
    },

    getDBOpsQuery: async function(dbOpsID, userInfo, ctx) {
        const dbOPSObj = CACHEMAP.get("DBOPSMAP", dbOpsID);

        if(dbOPSObj) return _.cloneDeep(dbOPSObj);
        // console.log("getDBOpsQuery", dbOpsID);

        var queryIDTemp = decodeURIComponent(`${dbOpsID}`).split("@");
        var params = {};
        params.module = queryIDTemp[0];
        params.item = queryIDTemp[1];
        if(queryIDTemp[2]) params.operation = queryIDTemp[2];
        if(queryIDTemp[3]) params.refid = queryIDTemp[3];

        //This generates the dbOpsID using storeDBOpsQuery
        await ctx.call("modules.fetchModule", params);

        const dbOPSObjNew = CACHEMAP.set("DBOPSMAP", dbOpsID);

        return dbOPSObjNew;
    },

    //formObj = source, fields, forcefill
    saveFormObject: async function(dbops, formObj, userInfo) {
        if(!["create","update","delete","read","fetch"].includes(dbops)) return false;

        return this.storeDBOpsQuery(formObj.source, formObj.fields, dbops, formObj.forcefill, userInfo);
    },
}
