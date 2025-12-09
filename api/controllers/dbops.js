/*
 * DB Operations Controller
 * 
 * */

const dbOpsMap = new Map();

module.exports = function(server) {

    initialize = function() {

    }

    storeDBOpsQuery = async function(jsonQuery, fields, operation, userInfo) {
        //jsonQuery = table, where, fields
        const dbOpsID = UNIQUEID.generate(12);

        dbOpsMap[dbOpsID] = {"operation": operation, "source": jsonQuery, "fields": fields};

        return dbOpsID;
    }

    getDBOpsQuery = async function(dbOpsID, userInfo) {
        if(dbOpsMap[dbOpsID]) return _.cloneDeep(dbOpsMap[dbOpsID]);
        return false;
    }

    return this;
}
