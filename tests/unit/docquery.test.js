"use strict";

// DocQuery: engine-neutral filter / update / group normalisation. No driver, no connection.

const DQ = require("../../api/helpers/db/DocQuery");

const filter = (where, options = {}) => DQ.buildFilter(where, DQ.makeCtx(options));
const update = (data, options = {}) => DQ.buildUpdate(data, options, DQ.makeCtx(options));

describe("filters", () => {
	test("flat equality, list and null", () => {
		expect(filter({ level: "error", tag: ["a", "b"], gone: null }))
			.toEqual({ level: "error", tag: { $in: ["a", "b"] }, gone: null });
	});

	test("dot paths reach JSON sub objects", () => {
		expect(filter({ "meta.user.id": "u1", "meta.retry": { $gt: 3 } }))
			.toEqual({ "meta.user.id": "u1", "meta.retry": { $gt: 3 } });
	});

	test("[value, operator] pairs", () => {
		expect(filter({ a: [1, "!="], b: [[1, 2], "in"], c: ["x%", "LIKE"], d: [true, "EXISTS"] })).toEqual({
			a: { $ne: 1 }, b: { $in: [1, 2] }, c: { $regex: "^x.*$" }, d: { $exists: true }
		});
	});

	test("ISO and datetime strings become Dates", () => {
		const f = filter({ created_on: { $gte: "2026-10-01 10:30:00", $lt: "2026-11-01T00:00:00Z" } });
		expect(f.created_on.$gte).toBeInstanceOf(Date);
		expect(f.created_on.$lt.toISOString()).toBe("2026-11-01T00:00:00.000Z");
	});

	test("bare dates convert only on date-like fields", () => {
		const f = filter({ created_on: "2026-10-01", note: "2026-10-01", code: "2026-10-01" }, { dateFields: ["code"] });
		expect(f.created_on).toBeInstanceOf(Date);
		expect(f.note).toBe("2026-10-01");
		expect(f.code).toBeInstanceOf(Date);
	});

	test("BETWEEN with date-only bounds covers the whole end day", () => {
		const { created_on } = filter({ created_on: [["2026-10-01", "2026-10-21"], "BETWEEN"] });
		expect(created_on.$gte.getHours()).toBe(0);
		expect(created_on.$lte.getHours()).toBe(23);
		expect(created_on.$lte.getMilliseconds()).toBe(999);
	});

	test("$or recurses", () => {
		expect(filter({ $or: [{ level: "error" }, { "meta.ms": { $gt: 5 } }] }).$or).toHaveLength(2);
	});

	test.each([
		[{ $where: "1" }],
		[{ a: { $function: {} } }],
		[{ a: { $ne: { $gt: 1 } } }],
		[{ "a b": 1 }],
		[{ "__proto__.x": 1 }],
		[{ a: { $regex: "(a+)+" } }],
		[{ a: [["x"], "BETWEEN"] }]
	])("rejects %j", (where) => {
		expect(() => filter(where)).toThrow();
	});

	test("LIKE and CONTAINS escape regex metacharacters", () => {
		expect(filter({ a: ["a.b%", "LIKE"] }).a.$regex).toBe("^a\\.b.*$");
		expect(filter({ a: ["a.b", "CONTAINS"] }).a.$regex).toBe("a\\.b");
	});
});

describe("updates", () => {
	test("sets fields with edit stamps; dot paths kept", () => {
		const u = update({ status: "done", "meta.ms": 5 }, { user: "bob" });
		expect(u.set.status).toBe("done");
		expect(u.set["meta.ms"]).toBe(5);
		expect(u.set.edited_by).toBe("bob");
		expect(u.set.edited_on).toBeInstanceOf(Date);
	});

	test("merge flattens nested objects so siblings survive", () => {
		expect(update({ meta: { a: { b: 1 }, c: 2 } }, { merge: true, timestamps: false }).set).toEqual({ "meta.a.b": 1, "meta.c": 2 });
	});

	test("without merge a nested object replaces the sub document", () => {
		expect(update({ meta: { a: 1 } }, { timestamps: false }).set).toEqual({ meta: { a: 1 } });
	});

	test("inc / unset / push / upsert", () => {
		const u = update({}, { inc: { "stats.hits": 1 }, unset: ["tmp"], push: { tags: "x" }, upsert: true });
		expect(u.inc).toEqual({ "stats.hits": 1 });
		expect(u.unset).toEqual(["tmp"]);
		expect(u.push).toEqual({ tags: "x" });
		expect(u.setOnInsert.created_on).toBeInstanceOf(Date);
	});

	test("rejects operator keys in data and empty updates", () => {
		expect(() => update({ $set: { a: 1 } })).toThrow();
		expect(() => update({}, { timestamps: false })).toThrow(/nothing to update/);
	});
});

