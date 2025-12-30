"use strict";

module.exports = {
	name: "query",

	actions: {
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
				if(!ctx.params.dbkey) ctx.params.dbkey = "appdb";
				if(!ctx.params.filter) ctx.params.filter = {};

				if(!ctx.params.query.page) ctx.params.query.page = 0;
				if(!ctx.params.query.limit) ctx.params.query.limit = 0;

				const sqlQuery = await QUERY.parseQuery(ctx.params.query, ctx.params.filter, _.extend({}, ctx.params, ctx.meta))
				const dbkey = sqlQuery.dbkey?sqlQuery.dbkey:(ctx.params.dbkey?ctx.params.dbkey:"appdb");
				
				const dbResponse = await _DB.db_query(dbkey, sqlQuery, {});
				const dbData = dbResponse?.results || [];

				return {
					"data": dbData,
					"err_code": dbResponse.err_code,
					"err_message": dbResponse.err_message,
					"page": ctx.params.query.page,
					"limit": ctx.params.query.limit,
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
		queryid: {
			rest: {
				method: "POST",
				path: "/run"
			},
            params: {
				// dbkey: "string",
				queryid: "string",
                filter: "object"
            },
			async handler(ctx) {
				if(!ctx.params.filter) ctx.params.filter = {};

				const queryObj = await QUERY.getQueryByID(ctx.params.queryid, ctx.params.user);

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
				
				const sqlQuery = await QUERY.parseQuery(queryObj, ctx.params.filter, _.extend({}, ctx.params, ctx.meta));
				var dbkey = queryObj.dbkey;

				if(ctx.params.dbkey && ctx.params.dbkey.length>0) {
					dbkey = ctx.params.dbkey;
				}
				if(!dbkey) dbkey = "appdb";

				const dbResponse = await _DB.db_query(dbkey, sqlQuery, {});
				const dbData = dbResponse?.results || [];

				return {
					"data": dbData,
					"err_code": dbResponse.err_code,
					"err_message": dbResponse.err_message,
					"page": queryObj.page,
					"limit": queryObj.limit,
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
            },
			async handler(ctx) {
				if(!ctx.params.dbkey) ctx.params.dbkey = "appdb";

				ctx.params.query['dbkey'] = ctx.params.dbkey;

				const queryID = await QUERY.storeQuery(ctx.params.query, ctx.params.user);

				return {
					"status": "success",
					"queryid": queryID
				};
			}
		}
	}
};
