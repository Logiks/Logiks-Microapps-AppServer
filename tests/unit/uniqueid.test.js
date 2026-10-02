"use strict";

const UNIQUEID = require("../../api/helpers/uniqueid");

describe("UNIQUEID helper (pure logic, no DB/network)", () => {
	test("generate() produces a URL-safe id of the requested length", () => {
		const id = UNIQUEID.generate(21);
		expect(typeof id).toBe("string");
		expect(id).toHaveLength(21);
		expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	test("generate() respects a custom size", () => {
		expect(UNIQUEID.generate(8)).toHaveLength(8);
	});

	test("generate() produces distinct ids across calls", () => {
		const ids = new Set(Array.from({ length: 200 }, () => UNIQUEID.generate(16)));
		expect(ids.size).toBe(200);
	});
});
