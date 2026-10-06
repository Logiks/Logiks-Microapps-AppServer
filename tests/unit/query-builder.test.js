"use strict";

// QUERY: values placed in SQL text are escaped, request-supplied "RAW" filters are dropped, and params substituted
// into RAW clauses cannot break out of their quotes.

require("../../api/helpers/misc"); // defines the global _replace / _replaceCtx used by QUERY
global.ENV = { fetchEnvInfo: async (meta) => meta }; // parseQuery only needs the meta passed through
const QUERY = require("../../api/helpers/query");
global.QUERY = QUERY; // the real app exposes every helper as a global

describe("QUERY.stripRawFilter", () => {
	test("drops RAW entries (any case/whitespace) and keeps real conditions", () => {
		expect(QUERY.stripRawFilter({ a: 1, "1=1 OR x": "RAW", "b=2": " raw ", c: ["x", "LIKE"] }))
			.toEqual({ a: 1, c: ["x", "LIKE"] });
	});

	test("anything that is not a plain object becomes an empty filter", () => {
		expect(QUERY.stripRawFilter(null)).toEqual({});
		expect(QUERY.stripRawFilter("a=1")).toEqual({});
		expect(QUERY.stripRawFilter([["a", "RAW"]])).toEqual({});
	});

	test("does not modify its input", () => {
		const input = { "x": "RAW", y: 1 };
		QUERY.stripRawFilter(input);
		expect(input).toEqual({ x: "RAW", y: 1 });
	});
});

describe("QUERY.updateWhereFromEnv", () => {
	test("a request value substituted into a RAW clause has its quotes escaped", () => {
		const where = { "name='${q}'": "RAW" };
		const out = QUERY.updateWhereFromEnv(where, { q: "x' OR '1'='1" });
		expect(Object.keys(out)).toEqual(["name='x'' OR ''1''=''1'"]);
	});

	test("ordinary (non-RAW) values are substituted as before", () => {
		const out = QUERY.updateWhereFromEnv({ owner: "${userId}" }, { userId: "u1" });
		expect(out.owner).toBe("u1");
	});
});

describe("QUERY.parseQuery value escaping", () => {
	const parse = (where) => QUERY.parseQuery({ table: "t", column: "*", where }, {}, {});

	test("an equality value cannot close its quote", async () => {
		const sql = await parse({ a: "x' OR '1'='1" });
		expect(sql).toContain("a ='x'' OR ''1''=''1'");
	});

	test("LIKE patterns are escaped", async () => {
		const sql = await parse({ a: ["x' --", "like"] });
		expect(sql).toContain("LIKE '%x'' --%'");
	});

	test("a RAW key in the *where* object is still honoured (server-built clauses)", async () => {
		const sql = await parse({ "deleted_at IS NULL": "RAW" });
		expect(sql).toContain("deleted_at IS NULL");
	});
});
