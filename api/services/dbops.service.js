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
                "fields": "object",
                // "forcefill": "object"
            },
            async handler(ctx) {
                if(isProd || isStaging) {
					throw new LogiksError(
						"Restricted, Only Development Environment has access to this API",
						404,
						"RESTRICTED_ENVIRONMENT"
					);
				}
                
                const dbOpsID = await DBOPS.storeDBOpsQuery(ctx.params.source, ctx.params.fields, ctx.params.operation, ctx.params.forcefill, ctx.meta.user, false);

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

                ctx.params.refid = ctx.params.refid1 ?? ctx.params.refid;

                const jsonQuery = await DBOPS.getDBOpsQuery(dbOpsID, ctx.meta.user, ctx);

                if(!jsonQuery) {
                    throw new LogiksError(
                        "Provided RefID is invalid",
                        400,
                        "INVALID_REQUEST"
                    );
                }
                // if(jsonQuery.operation!="create") {
                //     throw new LogiksError(
                //         "Error in selected operation for the RefID",
                //         400,
                //         "INVALID_REQUEST",
                //         jsonQuery.operation
                //     );
                // }

                if(jsonQuery.hooks && jsonQuery.hooks.presubmit) {
                    _.each(jsonQuery.hooks.presubmit, async function(func, k) {
                        var a1 = await _call(func, {"data": dataFields, "operation": "insert"});
                        if(a1===false) {
                            throw new LogiksError(
                                "Invalid data or wrong record submited",
                                400,
                                "INVALID_REQUEST"
                            );
                        }
                        if(!a1) dataFields = a1;
                    });
                }
                
                const sqlTable = jsonQuery.source.table;
                const sqlFields = filterNoDbNoSave(jsonQuery.fields);
                var forcefill = jsonQuery.forcefill;
                const userInfo = jsonQuery.userInfo;
                const validationRules = convertToValidatorRules(sqlFields, "create");

                var vStatus = VALIDATIONS.validateRule(dataFields, validationRules);
                
                if (!vStatus.status) {
                    throw new LogiksError(
                        "Input Validation Failed",
                        400,
                        "VALIDATION_ERROR",
                        vStatus.errors
                    );
                }
                dataFields = _.extend(dataFields, MISC.generateDefaultDBRecord(ctx, false));
                // console.log(dataFields, MISC.generateDefaultDBRecord(ctx, false));
                //Single Insert

                var forcefillData = await ENV.fetchEnvInfo(ctx.meta);
                forcefillData = _.extend(forcefillData, ctx.params);
                forcefill = QUERY.updateWhereFromEnv(forcefill, forcefillData);
                if(forcefill && Object.keys(forcefill).length>0) dataFields = _.extend(dataFields, forcefill);

                const dbResponse = await _DB.db_insertQ1("appdb", sqlTable, dataFields);
                const insertId = dbResponse.insertId;

                if(!insertId) {
                    throw new LogiksError(
                        "Error creating db record",
                        400,
                        "DB_ERROR",
                    );
                }

                if(jsonQuery.hooks && jsonQuery.hooks.postsubmit) {
                    _.each(jsonQuery.hooks.postsubmit, function(func, k) {
                        _call(func, {"id": insertId, "data": dataFields, "operation": "insert"});
                    });
                }
                ctx.emit("dbops.create", {"id": insertId, "data": dataFields, "operation": "insert", "json": jsonQuery, dbOpsID: dbOpsID, "user": ctx.meta.user});
                
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

                ctx.params.refid = ctx.params.refid1 ?? ctx.params.refid;

                const jsonQuery = await DBOPS.getDBOpsQuery(dbOpsID, ctx.meta.user, ctx);

                if(!jsonQuery) {
                    throw new LogiksError(
                        "Provided RefID is invalid",
                        400,
                        "INVALID_REQUEST"
                    );
                }
                // if(jsonQuery.operation!="create") {
                //     throw new LogiksError(
                //         "Error in selected operation for the RefID",
                //         400,
                //         "INVALID_REQUEST",
                //         jsonQuery.operation
                //     );
                // }

                if(jsonQuery.hooks && jsonQuery.hooks.presubmit) {
                    _.each(jsonQuery.hooks.presubmit, async function(func, k) {
                        var a1 = await _call(func, {"data": dataFields, "operation": "bulk"});
                        if(a1===false) {
                            throw new LogiksError(
                                "Invalid data or wrong record submited",
                                400,
                                "INVALID_REQUEST"
                            );
                        }
                        if(!a1) dataFields = a1;
                    });
                }
                
                const sqlTable = jsonQuery.source.table;
                const sqlFields = filterNoDbNoSave(jsonQuery.fields);
                var forcefill = jsonQuery.forcefill;
                const userInfo = jsonQuery.userInfo;
                const validationRules = convertToValidatorRules(sqlFields);
                
                var forcefillData = await ENV.fetchEnvInfo(ctx.meta);
                forcefillData = _.extend(forcefillData, ctx.params);
                forcefill = QUERY.updateWhereFromEnv(forcefill, forcefillData);

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
                            400,
                            "VALIDATION_ERROR",
                            errors
                        );
                    }

                    _.each(dataFields, function(data, k) {
                        dataFields[k] = _.extend(data, MISC.generateDefaultDBRecord(ctx, false));
                        
                        if(forcefill && Object.keys(forcefill).length>0) dataFields[k] = _.extend(dataFields[k], forcefill);
                    });

                    //Bulk Insert
                    const dbResponse = await _DB.db_insert_batchQ("appdb", sqlTable, dataFields);

                    if(jsonQuery.hooks && jsonQuery.hooks.postsubmit) {
                        _.each(jsonQuery.hooks.postsubmit, function(func, k) {
                            _call(func, {"response": dbResponse, "operation": "insert_bulk"});
                        });
                    }

                    ctx.emit("dbops.bulk", {"response": dbResponse, "data": dataFields, "operation": "bulk", "json": jsonQuery, dbOpsID: dbOpsID, "user": ctx.meta.user});

                    return dbResponse;
                } else {
                    throw new LogiksError(
                        "Fields should be an array of valid data",
                        400,
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

                ctx.params.refid = ctx.params.refid1 ?? ctx.params.refid;

                const jsonQuery = await DBOPS.getDBOpsQuery(dbOpsID, ctx.meta.user, ctx);

                if(!jsonQuery) {
                    throw new LogiksError(
                        "Provided RefID is invalid",
                        400,
                        "INVALID_REQUEST"
                    );
                }
                // if(jsonQuery.operation!="update") {
                //     throw new LogiksError(
                //         "Error in selected operation for the RefID",
                //         400,
                //         "INVALID_REQUEST",
                //         jsonQuery.operation
                //     );
                // }

                const sqlTable = jsonQuery.source.table;
                var sqlWhere = jsonQuery.source.where;
                const sqlRefid = jsonQuery.source.refid;
                var sqlFields = filterNoDbNoSave(jsonQuery.fields);

                if(!sqlWhere || Array.isArray(sqlWhere)) sqlWhere = {};
                if(sqlRefid) {
                    sqlWhere = _.extend(sqlWhere, {
                        "id": sqlRefid
                    });
                } else {
                    throw new LogiksError(
                        "Which record to update/delete/fetch is not defined",
                        400,
                        "VALIDATION_ERROR"
                    );
                }
                if(!sqlTable) {
                    throw new LogiksError(
                        "Unable to find the Table to work on",
                        400,
                        "VALIDATION_ERROR"
                    );
                }

                if(formFields) {
                    if(typeof formFields == "string") formFields = formFields.split(",");
                    else if(!Array.isArray(formFields) && typeof formFields == "object") formFields = Object.keys(formFields);

                    sqlFields = formFields;
                }

                if(!Array.isArray(sqlFields) && typeof sqlFields == "object") {
                    sqlFields = Object.keys(sqlFields);
                }

                if(!sqlFields || sqlFields.length<=0) sqlFields = "*";

                // sqlWhere = QUERY.updateWhereFromEnv(sqlWhere, await ENV.fetchEnvInfo(ctx.meta));
                var sqlWhereData = await ENV.fetchEnvInfo(ctx.meta);
                sqlWhereData = _.extend(sqlWhereData, ctx.params);
                sqlWhere = QUERY.updateWhereFromEnv(sqlWhere, sqlWhereData);
                
                const dbResponse = await _DB.db_selectQ("appdb", sqlTable, sqlFields, sqlWhere, {}, " LIMIT 1");
                
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

                ctx.params.refid = ctx.params.refid1 ?? ctx.params.refid;

                const jsonQuery = await DBOPS.getDBOpsQuery(dbOpsID, ctx.meta.user, ctx);

                if(!jsonQuery) {
                    throw new LogiksError(
                        "Provided RefID is invalid",
                        400,
                        "INVALID_REQUEST"
                    );
                }
                // if(jsonQuery.operation!="update") {
                //     throw new LogiksError(
                //         "Error in selected operation for the RefID",
                //         400,
                //         "INVALID_REQUEST",
                //         jsonQuery.operation
                //     );
                // }

                if(jsonQuery.hooks && jsonQuery.hooks.presubmit) {
                    _.each(jsonQuery.hooks.presubmit, async function(func, k) {
                        var a1 = await _call(func, {"data": dataFields, "operation": "update"});
                        if(a1===false) {
                            throw new LogiksError(
                                "Invalid data or wrong record submited",
                                400,
                                "INVALID_REQUEST"
                            );
                        }
                        if(!a1) dataFields = a1;
                    });
                }

                const sqlTable = jsonQuery.source.table;
                var sqlWhere = jsonQuery.source.where;
                const sqlFields = filterNoDbNoSave(jsonQuery.fields);
                var forcefill = jsonQuery.forcefill;
                const userInfo = jsonQuery.userInfo;
                var sqlRefid = jsonQuery.source.refid;

                sqlRefid = ctx.params.refid1 ?? jsonQuery.source.refid;

                _.each(sqlFields, function(conf, field) {
                    if(!dataFields[field]) delete sqlFields[field];
                });
                const validationRules = convertToValidatorRules(sqlFields);

                var vStatus = VALIDATIONS.validateRule(dataFields, validationRules);
                
                if (!vStatus.status) {
                    throw new LogiksError(
                        "Input Validation Failed",
                        400,
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
                        400,
                        "VALIDATION_ERROR",
                        vStatus.errors
                    );
                }

                // sqlWhere = QUERY.updateWhereFromEnv(sqlWhere, await ENV.fetchEnvInfo(ctx.meta));
                var sqlWhereData = await ENV.fetchEnvInfo(ctx.meta);
                sqlWhereData = _.extend(sqlWhereData, ctx.params);
                sqlWhere = QUERY.updateWhereFromEnv(sqlWhere, sqlWhereData);
                
                const dbResponse = await _DB.db_updateQ("appdb", sqlTable, dataFields, sqlWhere);

                if(jsonQuery.hooks && jsonQuery.hooks.postsubmit) {
                    _.each(jsonQuery.hooks.postsubmit, function(func, k) {
                        _call(func, {"where": sqlWhere, "data": dataFields, "operation": "update"});
                    });
                }

                ctx.emit("dbops.update", {"where": sqlWhere, "data": dataFields, "operation": "update", "json": jsonQuery, dbOpsID: dbOpsID, "user": ctx.meta.user});
                
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

                ctx.params.refid = ctx.params.refid1 ?? ctx.params.refid;

                var filter = ctx.params.filter?ctx.params.filter:{};
                const jsonQuery = await DBOPS.getDBOpsQuery(dbOpsID, ctx.meta.user, ctx);

                if(!jsonQuery) {
                    throw new LogiksError(
                        "Provided RefID is invalid",
                        400,
                        "INVALID_REQUEST"
                    );
                }
                // if(jsonQuery.operation!="update" && jsonQuery.operation!="delete") {
                //     throw new LogiksError(
                //         "Error in selected operation for the RefID",
                //         400,
                //         "INVALID_REQUEST",
                //         jsonQuery.operation
                //     );
                // }

                if(jsonQuery.hooks && jsonQuery.hooks.presubmit) {
                    _.each(jsonQuery.hooks.presubmit, async function(func, k) {
                        var a1 = await _call(func, {"data": dataFields, "operation": "delete"});
                        if(a1===false) {
                            throw new LogiksError(
                                "Invalid data or wrong record submited",
                                400,
                                "INVALID_REQUEST"
                            );
                        }
                        if(!a1) dataFields = a1;
                    });
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
                        400,
                        "VALIDATION_ERROR",
                        vStatus.errors
                    );
                }
                
                // sqlWhere = QUERY.updateWhereFromEnv(sqlWhere, await ENV.fetchEnvInfo(ctx.meta));
                var sqlWhereData = await ENV.fetchEnvInfo(ctx.meta);
                sqlWhereData = _.extend(sqlWhereData, ctx.params);
                sqlWhere = QUERY.updateWhereFromEnv(sqlWhere, sqlWhereData);

                const dbResponse = await _DB.db_updateQ("appdb", sqlTable, _.extend( {"blocked": "true"}, MISC.generateDefaultDBRecord(ctx, true)), sqlWhere);

                if(jsonQuery.hooks && jsonQuery.hooks.postsubmit) {
                    _.each(jsonQuery.hooks.postsubmit, function(func, k) {
                        _call(func, {"where": sqlWhere, "data": {}, "operation": "delete"});
                    });
                }

                ctx.emit("dbops.delete", {"where": sqlWhere, "data": dataFields, "operation": "delete", "json": jsonQuery, dbOpsID: dbOpsID, "user": ctx.meta.user});

                return dbResponse;
            }
        }
    },
    methods: {
        getDBOpsHash(ctx) {
            return ctx.meta.user.secure_hash?ctx.meta.user.secure_hash:UNIQUEID.generate(16);
        }
    }
}


function filterNoDbNoSave(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([key, field]) => {
      return field.nodb !== true && field.nosave !== true;
    })
  );
}