"use strict";

// DATAMODELS.checkHook: hooks declared as {"<what to run>": "sql" | "method"} actually run, in order, and a failing
// hook never breaks the write that triggered it.

const DATAMODELS = require("../../api/helpers/dataModels");

describe("DATAMODELS.checkHook", () => {
	let calls;

	beforeEach(() => {
		calls = [];
		global.DATAMODELS = DATAMODELS;
		global._DB = { db_query: jest.fn(async (dbkey, sql) => { calls.push(["sql", dbkey, sql]); }) };
		global._call = jest.fn(async (name, args) => { calls.push(["method", name, args]); });
		jest.spyOn(console, "error").mockImplementation(() => {});
		jest.spyOn(DATAMODELS, "getModel");
	});
	afterEach(() => jest.restoreAllMocks());

	const withModel = (hooks) => DATAMODELS.getModel.mockImplementation(async () => ({ hooks }));

	test("sql and method hooks both run, in declaration order", async () => {
		withModel({ insert: { "UPDATE stats SET n=n+1": "sql", "crm.afterInsert": "method" } });
		await DATAMODELS.checkHook("crm_contacts", "insert", "appdb", { id: 9 });

		expect(calls).toEqual([
			["sql", "appdb", "UPDATE stats SET n=n+1"],
			["method", "crm.afterInsert", { tables: "crm_contacts", operation: "insert", dbkey: "appdb", param: { id: 9 } }]
		]);
	});

	test("only the hooks for the operation that happened run", async () => {
		withModel({ insert: { "SELECT 1": "sql" }, delete: { "SELECT 2": "sql" } });
		await DATAMODELS.checkHook("t", "delete", "appdb");
		expect(calls.map(c => c[2])).toEqual(["SELECT 2"]);
	});

	test("every table of a multi-table write is checked", async () => {
		withModel({ update: { "SELECT 1": "sql" } });
		await DATAMODELS.checkHook("a,b", "update", "appdb");
		expect(DATAMODELS.getModel).toHaveBeenCalledTimes(2);
		expect(calls).toHaveLength(2);
	});

	test("a failing hook is logged, later hooks still run, and nothing rejects", async () => {
		withModel({ insert: { "BAD SQL": "sql", "ok.method": "method" } });
		global._DB.db_query.mockRejectedValueOnce(new Error("syntax error"));

		await expect(DATAMODELS.checkHook("t", "insert", "appdb")).resolves.toBeUndefined();
		expect(console.error).toHaveBeenCalled();
		expect(calls.map(c => c[1])).toContain("ok.method");
	});

	test("a model lookup failure does not reject", async () => {
		DATAMODELS.getModel.mockRejectedValue(new Error("plugin down"));
		await expect(DATAMODELS.checkHook("t", "insert", "appdb")).resolves.toBeUndefined();
	});

	test("tables without a model or without hooks do nothing", async () => {
		DATAMODELS.getModel.mockResolvedValue(false);
		await DATAMODELS.checkHook("t", "insert", "appdb");
		withModel({});
		await DATAMODELS.checkHook("t", "insert", "appdb");
		expect(calls).toEqual([]);
	});

	test("an unknown run type is ignored", async () => {
		withModel({ insert: { "SELECT 1": "shell" } });
		await DATAMODELS.checkHook("t", "insert", "appdb");
		expect(calls).toEqual([]);
	});
});
