"use strict";

const { check, problemWith } = require("../../api/startupChecks");

const strong = (n = 32) => "a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuV".repeat(2).slice(0, n);
const goodConfig = () => ({ authjwt: { secret: strong(48), algorithm: "HS256" }, SALT_KEY: strong(24) });
const goodEnv = () => ({ CLUSTER_TOKEN: strong(32), SESSION_SECRET: strong(32), ENC_SALT: strong(32) });

describe("startup secret checks", () => {
	test("strong secrets pass", () => {
		const r = check(goodConfig(), goodEnv(), false);
		expect(r.errors).toEqual([]);
	});

	test("outside development every problem is an error", () => {
		const r = check({ authjwt: { secret: "Zv7QFrJWhSz6j2kA" }, SALT_KEY: "new_salt_key_1234567890" }, {}, false);
		expect(r.errors).toHaveLength(5);
		expect(r.warnings).toEqual([]);
	});

	test("in development the same problems are only warnings", () => {
		const r = check({ authjwt: { secret: "short" } }, {}, true);
		expect(r.errors).toEqual([]);
		expect(r.warnings.length).toBe(5);
	});

	test.each([
		["", "is not set"],
		[undefined, "is not set"],
		["abc", "too short"],
		["Zv7QFrJWhSz6j2kA" + "x".repeat(30), null],
		["change-me-cluster-token-0123456789", "placeholder"],
		["REPLACE_ME_random_hex_32_chars_or_more", "placeholder"],
		["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "variety"]
	])("authjwt.secret %p", (value, expected) => {
		const p = problemWith("authjwt.secret", value);
		if(expected === null) expect(p).toBeNull();
		else expect(p).toContain(expected);
	});

	test("sample values are refused even when long enough", () => {
		expect(problemWith("SESSION_SECRET", "dev_super_secret_change_me")).toBeTruthy();
		expect(problemWith("CLUSTER_TOKEN", "super-secret-cluster-token")).toBeTruthy();
	});

	test("an unsupported signing algorithm is an error", () => {
		const cfg = goodConfig();
		cfg.authjwt.algorithm = "none";
		expect(check(cfg, goodEnv(), true).errors.join()).toContain("authjwt.algorithm");
	});
});
