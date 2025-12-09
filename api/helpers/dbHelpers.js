//Common Required Helper Functions for database

module.exports = {

    initialize : function() {
        console.log("\x1b[36m%s\x1b[0m","DBHelpers providing additional db related support methods Initialized");
    }
}

global.createDBInsertFromRequest = function(ctx, input_fields, db_table, msgTitle, callback) {
    var vStatus = validateRule(ctx.params, Object.fromEntries(Object.entries(input_fields).filter(([_, value]) => value !== '')));

    if (!vStatus.status) {
        callback(false, { error: "Input Validation Failed", details: vStatus.errors });
        return;
    }

    _.each(input_fields, function(v,k) {
        if(v.split("|").indexOf("json")>=0) {
            try {
                if(v.split("|").indexOf("required")>=0) {
                    if(!ctx.params[k] || ctx.params[k].length<2) ctx.params[k] = "{}";
                }

                if(ctx.params[k]!=null) {
                    if(typeof ctx.params[k]=="object") {
                        ctx.params[k] = JSON.stringify(ctx.params[k]);
                    }
                    ctx.params[k] = JSON.stringify(JSON.parse(ctx.params[k]));
                }
            } catch(e) {
                ctx.params[k] = "{}";
            }
        } else if(v.split("|").indexOf("array")>=0) {
            if(Array.isArray(ctx.params[k])) ctx.params[k] = ctx.params[k].join(",");
        }
    })

    try {
        //Filter only required fields from body and remove others
        var insertData = Object.fromEntries(Object.entries(ctx.params).filter((a,b)=>input_fields[a[0]]!=null));
        //Prepare default fields like GUID, created_at, updated_at etc
        insertData = _.extend(insertData, MISC.generateDefaultDBRecord(ctx, false));
        // console.log("Insert Data", msgTitle, insertData);
        const insertId = _DB.db_insertQ1("appdb", db_table, insertData);
        if(insertId) callback({ id: insertId, message: `${msgTitle} created` });
        else callback(false, "Error creating record");
    } catch (err) {
        console.error(err);
        callback(false, { error: `Failed to create ${msgTitle}` });
    }
}

global.createDBUpdateFromRequest = function(ctx, input_fields, db_table, whereLogic, msgTitle, callback) {
    var vStatus = validateRule(ctx.params, Object.fromEntries(Object.entries(input_fields).filter(([_, value]) => value !== '')));

    if (!vStatus.status) {
        callback(false, { error: "Input Validation Failed", details: vStatus.errors });
        return;
    }

    _.each(input_fields, function(v,k) {
        if(v.split("|").indexOf("json")>=0) {
            try {
                if(v.split("|").indexOf("required")>=0) {
                    if(!ctx.params[k] || ctx.params[k].length<2) ctx.params[k] = "{}";
                }
                
                if(ctx.params[k]!=null) {
                    if(typeof ctx.params[k]=="object") {
                        ctx.params[k] = JSON.stringify(ctx.params[k]);
                    }
                    ctx.params[k] = JSON.stringify(JSON.parse(ctx.params[k]));
                }
            } catch(e) {
                ctx.params[k] = "{}";
            }
        } else if(v.split("|").indexOf("array")>=0) {
            if(Array.isArray(ctx.params[k])) ctx.params[k] = ctx.params[k].join(",");
        }
    })

    try {
        //Filter only required fields from body and remove others
        var updateData = Object.fromEntries(Object.entries(ctx.params).filter((a,b)=>input_fields[a[0]]!=null));
        //Prepare default fields like updated_at etc
        updateData = _.extend(updateData, MISC.generateDefaultDBRecord(ctx, true));
        // console.log("Update Data", msgTitle, updateData);
        _DB.db_updateQ("appdb", db_table, updateData, whereLogic, (ans, errCode, errMessage)=>{
                if(ans)
                    callback({ status: ans, message: `${msgTitle} updated`, id: whereLogic.id });
                else
                    callback(false, errMessage);
            });
    } catch (err) {
        console.error(err);
        callback(false, { error: `Failed to update ${msgTitle}` });
    }
}

global.createDBDeleteFromRequest = function(ctx, db_table, whereLogic, msgTitle, callback) {
    try {
        //Prepare default fields like updated_at etc
        var updateData = _.extend({blocked:'true'}, MISC.generateDefaultDBRecord(ctx, true));
        // console.log("Delete Data", msgTitle, updateData);
        _DB.db_updateQ("appdb", db_table, updateData, whereLogic, (ans, response)=>{
                callback({ status: ans, message: `${msgTitle} deleted`, id: whereLogic.id });
            });
    } catch (err) {
        console.error(err);
        callback(false, { error: `Failed to delete ${msgTitle}` });
    }
}
