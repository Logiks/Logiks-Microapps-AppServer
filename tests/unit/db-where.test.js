"use strict";

// MySQLDriver.buildWhere and the shared validators: values are escaped, column names and operators are checked.
// No connection is made - the driver is only instantiated.

const DBDriver = require("../../api/helpers/db/DBDriver");
const MySQLDriver = require("../../api/helpers/db/drivers/MySQLDriver");

const driver = new MySQLDriver("test", {});

describe("DBDriver validators", () => {
	test.each(["id", "t.id", "`id`", "t.`id`", "created_on"])("accepts column %s", (col) => {
		expect(() => DBDriver.assertSafeColumn(col)).not.toThrow();
	});

	test.each(["id=1 OR 1", "a;--", "a b", "1a", "", "a`b", "(select 1)"])("rejects column %j", (col) => {
		expect(() => DBDriver.assertSafeColumn(col)).toThrow(/unsafe column name/);
	});

	test.each(["=", "!=", "<>", ">=", "like", " not  in ", "IS NOT"])("accepts operator %j", (op) => {
		expect(() => DBDriver.assertSafeOperator(op)).not.toThrow();
	});

	test.each(["= 1 OR 1=1 --", "; DROP TABLE x", "BETWEEN", "", "LIKE 'a'"])("rejects operator %j", (op) => {
		expect(() => DBDriver.assertSafeOperator(op)).toThrow(/unsupported where operator/);
	});

	test("operators are normalised to upper case", () => {
		expect(DBDriver.assertSafeOperator(" not   like ")).toBe("NOT LIKE");
	});
});

describe("MySQLDriver.buildWhere", () => {
	test("a quote in a value cannot end the string literal", () => {
		const [clause] = driver.buildWhere({ name: "x' OR '1'='1" });
		expect(clause).toBe("name='x\\' OR \\'1\\'=\\'1'");
	});

	test("backslashes are escaped too", () => {
		const [clause] = driver.buildWhere({ name: "a\\" });
		expect(clause).toBe("name='a\\\\'");
	});

	test("[value, operator] pairs are escaped once, not double-quoted", () => {
		expect(driver.buildWhere({ title: ["abc", "LIKE"] })).toEqual(["title LIKE 'abc'"]);
	});

	test("IN lists are escaped per element", () => {
		expect(driver.buildWhere({ id: [[1, "2", "x'y"], "IN"] })).toEqual(["id IN (1,'2','x\\'y')"]);
	});

	test("empty IN / NOT IN lists produce valid SQL", () => {
		expect(driver.buildWhere({ id: [[], "IN"] })).toEqual(["1=0"]);
		expect(driver.buildWhere({ id: [[], "NOT IN"] })).toEqual(["1=1"]);
	});

	test("null matches with IS NULL", () => {
		expect(driver.buildWhere({ a: null })).toEqual(["a IS NULL"]);
		expect(driver.buildWhere({ a: [null, "="] })).toEqual(["a IS NULL"]);
		expect(driver.buildWhere({ a: [null, "!="] })).toEqual(["a IS NOT NULL"]);
	});

	test("RAW clauses pass through untouched", () => {
		expect(driver.buildWhere({ "FIND_IN_SET('x', roles)": "RAW" })).toEqual(["FIND_IN_SET('x', roles)"]);
	});

	test("a column name that is really SQL is refused", () => {
		expect(() => driver.buildWhere({ "id=1 OR 1": "x" })).toThrow(/unsafe column name/);
	});

	test("an operator that is really SQL is refused", () => {
		expect(() => driver.buildWhere({ a: ["1", "= 1 OR 1=1 -- "] })).toThrow(/unsupported where operator/);
	});

	test("the caller's condition arrays are not modified", () => {
		const cond = ["v'", "="];
		driver.buildWhere({ a: cond });
		expect(cond).toEqual(["v'", "="]);
	});

	test("a plain string where is returned as-is, null gives no clauses", () => {
		expect(driver.buildWhere("a=1")).toEqual(["a=1"]);
		expect(driver.buildWhere(null)).toEqual([]);
	});
});
