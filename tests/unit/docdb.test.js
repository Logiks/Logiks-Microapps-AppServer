"use strict";

// _DOCDB (api/helpers/_docdb.js) with a fake driver, and MongoDBDriver's doc*() methods with a fake Db.
// No connection is made.

const DBMANAGER = require("../../api/helpers/db/DBManager");
const MongoDBDriver = require("../../api/helpers/db/drivers/MongoDBDriver");
const MySQLDriver = require("../../api/helpers/db/drivers/MySQLDriver");
const DOCDB = require("../../api/helpers/_docdb");

const hooks = [];
global.DATAMODELS = { checkHook: (...a) => hooks.push(a) };

// A recording stand-in for a mongodb Db
function fakeDb() {
	const calls = [];
	const col = (name) => ({
		insertOne: async (d) => { calls.push(["insertOne", name, d]); return { insertedId: "oid1" }; },
		insertMany: async (d) => { calls.push(["insertMany", name, d]); return { insertedIds: { 0: "o1", 1: "o2" } }; },
		updateMany: async (f, u, o) => { calls.push(["updateMany", name, f, u, o]); return { matchedCount: 2, modifiedCount: 1 }; },
		deleteMany: async (f) => { calls.push(["deleteMany", name, f]); return { deletedCount: 3 }; },
		countDocuments: async (f) => { calls.push(["count", name, f]); return 7; },
		createIndex: async (k, o) => { calls.push(["createIndex", name, k, o]); return "idx_1"; },
		aggregate: (p, o) => ({ toArray: async () => { calls.push(["aggregate", name, p, o]); return [{ _id: { a: 1 }, n: 2, at: new Date(0) }]; } }),
		find: (f, o) => ({
			sort(s) { calls.push(["sort", s]); return this; }, skip() { return this; }, limit(n) { calls.push(["limit", n]); return this; },
			toArray: async () => { calls.push(["find", name, f, o]); return [{ _id: "x1", when: new Date(0), meta: { a: 1 } }]; }
		})
	});
	return { calls, collection: col };
}

let db, mongo;

beforeEach(() => {
	hooks.length = 0;
	db = fakeDb();
	mongo = new MongoDBDriver("docs", {});
	mongo._ready = async () => db;
	DBMANAGER.drivers.docs = mongo;
	DBMANAGER.drivers.sql = new MySQLDriver("sql", {});
});

afterEach(() => {
	delete DBMANAGER.drivers.docs;
	delete DBMANAGER.drivers.sql;
});

