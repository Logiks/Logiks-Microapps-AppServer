"use strict";

const MISC = require("../../api/helpers/misc");

describe("MISC helper (pure logic, no DB/network)", () => {
	test("slugify lowercases, strips punctuation, and dashes spaces", () => {
		expect(MISC.slugify("Hello, World!  Foo")).toBe("hello-world-foo");
	});

	test("toTitle capitalizes the first letter of each word", () => {
		expect(MISC.toTitle("hello world")).toBe("Hello World");
	});

	test("geoDistanceMeters returns ~0 for identical coordinates", () => {
		expect(MISC.geoDistanceMeters("12.9716,77.5946", "12.9716,77.5946")).toBeCloseTo(0, 5);
	});

	test("geoDistanceMeters returns a sane distance between two known points", () => {
		// Bengaluru -> Chennai, straight-line distance is ~290km.
		const meters = MISC.geoDistanceMeters("12.9716,77.5946", "13.0827,80.2707");
		expect(meters).toBeGreaterThan(270000);
		expect(meters).toBeLessThan(310000);
	});
});
