/*
 * Data Models, Hooks, Encryption Layer etc
 *
 * Handles - Encryption, Hooks, Meta Update Rules, Cascading
 * Sample Schema (plugins/<module>/dataModels/<table>.json):
 * {
        "hooks": {
            "insert": [],
            "update": [],
            "delete": []
        },
        "fields": {
            "lgks_users.email": {
                "encrypted": true
            }
        }
    }
 * */

const MODEL_MAP = {};

module.exports = {

    initialize : function(callback) {
        console.log("\x1b[36m%s\x1b[0m","DataModel Initialized");
    },

    getModel: async function(table) {
        if(MODEL_MAP[table]) return MODEL_MAP[table];
        const pluginID = table.split("_")[0];

        if(["tables", "lgks", "do", "sys", "cache", "log", "logs"].indexOf(pluginID.toLowerCase())>=0 || pluginID.length<=2) return false;

        const tableModel = await _call(`${pluginID}.source`, {folder: "dataModels", file: `${table}.json`, params: {}});
        // console.log("tableModel", table, pluginID, tableModel);

        if(!tableModel) return false;

        MODEL_MAP[table] = tableModel;

        return false;
    },

    //insert -> param -> insertId or array of insertId
    //update -> param -> where
    //delete -> param -> where
    checkHook: async function(tables, operation, dbkey = "app", param = "") {
        const tableList = tables.split(",");
        _.each(tableList, async function(tbl, k) {
            const dataModel = await DATAMODELS.getModel(tbl);
            if(dataModel && dataModel.hooks && dataModel.hooks[operation]) {
                _.each(dataModel.hooks[operation], async function(query, k1) {
                    await _DB.db_query(dbkey, query, {});
                });
            }
        })
    },

    //Prepare field before encryption
    prepareField: async function(table, field, data) {
        const dataModel = await DATAMODELS.getModel(table)
        if(!dataModel) return data;

        if(dataModel.fields[field].encrypted) {
            return ENCRYPTER.encrypt(data, `${table}.${CONFIG.SALT_KEY}`);
        }

        return data;
    },

    //Process field before sending out
    processField: async function(table, field, data) {
        const dataModel = await DATAMODELS.getModel(table)
        if(!dataModel) return data;

        if(dataModel.fields[field].encrypted) {
            return ENCRYPTER.decrypt(data, `${table}.${CONFIG.SALT_KEY}`);
        }

        return data;
    },

    //Process record before sending out
    processData: function(singleRecord) {
        _.each(singleRecord, function(val, col) {
            var colArr = col.split(".");
            if(colArr.length>1) {
                singleRecord[col] = DATAMODELS.processField(colArr[0], colArr[1], val);
            }
        });
    },

    //Prepare record before encryption
    prepareData: function(table, singleRecord) {
        _.each(singleRecord, function(val, col) {
            var colArr = col.split(".");
            if(colArr.length>1)
                singleRecord[col] = DATAMODELS.prepareField(colArr[0], colArr[1], val);
            else
                singleRecord[col] = DATAMODELS.prepareField(table, col, val);
        });
    }
}