describe("_DOCDB dispatch", () => {
	test("doc_keys lists only document-capable dbkeys", () => {
		expect(DOCDB.doc_keys()).toEqual(["docs"]);
	});

	test("a non-document dbkey is rejected and an unknown dbkey returns false", async () => {
		expect(await DOCDB.doc_select("sql", "events", {})).toMatchObject({ status: "error", err_code: "NOT_DOCUMENT_DB" });
		jest.spyOn(console, "log").mockImplementation(() => {});
		expect(await DOCDB.doc_select("nope", "events", {})).toBe(false);
	});

	test("insert: dates converted, audit stamps, nested kept, hook fired", async () => {
		const res = await DOCDB.doc_insert("docs", "events", { meta: { at: "2026-10-21 10:00:00" } }, { user: "bob" });
		expect(res).toEqual({ status: "success", count: 1, id: "oid1" });
		const doc = db.calls[0][2];
		expect(doc.meta.at).toBeInstanceOf(Date);
		expect(doc.created_by).toBe("bob");
		expect(hooks).toEqual([["events", "insert", "docs", { id: "oid1" }]]);
	});

	test("insert many returns ids", async () => {
		const res = await DOCDB.doc_insert("docs", "events", [{ a: 1 }, { a: 2 }]);
		expect(res).toEqual({ status: "success", count: 2, ids: ["o1", "o2"] });
	});

	test("update translates to Mongo operators and fires the hook", async () => {
		const res = await DOCDB.doc_update("docs", "events", { "meta.a": 1 }, { status: "done" }, { inc: { hits: 1 }, unset: ["tmp"] });
		expect(res).toEqual({ status: "success", matched: 2, modified: 1, upserted: null });
		const [, , filter, upd] = db.calls[0];
		expect(filter).toEqual({ "meta.a": 1 });
		expect(upd.$set.status).toBe("done");
		expect(upd.$inc).toEqual({ hits: 1 });
		expect(upd.$unset).toEqual({ tmp: "" });
		expect(hooks[0].slice(0, 3)).toEqual(["events", "update", "docs"]);
	});

	test("select serialises dates and ids, passes sort / columns / limit", async () => {
		const res = await DOCDB.doc_select("docs", "events", { "meta.a": 1 }, { sort: "when DESC", columns: "when, meta.a", limit: 5, count: true });
		expect(res).toEqual({ status: "success", results: [{ id: "x1", when: "1970-01-01T00:00:00.000Z", meta: { a: 1 } }], total: 7 });
		expect(db.calls.find((c) => c[0] == "sort")[1]).toEqual({ when: -1 });
		expect(db.calls.find((c) => c[0] == "limit")[1]).toBe(5);
		expect(db.calls.find((c) => c[0] == "find")[3].projection).toEqual({ when: 1, "meta.a": 1 });
	});

	test("selectOne returns a single document or null", async () => {
		expect((await DOCDB.doc_selectOne("docs", "events", {})).result).toMatchObject({ id: "x1" });
	});

	test("update and delete refuse an empty filter unless allowAll", async () => {
		expect((await DOCDB.doc_update("docs", "e", {}, { a: 1 })).err_code).toBe("FILTER_REQUIRED");
		expect((await DOCDB.doc_delete("docs", "e", {})).err_code).toBe("FILTER_REQUIRED");
		expect(await DOCDB.doc_delete("docs", "e", {}, { allowAll: true })).toEqual({ status: "success", deleted: 3 });
		expect(hooks).toHaveLength(1);
	});

	test("errors keep the envelope and fire no hook", async () => {
		expect(await DOCDB.doc_insert("docs", "$bad", { a: 1 })).toMatchObject({ status: "error", err_code: "INVALID_COLLECTION" });
		expect(await DOCDB.doc_insert("docs", "_counters", { a: 1 })).toMatchObject({ status: "error", err_code: "INVALID_COLLECTION" });
		expect(hooks).toEqual([]);
	});

	test("aggregateBy builds a flat group pipeline", async () => {
		await DOCDB.doc_aggregateBy("docs", "events", {
			where: { level: "error" }, groupBy: ["meta.service"],
			date: { field: "created_on", unit: "day", as: "day" }, metrics: { n: "count", ms: "avg:meta.ms" }
		});
		const p = db.calls[0][2];
		expect(p[0]).toEqual({ $match: { level: "error" } });
		expect(p[1].$group._id).toEqual({ meta_service: "$meta.service", day: { $dateToString: { format: "%Y-%m-%d", date: "$created_on" } } });
		expect(p[1].$group.ms).toEqual({ $avg: "$meta.ms" });
		expect(p[2].$project).toEqual({ _id: 0, meta_service: "$_id.meta_service", day: "$_id.day", n: 1, ms: 1 });
	});

	test("aggregate: $match uses filter syntax, dates converted, results serialised", async () => {
		const res = await DOCDB.doc_aggregate("docs", "events", [
			{ $match: { created_on: { $gte: "2026-10-01 00:00:00" }, level: ["a", "b"] } },
			{ $group: { _id: { a: "$a" }, last: { $max: "2026-10-21 10:00:00" } } }
		]);
		const p = db.calls[0][2];
		expect(p[0].$match.created_on.$gte).toBeInstanceOf(Date);
		expect(p[0].$match.level).toEqual({ $in: ["a", "b"] });
		expect(p[1].$group.last.$max).toBeInstanceOf(Date);
		expect(res.results[0]).toEqual({ _id: { a: 1 }, n: 2, at: "1970-01-01T00:00:00.000Z" });
	});

	test.each([
		[[{ $out: "x" }]],
		[[{ $merge: { into: "x" } }]],
		[[{ $addFields: { f: { $function: { body: "", args: [], lang: "js" } } } }]],
		[[{ $group: { _id: 1, v: { $accumulator: {} } } }]],
		[[{ $match: { $where: "1" } }]],
		[[]],
		[[{ $match: {}, $limit: 1 }]]
	])("aggregate rejects %j", async (pipeline) => {
		expect(await DOCDB.doc_aggregate("docs", "events", pipeline)).toMatchObject({ status: "error" });
		expect(db.calls).toEqual([]);
	});

	test("count, distinct and index", async () => {
		expect(await DOCDB.doc_count("docs", "events", {})).toEqual({ status: "success", count: 7 });
		expect(await DOCDB.doc_index("docs", "events", "created_on DESC", { expireAfterSeconds: 60 })).toEqual({ status: "success", name: "idx_1" });
		expect(db.calls[1].slice(2)).toEqual([{ created_on: -1 }, { expireAfterSeconds: 60 }]);
	});
});
