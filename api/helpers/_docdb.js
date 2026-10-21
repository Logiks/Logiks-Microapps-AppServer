//Document Database Helper Functions - the document-object side of the DB drivers.
//
//_DB (_db.js) works with the SQL-shaped side of a driver: tables, columns, flat where-objects.
//_DOCDB works with the document side: collections of JSON documents with nested sub objects
//(dot paths), real Date values, filters beyond flat equality, and aggregation. Both look up the
//same drivers through DBManager, so one MongoDB dbkey can be used through either.
//
//This file owns what must behave identically on every document engine: input validation and
//normalisation (api/helpers/db/DocQuery.js), audit stamps, hooks, output serialisation and the
//{status,...} envelope. The engine's native calls live in its driver's doc*() methods (contract
//in api/helpers/db/DBDriver.js). To make another NoSQL database usable here, add the driver to
//DBManager and implement supportsDocuments() + the doc*() methods - nothing in this file changes.
//
//Documents keep the engine's own id (Mongo: _id, returned as a string "id"), not the numeric
//"id" counter that _DB.db_insertQ1 adds. Do not mix both styles on one collection. Field
//encryption (DATAMODELS) is not applied to documents.
//
//Filter / update / sort syntax and date handling: see the header of api/helpers/db/DocQuery.js.
//Every function takes the dbkey first and returns:
//  { status: "success", ... }  |  { status: "error", err_code, err_message }  |  false (dbkey not connected)
//Dates come back as ISO strings and ObjectIds as strings unless options.raw is true.

const DBMANAGER = require('./db/DBManager');
const DQ = require('./db/DocQuery');