describe("group spec, sort, columns", () => {
	test("normalises groupBy, date bucket and metrics", () => {
		const g = DQ.buildGroupSpec({
			where: { level: "error" }, groupBy: ["meta.service"],
			date: { field: "created_on", unit: "hour", as: "h" }, metrics: { n: "count", ms: "avg:meta.ms" }
		}, DQ.makeCtx({}));
		expect(g.groupBy).toEqual([{ field: "meta.service", key: "meta_service" }]);
		expect(g.date).toMatchObject({ field: "created_on", unit: "hour", as: "h" });
		expect(g.metrics).toEqual([{ alias: "n", op: "count", field: null }, { alias: "ms", op: "avg", field: "meta.ms" }]);
		expect(g.sort).toEqual({ h: 1 });
	});

	test.each([
		[{ date: { field: "a", unit: "week" } }],
		[{ metrics: { x: "median:a" } }],
		[{ metrics: { "a.b": "count" } }],
		[{ groupBy: ["a;b"] }]
	])("rejects bad spec %j", (spec) => {
		expect(() => DQ.buildGroupSpec(spec, DQ.makeCtx({}))).toThrow();
	});

	test("sort and columns", () => {
		expect(DQ.parseSort("created_on DESC, level")).toEqual({ created_on: -1, level: 1 });
		expect(DQ.parseSort({ a: "desc", b: 1 })).toEqual({ a: -1, b: 1 });
		expect(DQ.parseSort("")).toBeNull();
		expect(() => DQ.parseSort("a;b DESC")).toThrow();
		expect(DQ.buildColumns("a, b.c")).toEqual(["a", "b.c"]);
		expect(DQ.buildColumns("*")).toBeNull();
	});
});

describe("dates and output", () => {
	test("zone offsets, space separator, local time and invalid dates", () => {
		expect(DQ.toDate("2026-10-21T10:00:00+0530").toISOString()).toBe("2026-10-21T04:30:00.000Z");
		expect(DQ.toDate("2026-10-21 10:00:00").getHours()).toBe(10);
		expect(DQ.toDate("2026-13-45 10:00:00")).toBeNull();
		expect(DQ.toDate("2026-02-31", false, true)).toBeNull();
		expect(DQ.toDate("2026-10-21")).toBeNull();
		expect(DQ.toDate({ toDate: () => new Date(0) }).getTime()).toBe(0);
	});

	test("serialize: ISO dates, string ids, object _id kept", () => {
		const oid = { _bsontype: "ObjectId", toString: () => "abc" };
		const rows = DQ.serialize([{ _id: oid, at: new Date(0), meta: { n: 1 } }, { _id: { a: 1 }, n: 2 }], {});
		expect(rows).toEqual([{ id: "abc", at: "1970-01-01T00:00:00.000Z", meta: { n: 1 } }, { _id: { a: 1 }, n: 2 }]);
		expect(DQ.serialize([{ at: new Date(0) }], { dateFormat: "epoch" })).toEqual([{ at: 0 }]);
	});

	test("document building rejects operator and dotted keys", () => {
		expect(() => DQ.buildDocument({ "a.b": 1 }, {}, DQ.makeCtx({}), new Date())).toThrow();
		expect(() => DQ.buildDocument({ x: { $set: 1 } }, {}, DQ.makeCtx({}), new Date())).toThrow();
		const d = DQ.buildDocument({ meta: { at: "2026-10-21 10:00:00" } }, { user: "bob" }, DQ.makeCtx({}), new Date());
		expect(d.meta.at).toBeInstanceOf(Date);
		expect(d.created_by).toBe("bob");
	});
});
