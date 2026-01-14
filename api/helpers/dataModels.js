/*
 * Data Models, Hooks, Encryption Layer etc
 * 
 * */

const MODEL_MAP = {};

module.exports = {

    initialize : function(callback) {
        console.log("\x1b[36m%s\x1b[0m","DataModel Initialized");
    },

    getModel: async function(table) {
        if(MODEL_MAP[table]) return MODEL_MAP[table];
        const pluginID = table.split("_")[0];

        const tableModel = await _call(`${pluginID}.source`, {folder: "dataModel", file: `${table}.json`, params: {}});
        // console.log("tableModel", table, pluginID, tableModel);

        if(!tableModel) return false;

        MODEL_MAP[table] = tableModel;

        return false;
    },

    //Prepare data before encryption
    prepareField: async function(table, field, data) {
        const dataModel = await DATAMODELS.getModel(table)
        if(!dataModel) return data;

        if(dataModel.fields[field].encrypted) {
            return ENCRYPTER.encrypt(data, `${table}.${CONFIG.SALT_KEY}`);
        }

        return data;
    },

    //Process data before sending out
    processField: async function(table, field, data) {
        const dataModel = await DATAMODELS.getModel(table)
        if(!dataModel) return data;

        if(dataModel.fields[field].encrypted) {
            return ENCRYPTER.decrypt(data, `${table}.${CONFIG.SALT_KEY}`);
        }

        return data;
    },

    processData: function(singleRecord) {
        _.each(singleRecord, function(val, col) {
            var colArr = col.split(".");
            if(colArr.length>1) {
                singleRecord[col] = DATAMODELS.processField(colArr[0], colArr[1], val);
            }
        });
    },

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