module.exports = {

	//Dbkeys whose driver supports the document API
	doc_keys : function() {
		return Object.keys(DBMANAGER.drivers).filter((k) => DBMANAGER.drivers[k].supportsDocuments());
	},

	//Insert one document, or many when data is an array.
	//options: user, timestamps (default true: created_on/edited_on + created_by/edited_by), dateFields
	doc_insert : async function(dbkey, collection, data, options = {}) {
		return await exec(dbkey, async (driver) => {
			DQ.assertCollection(collection);
			const ctx = DQ.makeCtx(options);
			const now = new Date();
			const many = Array.isArray(data);
			const list = many ? data : [data];
			if (list.length <= 0) throw new DQ.DocQueryError("DATA_NOT_FOUND", "no documents to insert");
			const docs = list.map((d) => DQ.buildDocument(d, options, ctx, now));

			const res = await driver.docInsert(collection, docs);
			if (res.error) return res;
			return { ok: many ? { count: res.ids.length, ids: res.ids } : { count: 1, id: res.ids[0] }, hook: ["insert", { id: many ? res.ids : res.ids[0] }] };
		}, collection);
	},

	//Update documents matching where.
	//data: fields to set. A nested object replaces the whole sub object, unless options.merge is
	//true, which flattens it to dot paths so sibling keys survive. Dot-path keys always work.
	//options: many (default true), upsert, merge, user, timestamps, dateFields, allowAll,
	//         inc, unset (array of paths), push, addToSet, pull, min, max  -> { "path": value }
	doc_update : async function(dbkey, collection, where, data, options = {}) {
		return await exec(dbkey, async (driver) => {
			DQ.assertCollection(collection);
			const ctx = DQ.makeCtx(options);
			const filter = DQ.buildFilter(where, ctx);
			DQ.assertScoped(filter, options);
			const update = DQ.buildUpdate(data, options, ctx);

			const res = await driver.docUpdate(collection, filter, update, { many: options.many !== false, upsert: !!options.upsert });
			if (res.error) return res;
			return { ok: { matched: res.matched, modified: res.modified, upserted: res.upsertedId }, hook: ["update", filter] };
		}, collection);
	},

	//Find documents.
	//options: columns ("a, b.c" | array | {a:1}), sort ("created_on DESC, level" | {created_on:-1}),
	//         limit (default 1000, max 10000), skip, count (also return the total matches),
	//         raw, dateFields, dateFormat (function(date) | "epoch")
	doc_select : async function(dbkey, collection, where = {}, options = {}) {
		return await exec(dbkey, async (driver) => {
			DQ.assertCollection(collection);
			const filter = DQ.buildFilter(where, DQ.makeCtx(options));

			const res = await driver.docFind(collection, filter, {
				columns: DQ.buildColumns(options.columns),
				sort: DQ.parseSort(options.sort),
				skip: options.skip,
				limit: DQ.clampLimit(options.limit)
			});
			if (res.error) return res;

			const ok = { results: DQ.serialize(res.rows, options) };
			if (options.count) {
				const total = await driver.docCount(collection, filter);
				if (total.error) return total;
				ok.total = total.count;
			}
			return { ok };
		}, collection);
	},

	//First matching document, or null
	doc_selectOne : async function(dbkey, collection, where = {}, options = {}) {
		const res = await module.exports.doc_select(dbkey, collection, where, Object.assign({}, options, { limit: 1, count: false }));
		if (!res || res.status !== "success") return res;
		return { status: "success", result: res.results[0] || null };
	},

	doc_count : async function(dbkey, collection, where = {}, options = {}) {
		return await exec(dbkey, async (driver) => {
			DQ.assertCollection(collection);
			const res = await driver.docCount(collection, DQ.buildFilter(where, DQ.makeCtx(options)));
			return res.error ? res : { ok: { count: res.count } };
		}, collection);
	},

	doc_distinct : async function(dbkey, collection, field, where = {}, options = {}) {
		return await exec(dbkey, async (driver) => {
			DQ.assertCollection(collection);
			DQ.assertPath(field);
			const res = await driver.docDistinct(collection, field, DQ.buildFilter(where, DQ.makeCtx(options)));
			return res.error ? res : { ok: { results: DQ.serialize(res.values, options) } };
		}, collection);
	},

	//Run an engine-native aggregation pipeline (array of stages) - for engines that have one.
	//$match stages use the filter syntax above. Stages that write ($out, $merge) or run server side
	//code ($function, $accumulator, $where) are rejected.
	//options: allowDiskUse, raw, dateFields, dateFormat
	doc_aggregate : async function(dbkey, collection, pipeline, options = {}) {
		return await exec(dbkey, async (driver) => {
			DQ.assertCollection(collection);
			const res = await driver.docAggregate(collection, pipeline, { allowDiskUse: options.allowDiskUse, dateFields: options.dateFields });
			return res.error ? res : { ok: { results: DQ.serialize(res.rows, options) } };
		}, collection);
	},

	//Group / summarise without writing a pipeline, on any engine that implements docGroup.
	//spec: {
	//  where:   filter (as in doc_select),
	//  groupBy: ["level", "meta.service"]                      fields, dot paths allowed
	//  date:    { field: "created_on", unit: "day", as: "day", timezone: "Asia/Kolkata" }
	//           unit: year | month | day | hour | minute, adds a time bucket to the group key
	//  metrics: { total: "count", amount: "sum:amount", slowest: "max:meta.ms" }
	//           or { avgMs: { op: "avg", field: "meta.ms" } }. Default: { count: "count" }
	//  sort:    "count DESC" | { count: -1 },  limit
	//}
	//Result rows are flat: { level, meta_service, day, count, ... } - dots in group keys become "_".
	doc_aggregateBy : async function(dbkey, collection, spec = {}, options = {}) {
		return await exec(dbkey, async (driver) => {
			DQ.assertCollection(collection);
			const res = await driver.docGroup(collection, DQ.buildGroupSpec(spec, DQ.makeCtx(options)));
			return res.error ? res : { ok: { results: DQ.serialize(res.rows, options) } };
		}, collection);
	},

	//Delete documents matching where. An empty where is refused unless options.allowAll is true.
	//options: many (default true), allowAll, dateFields
	doc_delete : async function(dbkey, collection, where, options = {}) {
		return await exec(dbkey, async (driver) => {
			DQ.assertCollection(collection);
			const filter = DQ.buildFilter(where, DQ.makeCtx(options));
			DQ.assertScoped(filter, options);

			const res = await driver.docDelete(collection, filter, { many: options.many !== false });
			if (res.error) return res;
			return { ok: { deleted: res.deleted }, hook: ["delete", filter] };
		}, collection);
	},

	//Create an index. keys: { created_on: -1 } or "created_on DESC, level"
	//options: unique, name, expireAfterSeconds (TTL index on a date field, for log retention)
	doc_index : async function(dbkey, collection, keys, options = {}) {
		return await exec(dbkey, async (driver) => {
			DQ.assertCollection(collection);
			const spec = DQ.parseSort(keys);
			if (!spec) throw new DQ.DocQueryError("INVALID_INDEX", "index keys required");

			const res = await driver.docIndex(collection, spec, options);
			return res.error ? res : { ok: { name: res.name } };
		}, collection);
	}
}

//Resolves the driver, runs work(driver) and shapes the outcome into the _DB envelope.
//work returns { ok: {...fields}, hook?: [event, data] } or a driver { error }; it may throw a DocQueryError.
async function exec(dbkey, work, collection) {
	const driver = DBMANAGER.getDriver(dbkey);
	if (driver == null) {
		console.log("\x1b[31m%s\x1b[0m", `DATABASE Not Connected for ${dbkey}`);
		return false;
	}
	if (typeof driver.supportsDocuments != "function" || !driver.supportsDocuments()) {
		return {
			"status": "error",
			"err_code": "NOT_DOCUMENT_DB",
			"err_message": `the document API is not supported by dbkey "${dbkey}" (${driver.DRIVER_NAME || "unknown driver"})`
		};
	}

	try {
		const out = await work(driver);

		if (out.error) {
			if (CONFIG.log_sql) console.log(out.error);
			return {
				"status": "error",
				"err_code": out.error.code,
				"err_message": out.error.sqlMessage
			};
		}

		if (out.hook) DATAMODELS.checkHook(collection, out.hook[0], dbkey, out.hook[1]);
		return Object.assign({ "status": "success" }, out.ok);
	} catch (err) {
		if (CONFIG.log_sql) console.log(err);
		return {
			"status": "error",
			"err_code": err.code || "DOC_ERROR",
			"err_message": err.message
		};
	}
}
