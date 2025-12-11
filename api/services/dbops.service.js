"use strict";

//To be used by LRC/DataControl Components

module.exports = {
	name: "dbops",

	actions: {
        start: {
            rest: {
				method: "GET",
				path: "/"
			},
            async handler(ctx) {
                return {
                    "status": "success",
                    "refhash": this.getDBOpsHash(ctx)
                };
            }
        },
        save: {
            rest: {
				method: "POST",
				path: "/save"
			},
            params: {
                "operation": "string",
                "source": "object",
                "fields": "object"
            },
            async handler(ctx) {
                const dbOpsID = await DBOPS.storeDBOpsQuery(ctx.params.source, ctx.params.fields, ctx.params.operation, ctx.meta.user);

                return {
                    "status": "success",
                    "refid": dbOpsID
                };
            }
        },
        create: {
			rest: {
				method: "POST",
				path: "/create"
			},
            params: {
                "refid": "string",
                "fields": "object",
                "datahash": "string"
            },
            async handler(ctx) {
                const dbOpsID = ctx.params.refid;
                const dbOpsHash = ctx.params.datahash;
                var dataFields = ctx.params.fields;
                const jsonQuery = await DBOPS.getDBOpsQuery(dbOpsID, ctx.meta.user);

                if(!jsonQuery) {
                    throw new LogiksError(
                        "Provided RefID is invalid",
                        401,
                        "INVALID_REQUEST"
                    );
                }
                if(jsonQuery.operation!="create") {
                    throw new LogiksError(
                        "Error in selected operation for the RefID",
                        401,
                        "INVALID_REQUEST",
                        jsonQuery.operation
                    );
                }
                
                const sqlTable = jsonQuery.source.table;
                const sqlFields = jsonQuery.fields;
                const validationRules = convertToValidatorRules(sqlFields);

                var vStatus = VALIDATIONS.validateRule(dataFields, validationRules);
                
                if (!vStatus.status) {
                    throw new LogiksError(
                        "Input Validation Failed",
                        401,
                        "VALIDATION_ERROR",
                        vStatus.errors
                    );
                }
                dataFields = _.extend(dataFields, MISC.generateDefaultDBRecord(ctx, false));
                console.log(dataFields, MISC.generateDefaultDBRecord(ctx, false));
                //Single Insert

                const dbResponse = await _DB.db_insertQ1("appdb", sqlTable, dataFields);
                const insertId = dbResponse.insertId;

                if(!insertId) {
                    throw new LogiksError(
                        "Error creating db record",
                        401,
                        "DB_ERROR"
                    );
                }
                
                return {
                    "status": "success",
                    "refid": insertId
                };
            }
        },
        bulk: {
			rest: {
				method: "POST",
				path: "/bulk"
			},
            params: {
                "refid": "string",
                "fields": "array",
                "datahash": "string"
            },
            async handler(ctx) {
                const dbOpsID = ctx.params.refid;
                const dbOpsHash = ctx.params.datahash;
                var dataFields = ctx.params.fields;
                const jsonQuery = await DBOPS.getDBOpsQuery(dbOpsID, ctx.meta.user);

                if(!jsonQuery) {
                    throw new LogiksError(
                        "Provided RefID is invalid",
                        401,
                        "INVALID_REQUEST"
                    );
                }
                if(jsonQuery.operation!="create") {
                    throw new LogiksError(
                        "Error in selected operation for the RefID",
                        401,
                        "INVALID_REQUEST",
                        jsonQuery.operation
                    );
                }
                
                const sqlTable = jsonQuery.source.table;
                const sqlFields = jsonQuery.fields;
                const validationRules = convertToValidatorRules(sqlFields);

                if(Array.isArray(dataFields)) {
                    var errors = {};
                    _.each(dataFields, function(data, k) {
                        var vStatus = VALIDATIONS.validateRule(data, validationRules); 

                        if (!vStatus.status) {
                            errors[k] = vStatus.errors;
                        }
                    });

                    if(Object.keys(errors).length>0) {
                        throw new LogiksError(
                            "Input Validation Failed some of the data",
                            401,
                            "VALIDATION_ERROR",
                            errors
                        );
                    }

                    _.each(dataFields, function(data, k) {
                        dataFields[k] = _.extend(data, MISC.generateDefaultDBRecord(ctx, false));
                    });

                    //Bulk Insert
                    const dbResponse = await db_insert_batchQ("appdb", sqlTable, dataFields);

                    return dbResponse;
                } else {
                    throw new LogiksError(
                        "Fields should be an array of valid data",
                        401,
                        "INVALID_REQUEST"
                    );
                }
            }
        },
        fetchSingle: {
            rest: {
				method: "POST",
				path: "/fetch"
			},
            params: {
                "refid": "string",
                "datahash": "string"
            },
            async handler(ctx) {
                const dbOpsID = ctx.params.refid;
                const dbOpsHash = ctx.params.datahash;
                var formFields = ctx.params.fields;
                const jsonQuery = await DBOPS.getDBOpsQuery(dbOpsID, ctx.meta.user);

                if(!jsonQuery) {
                    throw new LogiksError(
                        "Provided RefID is invalid",
                        401,
                        "INVALID_REQUEST"
                    );
                }
                // if(jsonQuery.operation!="update") {
                //     throw new LogiksError(
                //         "Error in selected operation for the RefID",
                //         401,
                //         "INVALID_REQUEST",
                //         jsonQuery.operation
                //     );
                // }

                const sqlTable = jsonQuery.source.table;
                var sqlWhere = jsonQuery.source.where;
                const sqlRefid = jsonQuery.source.refid;
                var sqlFields = jsonQuery.fields;

                if(!sqlWhere || Array.isArray(sqlWhere)) sqlWhere = {};
                if(sqlRefid) {
                    sqlWhere = _.extend(sqlWhere, {
                        "id": sqlRefid
                    });
                } else {
                    throw new LogiksError(
                        "Which record to update is not defined",
                        401,
                        "VALIDATION_ERROR",
                        vStatus.errors
                    );
                }

                if(formFields) {
                    if(typeof formFields == "string") formFields = formFields.split(",");
                    else if(!Array.isArray(formFields) && typeof formFields == "object") formFields = Object.keys(formFields);

                    sqlFields = formFields;
                }
                CONFIG.log_sql = true;
                const dbResponse = await _DB.db_selectQ("appdb", sqlTable, sqlFields, sqlWhere, {}, " LIMIT 1");
                console.log("dbResponse", dbResponse);
                if(!dbResponse.results) return dbResponse;
                else return dbResponse.results[0];
            }
        },
        update: {
			rest: {
				method: "POST",
				path: "/update"
			},
            params: {
                "refid": "string",
                "fields": "object",
                "datahash": "string"
            },
            async handler(ctx) {
                const dbOpsID = ctx.params.refid;
                const dbOpsHash = ctx.params.datahash;
                var dataFields = ctx.params.fields;
                const jsonQuery = await DBOPS.getDBOpsQuery(dbOpsID, ctx.meta.user);

                if(!jsonQuery) {
                    throw new LogiksError(
                        "Provided RefID is invalid",
                        401,
                        "INVALID_REQUEST"
                    );
                }
                if(jsonQuery.operation!="update") {
                    throw new LogiksError(
                        "Error in selected operation for the RefID",
                        401,
                        "INVALID_REQUEST",
                        jsonQuery.operation
                    );
                }

                const sqlTable = jsonQuery.source.table;
                var sqlWhere = jsonQuery.source.where;
                const sqlFields = jsonQuery.fields;
                const sqlRefid = jsonQuery.source.refid;

                _.each(sqlFields, function(conf, field) {
                    if(!dataFields[field]) delete sqlFields[field];
                });
                const validationRules = convertToValidatorRules(sqlFields);

                var vStatus = VALIDATIONS.validateRule(dataFields, validationRules);
                
                if (!vStatus.status) {
                    throw new LogiksError(
                        "Input Validation Failed",
                        401,
                        "VALIDATION_ERROR",
                        vStatus.errors
                    );
                }
                dataFields = _.extend(dataFields, MISC.generateDefaultDBRecord(ctx, true));
                
                //Single Update
                if(!sqlWhere || Array.isArray(sqlWhere)) sqlWhere = {};
                if(sqlRefid) {
                    sqlWhere = _.extend(sqlWhere, {
                        "id": sqlRefid
                    });
                } else {
                    throw new LogiksError(
                        "Which record to update is not defined",
                        401,
                        "VALIDATION_ERROR",
                        vStatus.errors
                    );
                }
                
                const dbResponse = await _DB.db_updateQ("appdb", sqlTable, dataFields, sqlWhere);
                
                return dbResponse;
            }
        },
        delete: {
			rest: {
				method: "POST",
				path: "/delete"
			},
            params: {
                "refid": "string",
                "filter": "object",
                "datahash": "string"
            },
            async handler(ctx) {
                const dbOpsID = ctx.params.refid;
                const dbOpsHash = ctx.params.datahash;
                var dataFields = ctx.params.fields;
                var filter = ctx.params.filter?ctx.params.filter:{};
                const jsonQuery = await DBOPS.getDBOpsQuery(dbOpsID, ctx.meta.user);

                if(!jsonQuery) {
                    throw new LogiksError(
                        "Provided RefID is invalid",
                        401,
                        "INVALID_REQUEST"
                    );
                }
                if(jsonQuery.operation!="update" && jsonQuery.operation!="delete") {
                    throw new LogiksError(
                        "Error in selected operation for the RefID",
                        401,
                        "INVALID_REQUEST",
                        jsonQuery.operation
                    );
                }

                const sqlTable = jsonQuery.source.table;
                var sqlWhere = jsonQuery.source.where;
                const sqlRefid = jsonQuery.source.refid;

                if(!sqlWhere || Array.isArray(sqlWhere)) sqlWhere = {};
                if(!filter || Array.isArray(filter)) filter = {};
                if(sqlRefid) {
                    sqlWhere = _.extend(filter, sqlWhere, {
                        "id": sqlRefid
                    });
                } else {
                    throw new LogiksError(
                        "Which record to delete is not defined",
                        401,
                        "VALIDATION_ERROR",
                        vStatus.errors
                    );
                }

                const dbResponse = await _DB.db_updateQ("appdb", sqlTable, _.extend( {"blocked": "true"}, MISC.generateDefaultDBRecord(ctx, true)), sqlWhere);

                return dbResponse;
            }
        }
    },
    methods: {
        getDBOpsHash(ctx) {
            return ctx.meta.user.secure_hash;
        }
    }
}