"use strict";

// Whitelist matching, platform admin, password hashing and secret protection.

global.crypto = global.crypto || require("crypto");
global.isDevelopment = true;
global.CONFIG = global.CONFIG || {};
require("../../api/commons");

const ENCRYPTER = require("../../api/helpers/encrypter");
const sha1 = require("sha1");

beforeAll(async () => {
	jest.spyOn(console, "warn").mockImplementation(() => {});
	jest.spyOn(console, "log").mockImplementation(() => {});
	process.env.ENC_SALT = "unit-test-enc-salt-0123456789abcdef";
	await ENCRYPTER.initialize();
});

describe("_matchWhitelist", () => {
	test("exact names, prefixes and *", () => {
		expect(_matchWhitelist(["files.upload"], "files.upload")).toBe(true);
		expect(_matchWhitelist(["files.upload"], "files.delete")).toBe(false);
		expect(_matchWhitelist(["reports.*"], "reports.list")).toBe(true);
		expect(_matchWhitelist(["reports.*"], "reports")).toBe(false);
		expect(_matchWhitelist(["reports.*"], "reportsx.list")).toBe(false);
		expect(_matchWhitelist(["*"], "anything.at.all")).toBe(true);
	});
	test("an empty, missing or malformed list allows nothing", () => {
		expect(_matchWhitelist([], "a.b")).toBe(false);
		expect(_matchWhitelist(undefined, "a.b")).toBe(false);
		expect(_matchWhitelist("a.b", "a.b")).toBe(false);
		expect(_matchWhitelist(["a.b"], "")).toBe(false);
		expect(_matchWhitelist([null, 5, ""], "a.b")).toBe(false);
	});
});

describe("_isPlatformAdmin", () => {
	afterEach(() => { delete global.CONFIG.platform_admin; });

	test("root and devroot privileges by default; a tenant admin role is not enough", () => {
		expect(_isPlatformAdmin({ privilege: "root", roles: [] })).toBe(true);
		expect(_isPlatformAdmin({ privilege: "devroot", roles: [] })).toBe(true);
		expect(_isPlatformAdmin({ privilege: "admin", roles: ["admin"] })).toBe(false);
		expect(_isPlatformAdmin(undefined)).toBe(false);
	});
	test("config can name privileges and roles", () => {
		global.CONFIG.platform_admin = { privileges: ["ops"], roles: ["cluster"] };
		expect(_isPlatformAdmin({ privilege: "ops", roles: [] })).toBe(true);
		expect(_isPlatformAdmin({ privilege: "x", roles: ["cluster"] })).toBe(true);
		expect(_isPlatformAdmin({ privilege: "root", roles: [] })).toBe(false);
	});
});

describe("passwords", () => {
	test("new hashes are bcrypt and verify", async () => {
		const hash = await ENCRYPTER.hashPassword("abc123");
		expect(hash.startsWith("$2")).toBe(true);
		expect(await ENCRYPTER.verifyPassword("abc123", hash)).toEqual({ valid: true, needsUpgrade: false });
		expect((await ENCRYPTER.verifyPassword("abc124", hash)).valid).toBe(false);
	});
	test("two hashes of one password differ (per-password salt)", async () => {
		expect(await ENCRYPTER.hashPassword("same")).not.toBe(await ENCRYPTER.hashPassword("same"));
	});
	test("an old sha1 hash still works and asks to be upgraded", async () => {
		const legacy = sha1(process.env.ENC_SALT + "abc123");
		expect(await ENCRYPTER.verifyPassword("abc123", legacy)).toEqual({ valid: true, needsUpgrade: true });
		expect((await ENCRYPTER.verifyPassword("nope", legacy)).valid).toBe(false);
	});
	test("an empty stored hash never matches", async () => {
		expect((await ENCRYPTER.verifyPassword("", "")).valid).toBe(false);
		expect((await ENCRYPTER.verifyPassword("x", null)).valid).toBe(false);
	});
});

describe("protect / unprotect", () => {
	test("round trip, random each time, and plain values pass through", () => {
		const a = ENCRYPTER.protect("JBSWY3DPEHPK3PXP");
		expect(a.startsWith("enc:v1:")).toBe(true);
		expect(a).not.toContain("JBSWY3DPEHPK3PXP");
		expect(ENCRYPTER.unprotect(a)).toBe("JBSWY3DPEHPK3PXP");
		expect(ENCRYPTER.protect("JBSWY3DPEHPK3PXP")).not.toBe(a);
		expect(ENCRYPTER.unprotect("legacy-plain")).toBe("legacy-plain");
		expect(ENCRYPTER.protect("")).toBe("");
	});
	test("a tampered value is refused", () => {
		const a = ENCRYPTER.protect("secret");
		const broken = a.slice(0, -4) + (a.endsWith("AAAA") ? "BBBB" : "AAAA");
		expect(() => ENCRYPTER.unprotect(broken)).toThrow();
	});
});
