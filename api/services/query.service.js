"use strict";

module.exports = {
	name: "query",

	actions: {
		//Direct Query through API, will need Restricted API Access
		query: {
			rest: {
				method: "POST",
				path: "/"
			},
            params: {
				// dbkey: "string",
                query: "object",
				// filter: "object",
            },
			async handler(ctx) {
				//Add additioanl restrictions for running the queries recieved through this channel
				// if(isProd || isStaging) {
				// 	throw new LogiksError(
				// 		"Restricted, Only Development Environment has access to this API",
				// 		404,
				// 		"RESTRICTED_ENVIRONMENT"
				// 	);
				// }
				
				if(!ctx.params.dbkey) ctx.params.dbkey = "appdb";
				if(!ctx.params.filter) ctx.params.filter = {};

				var queryObj = ctx.params.query;

				if(!ctx.params.query.page) ctx.params.query.page = 0;
				if(!ctx.params.query.limit) ctx.params.query.limit = 0;

				var queryObjCount = _.cloneDeep(queryObj);
				queryObjCount.column = "count(*) as count";

				if(ctx.params.page) queryObj.page = ctx.params.page;
				if(ctx.params.limit) queryObj.limit = ctx.params.limit;
				if(ctx.params.orderby) queryObj.orderby = ctx.params.orderby;
				if(ctx.params.groupby) queryObj.groupby = ctx.params.groupby;

				try {
					queryObj.offset = parseInt(queryObj.page)*parseInt(ctx.params.limit);
				} catch(e) {
					queryObj.offset = 0;
				}

				queryObjCount.offset = 0;

				const sqlQuery = await QUERY.parseQuery(queryObj, ctx.params.filter, _.extend({}, ctx.params, ctx.meta));
				const sqlQueryCount = await QUERY.parseQuery(queryObjCount, ctx.params.filter, _.extend({}, ctx.params, ctx.meta))

				const dbkey = queryObj.dbkey?queryObj.dbkey:(ctx.params.dbkey?ctx.params.dbkey:"appdb");
				
				const dbResponse = await _DB.db_query(dbkey, sqlQuery, {});
				const dbData = dbResponse?.results || [];

				const dbResponseCount = await _DB.db_query(dbkey, sqlQueryCount, {});
				const dbDataCount = dbResponseCount?.results || [{".count": 0}];

				return {
					"data": dbData,
					"err_code": dbResponse.err_code,
					"err_message": dbResponse.err_message,
					"page": ctx.params.query.page,
					"limit": ctx.params.query.limit,
					"max": dbDataCount[0]['count'] || dbDataCount[0]['.count'] || 0
				};
			}
		},
		queryRaw: {
			rest: {
				method: "POST",
				path: "/raw"
			},
            params: {
				// dbkey: "string",
                query: "object",
				// filter: "object",
            },
			async handler(ctx) {
				if(isProd || isStaging) {
					throw new LogiksError(
						"Restricted, Only Development Environment has access to this API",
						404,
						"RESTRICTED_ENVIRONMENT"
					);
				}
				if(!ctx.params.dbkey) ctx.params.dbkey = "appdb";
				if(!ctx.params.filter) ctx.params.filter = {};

				if(!ctx.params.query.page) ctx.params.query.page = 0;
				if(!ctx.params.query.limit) ctx.params.query.limit = 0;

				const sqlQuery = await QUERY.parseQuery(ctx.params.query, ctx.params.filter, _.extend({}, ctx.params, ctx.meta));

				return {
					"QUERY": sqlQuery
				};
			}
		},
		viewquery: {
			rest: {
				method: "POST",
				path: "/view"
			},
            params: {
				// dbkey: "string",
				queryid: "string",
                filter: "object"
				// page
				// limit
				// orderby
				// groupby
            },
			async handler(ctx) {
				if(isProd || isStaging) {
					throw new LogiksError(
						"Restricted, Only Development Environment has access to this API",
						404,
						"RESTRICTED_ENVIRONMENT"
					);
				}

				if(!ctx.params.filter) ctx.params.filter = {};

				ctx.params.refid = ctx.params.refid1 ?? ctx.params.refid;

				const queryObj = await QUERY.getQueryByID(ctx.params.queryid, ctx.meta.user, ctx);

				if(!queryObj) {
					throw new LogiksError(
						"QueryID Not Found",
						404,
						"INVALID_QUERYID",
						ctx.params.queryid
					);
				}

				if(!queryObj.page) queryObj.page = 0;
				if(!queryObj.limit) queryObj.limit = 0;

				if(ctx.params.page) queryObj.page = ctx.params.page;
				if(ctx.params.limit) queryObj.limit = ctx.params.limit;
				if(ctx.params.orderby) queryObj.orderby = ctx.params.orderby;
				if(ctx.params.groupby) queryObj.groupby = ctx.params.groupby;

				return {
					"query": queryObj
				};
			}
		},
		storeQuery: {
			rest: {
				method: "POST",
				path: "/save"
			},
            params: {
				// dbkey: "string",
				query: "object",
				srcid: "string",
				// moduleid: "string",
            },
			async handler(ctx) {
				if(isProd || isStaging) {
					throw new LogiksError(
						"Restricted, Only Development Environment has access to this API",
						404,
						"RESTRICTED_ENVIRONMENT"
					);
				}
				if(!ctx.params.dbkey) ctx.params.dbkey = "appdb";

				ctx.params.query['dbkey'] = ctx.params.dbkey;

				var srcId = ctx.params.srcid.split(".");
				const moduleId = srcId[0];
				// var tblArr = ctx.params.query.table.split("_");

				const queryID = await QUERY.storeQuery(ctx.params.query, ctx.meta.user, false, {moduleId: moduleId, objId: ctx.params.srcid});

				return {
					"status": "success",
					"queryid": queryID
				};
			}
		},

		//Run Query
		queryid: {
			rest: {
				method: "POST",
				path: "/run"
			},
            params: {
				// dbkey: "string",
				queryid: "string",
                filter: "object"
				// page
				// limit
				// orderby
				// groupby
            },
			async handler(ctx) {
				if(!ctx.params.filter) ctx.params.filter = {};

				ctx.params.refid = ctx.params.refid1 ?? ctx.params.refid;

				var queryObjOne = await QUERY.getQueryByID(ctx.params.queryid, ctx.meta.user, ctx);

				if(!queryObjOne) {
					const queryObj = QUERY.getSavedQuery(ctx.params.queryid, ctx);
					if(!queryObj) {
						throw new LogiksError(
							"QueryID Not Found",
							404,
							"INVALID_QUERYID",
							ctx.params.queryid
						);
					}
					queryObjOne = queryObj.json_query;
					queryObjOne.dbkey = (queryObj.dbkey!="*"?queryObj.dbkey:"appdb");
					ctx.params = _.extend(ctx.params, queryObj.params || {});
					
					if(!isPord) ctx.params.DEBUG = queryObj.debug;
				}

				var queryObj = _.cloneDeep(queryObjOne);

				if(!queryObj.page) queryObj.page = 0;
				if(!queryObj.limit) queryObj.limit = 0;

				var queryObjCount = _.cloneDeep(queryObj);
				queryObjCount.column = "count(*) as count";

				if(ctx.params.page) queryObj.page = ctx.params.page;
				if(ctx.params.limit) queryObj.limit = ctx.params.limit;
				if(ctx.params.orderby) queryObj.orderby = ctx.params.orderby;
				if(ctx.params.groupby) queryObj.groupby = ctx.params.groupby;

				try {
					queryObj.offset = parseInt(queryObj.page)*parseInt(ctx.params.limit);
				} catch(e) {
					queryObj.offset = 0;
				}

				queryObjCount.offset = 0;

				const sqlQuery = await QUERY.parseQuery(queryObj, ctx.params.filter, _.extend({}, ctx.params, ctx.meta));
				const sqlQueryCount = await QUERY.parseQuery(queryObjCount, ctx.params.filter, _.extend({}, ctx.params, ctx.meta));
				var dbkey = queryObj.dbkey;

				if(ctx.params.dbkey && ctx.params.dbkey.length>0) {
					dbkey = ctx.params.dbkey;
				}
				if(!dbkey) dbkey = "appdb";

				const dbResponse = await _DB.db_query(dbkey, sqlQuery, {});
				const dbData = dbResponse?.results || [];

				const dbResponseCount = await _DB.db_query(dbkey, sqlQueryCount, {});
				const dbDataCount = dbResponseCount?.results || [{".count": 0}];

				return {
					"data": dbData,
					"err_code": dbResponse.err_code,
					"err_message": dbResponse.err_message,
					"page": queryObj.page,
					"limit": queryObj.limit,
					"max": (dbDataCount && dbDataCount[0])?(dbDataCount[0]['count'] || dbDataCount[0]['.count'] || 0):0
				};
			}
		}
	}
};
