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

				const sqlQuery = QUERY.parseQuery(ctx.params.query, ctx.params.filter)
				const dbkey = sqlQuery.dbkey?sqlQuery.dbkey:(ctx.params.dbkey?ctx.params.dbkey:"appdb");
				
				var dbData = await db_query(dbkey, sqlQuery, {});

				if(!dbData) dbData = [];

				return {
					"data": dbData,
					"page": ctx.params.query.page,
					"limit": ctx.params.query.limit,
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

				const queryObj = await QUERY.getQueryByID(ctx.params.queryid);

				if(!queryObj) {
					throw new Errors.MoleculerClientError(
						"QueryID Not Found",
						404,
						"INVALID_QUERYID",
						ctx.params.queryid
					);
				}
				
				const sqlQuery = QUERY.parseQuery(queryObj, ctx.params.filter)
				var dbkey = sqlQuery.dbkey;

				if(!sqlQuery.page) sqlQuery.page = 0;
				if(!sqlQuery.limit) sqlQuery.limit = 0;

				if(ctx.params.dbkey && ctx.params.dbkey.length>0) {
					dbkey = ctx.params.dbkey;
				}
				if(!dbkey) dbkey = "appdb";

				var dbData = await db_query(dbkey, sqlQuery, {});

				if(!dbData) dbData = [];

				return {
					"data": dbData,
					"page": sqlQuery.page,
					"limit": sqlQuery.limit,
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

				const queryID = await QUERY.storeQuery(ctx.params.query);

				return {
					"status": "success",
					"queryid": queryID
				};
			}
		}
	}
};
