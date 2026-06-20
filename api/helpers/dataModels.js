/*
 * Data Models, Hooks, Encryption Layer etc
 *
 * Handles - Encryption, Hooks, Meta Update Rules, Cascading
 * Sample Schema (plugins/<module>/dataModels/<table>.json):
 * {
        "hooks": {
            "insert": {
                "UPDATE tabl1.col1=tabl1.col1+1 where id=2": "sql",
                "docs.test1": "method"
            },
            "update": {},
            "delete": {}
        },
        "fields": {
            "lgks_users.email": {
                "encrypted": true,
                "key": "asdasdasd123"//optional
                "cast": "DECIMAL(12,2)"
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
        var pluginID = table.split("_")[0];

        if(["tables", "lgks", "do", "sys", "cache", "logs", "mapps", "my"].indexOf(pluginID.toLowerCase())>=0 || pluginID.length<=2) return false;
        if(["log", "data"].indexOf(pluginID.toLowerCase())>=0) pluginID = table.split("_")[1];
        
        const tableModel = await _call(`${pluginID}.source`, {folder: "dataModels", file: `${table}.json`, silent: true, params: {}});
        // console.log("tableModel", table, pluginID, tableModel);

        if(!tableModel) {
            // MODEL_MAP[table] = false;
            return false;
        }

        MODEL_MAP[table] = tableModel;

        return MODEL_MAP[table];
    },

    //insert -> param -> insertId or array of insertId
    //update -> param -> where
    //delete -> param -> where
    checkHook: async function(tables, operation, dbkey = "app", param = "") {
        const tableList = tables.split(",");
        _.each(tableList, async function(tbl, k) {
            const dataModel = await DATAMODELS.getModel(tbl);
            if(dataModel && dataModel.hooks && dataModel.hooks[operation]) {
                _.each(dataModel.hooks[operation], async function(runType, query) {
                    switch(query) {
                        case "sql":
                            await _DB.db_query(dbkey, query, {});
                            break;
                        case "method":
                            _call(query, {tables, operation, dbkey, param});
                            break;
                    }
                });
            }
        })
    },

    //Prepare field before encryption
    prepareField: async function(table, field, data) {
        const dataModel = await DATAMODELS.getModel(table)
        if(!dataModel) return data;

        try {
            if(dataModel.fields[field].encrypted) {
                if(!dataModel.fields[field].key) dataModel.fields[field].key = `${table.toLowerCase()}.${field}.${CONFIG.SALT_KEY}`;
                return ENCRYPTER.encrypt(`${data}`, dataModel.fields[field].key);
            }
        } catch(e) {}

        return data;
    },

    //Process field before sending out
    processField: async function(table, field, data) {
        const dataModel = await DATAMODELS.getModel(table)
        if(!dataModel) return data;

        try {
            if(dataModel.fields[field].encrypted) {
                if(!dataModel.fields[field].key) dataModel.fields[field].key = `${table.toLowerCase()}.${field}.${CONFIG.SALT_KEY}`;
                const originalValue = await ENCRYPTER.decrypt(data, dataModel.fields[field].key);
                try {
                    const newValue = castValue(originalValue, dataModel.fields[field].cast);
                    return newValue;
                } catch(e2) {
                    return originalValue;
                }
            }
        } catch(e) {}

        return data;
    },

    //Prepare record before encryption
    prepareData: async function(table, singleRecord) {
        _.each(singleRecord, async function(val, col) {
            var colArr = col.split(".");
            if(colArr.length>1)
                singleRecord[col] = await DATAMODELS.prepareField(colArr[0], colArr[1], val);
            else
                singleRecord[col] = await DATAMODELS.prepareField(table, col, val);
        });
    },

    //Process record before sending out
    processData: async function(singleRecord) {
        _.each(singleRecord, async function(val, col) {
            var colArr = col.split(".");
            if(colArr.length>1) {
                singleRecord[col] = await DATAMODELS.processField(colArr[0], colArr[1], val);
            }
        });
    },

    processQuery: async function(table, sql) {
        return sql;
        // const tableArr = table.replace(/\`/g,'').split(",");

        // for (var i = tableArr.length - 1; i >= 0; i--) {
        //     const tbl = tableArr[i];

        //     const dataModel = await DATAMODELS.getModel(tbl);
        //     if(!dataModel || !dataModel.fields) continue;

        //     if(dataModel.fields && Object.keys(dataModel.fields).length>0) {
        //         const tempSQL = transformSQLForEncryption(sql, dataModel.fields);
        //         if(tempSQL) sql = tempSQL;
        //     }
        // }

        // return sql;
    }
}


function transformSQLForEncryption(sql, columnsConfig = {}) {
    const escapeRegex = (str) =>
        str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Build SQL expression
    const buildExpression = (column, config, standalone = false) => {

        let expr = column;
        let table = column;
        if(column.indexOf(".")>0) {
            table = column.split(".")[0].toLowerCase();
        }

        // AES decrypt
        if (config.encrypted) {
            // if(!config.key) config.key = Buffer.from(String(column).replace(/[^a-zA-Z0-9]/g, "")).toString("base64");
            if(!config.key) config.key = `${table}.${column}.${CONFIG.SALT_KEY}`;
            expr = `AES_DECRYPT(${column}, '${config.key}')`;
        }

        // CAST
        if (config.cast) {
            expr = `CAST(${expr} AS ${config.cast})`;
        }

        // Standalone SELECT column aliasing
        if (standalone) {
            return `${expr} AS ${column}`;
        }

        return expr;
    };

    // Replace configured columns inside any SQL block
    const replaceColumns = (text, standaloneMode = false) => {

        Object.entries(columnsConfig).forEach(([rawColumn, config]) => {

            const column = rawColumn.split(".").pop();

            // Skip if already transformed
            if (
                text.includes(`AES_DECRYPT(${column}`) ||
                text.includes(`CAST(${column}`)
            ) {
                return;
            }

            // Standalone SELECT field
            if (standaloneMode) {

                const standaloneRegex = new RegExp(
                    `^(?:[\\w]+\\.)?${escapeRegex(column)}$`,
                    "i"
                );

                if (standaloneRegex.test(text.trim())) {

                    text = buildExpression(
                        column,
                        config,
                        true
                    );

                    return;
                }
            }

            // General replacement
            const regex = new RegExp(
                `(?<![\\w.])${escapeRegex(column)}(?![\\w])`,
                "g"
            );

            text = text.replace(
                regex,
                buildExpression(column, config, false)
            );

        });

        return text;
    };

    // -------------------------
    // SELECT PART
    // -------------------------

    const selectMatch = sql.match(/SELECT\s+([\s\S]*?)\s+FROM\s/i);

    if (!selectMatch) {
        return sql;
    }

    const selectSection = selectMatch[1];

    // Safe comma splitter
    const fields = [];
    let depth = 0;
    let current = "";

    for (let i = 0; i < selectSection.length; i++) {

        const ch = selectSection[i];

        if (ch === "(") depth++;
        if (ch === ")") depth--;

        if (ch === "," && depth === 0) {
            fields.push(current.trim());
            current = "";
        } else {
            current += ch;
        }
    }

    if (current.trim()) {
        fields.push(current.trim());
    }

    // Process SELECT fields
    const processedFields = fields.map(field => {

        const isFormula =
            /[\+\-\*\/()]|CASE\s+WHEN|ROUND\s*\(/i.test(field);

        return replaceColumns(field, !isFormula);
    });

    sql = sql.replace(
        selectSection,
        processedFields.join(", ")
    );

    // -------------------------
    // WHERE / HAVING / ORDER BY
    // -------------------------

    sql = replaceColumns(sql, false);

    return sql;
}

//cast data into various formats
function castValue(value, castingTarget) {
    if(!castingTarget) return value;
    const target = castingTarget.toLowerCase();

    switch (true) {
        case target === "integer":
          return parseInt(value, 10);

        case target === "float":
          return parseFloat(value);

        case /^decimal\(\d+,\d+\)$/.test(target): {
          const [, precision, scale] = target.match(/^decimal\((\d+),(\d+)\)$/);
          return Number(parseFloat(value).toFixed(Number(scale)));
        }

        case target === "date":
          return new Date(value);

        case target === "datetime":
          return new Date(value);

        case target === "time":
          return value; // or custom time parsing

        default:
          return value;
    }
}