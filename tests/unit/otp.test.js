"use strict";

// USERS.valiateOTPCode: a code is bound to the challenge it was issued for, works once, and the challenge is
// burned after too many wrong attempts.

const { fakeCache, LogiksError } = require("./helpers/fakes");
const { TOTP } = require("totp-generator");

const cache = fakeCache();
global._CACHE = cache;
global.LogiksError = LogiksError;
global.CONFIG = { ...global.CONFIG, mfa: { mfa_length: 6 } };

const USERS = require("../../api/controllers/users");

const issue = async (id, entry) => cache.storeDataEx(`otp:${id}`, entry, 300);
const user = { userId: "u1", guid: "g1" };

describe("USERS.valiateOTPCode", () => {
	test("returns the user for the right code", async () => {
		await issue("c1", { otp: "123456", user, mfainfo: { mfa_type: "otp" } });
		expect(await USERS.valiateOTPCode("c1", "123456")).toEqual(user);
	});

	test("a code works only once", async () => {
		await issue("c2", { otp: "123456", user, mfainfo: { mfa_type: "otp" } });
		expect(await USERS.valiateOTPCode("c2", "123456")).toEqual(user);
		expect(await USERS.valiateOTPCode("c2", "123456")).toBe(false);
	});

	test("a wrong code is refused", async () => {
		await issue("c3", { otp: "123456", user, mfainfo: { mfa_type: "otp" } });
		expect(await USERS.valiateOTPCode("c3", "000000")).toBe(false);
	});

	test("a missing or unknown challenge is refused", async () => {
		expect(await USERS.valiateOTPCode("nope", "123456")).toBe(false);
		expect(await USERS.valiateOTPCode(undefined, "123456")).toBe(false);
		expect(await USERS.valiateOTPCode("c1", undefined)).toBe(false);
	});

	test("an empty code never matches (the old comparison treated undefined == undefined as a match)", async () => {
		await issue("c4", { otp: undefined, user, mfainfo: { mfa_type: "otp" } });
		expect(await USERS.valiateOTPCode("c4", "")).toBe(false);
		expect(await USERS.valiateOTPCode("c4", "undefined")).toBe(false);
	});

	test("the challenge is burned after five wrong attempts, even if the right code follows", async () => {
		await issue("c5", { otp: "123456", user, mfainfo: { mfa_type: "otp" } });
		for (let i = 0; i < 5; i++) expect(await USERS.valiateOTPCode("c5", "00000" + i)).toBe(false);
		expect(await USERS.valiateOTPCode("c5", "123456")).toBe(false);
	});

	test("a challenge entry without MFA info is refused", async () => {
		await issue("c6", { otp: "123456", user });
		expect(await USERS.valiateOTPCode("c6", "123456")).toBe(false);
	});

	describe("totp", () => {
		const secret = "JBSWY3DPEHPK3PXP";
		const params = (offsetPeriods = 0) => ({ digits: 6, algorithm: "SHA-512", period: 60, timestamp: Date.now() + offsetPeriods * 60 * 1000 });

		test("the current code is accepted", async () => {
			await issue("t1", { user, mfainfo: { mfa_type: "totp", mfa_code: secret } });
			const { otp } = await TOTP.generate(secret, params());
			expect(await USERS.valiateOTPCode("t1", otp)).toEqual(user);
		});

		test("the previous window is accepted for clock skew, a far-off one is not", async () => {
			await issue("t2", { user, mfainfo: { mfa_type: "totp", mfa_code: secret } });
			const { otp: previous } = await TOTP.generate(secret, params(-1));
			expect(await USERS.valiateOTPCode("t2", previous)).toEqual(user);

			await issue("t3", { user, mfainfo: { mfa_type: "totp", mfa_code: secret } });
			const { otp: old } = await TOTP.generate(secret, params(-5));
			expect(await USERS.valiateOTPCode("t3", old)).toBe(false);
		});

		test("a code for a different secret is refused", async () => {
			await issue("t4", { user, mfainfo: { mfa_type: "totp", mfa_code: secret } });
			const { otp } = await TOTP.generate("GEZDGNBVGY3TQOJQ", params());
			expect(await USERS.valiateOTPCode("t4", otp)).toBe(false);
		});
	});
});
