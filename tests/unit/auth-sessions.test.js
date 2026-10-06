"use strict";

// auth service: tokens verify, "log out everywhere" revokes refresh tokens *and* access tokens that are still
// inside their expiry, and S2S/TL tokens are use-limited atomically without their expiry being extended.

const { fakeCache, LogiksError } = require("./helpers/fakes");

const cache = fakeCache();
global._CACHE = cache;
global.LogiksError = LogiksError;
global._DB = { db_insertQ1: async () => {}, db_selectQ: async () => ({ results: [] }) };
global.MISC = { generateDefaultDBRecord: () => ({}) };
global.KEYMANAGER = { getKey: async (k) => String(k) };
global.CONFIG = { ...global.CONFIG, authjwt: { secret: "unit-test-jwt-secret", algorithm: "HS256", access_token_ttl: 3600, refresh_token_ttl: 86400 } };
global.ENCRYPTER = require("../../api/helpers/encrypter");

const authService = require("../../api/services/auth.service");
const redis = cache.redis;

const appInfo = { appid: "app1" };
const user = { id: 7, userId: "alice", name: "Alice", tenantId: "t1", guid: "t1", privilege: "user" };
const ctxFor = (extra = {}) => ({ meta: { appInfo, remoteIP: "1.2.3.4", headers: {}, ...extra }, params: {}, ...extra.ctx });

// session ids contain Date.now(), so each login in a test gets its own millisecond
let clock = Date.now();
const issueAs = async (who) => {
	const realNow = Date.now;
	clock += 5;
	Date.now = () => clock;
	try { return await authService.methods.issueTokensForUser.call({}, who, "1.2.3.4", "web", ctxFor()); } finally { Date.now = realNow; }
};
const issue = () => issueAs(user);
const verify = (token) => authService.actions.verifyAccessToken.handler.call({}, { ...ctxFor(), params: { token } });
const logoutAll = (accessToken) => authService.actions.logoutAll.handler.call({}, {
	...ctxFor(),
	meta: { ...ctxFor().meta, user: { id: 7, userId: "alice", tenantId: "t1" }, accessTokenRaw: accessToken },
	params: {}
});

beforeEach(() => { redis.data.clear(); redis.sets.clear(); });

describe("access token verification", () => {
	test("a freshly issued token verifies and carries the numeric id", async () => {
		const { accessToken } = await issue();
		const info = await verify(accessToken);
		expect(info).toMatchObject({ id: 7, userId: "alice", tenantId: "t1" });
	});

	test("a refresh token is not accepted as an access token", async () => {
		const { refreshToken } = await issue();
		await expect(verify(refreshToken)).rejects.toThrow(/Invalid token type/);
	});

	test("a token signed with another secret is refused", async () => {
		const jwt = require("jsonwebtoken");
		const forged = jwt.sign({ type: "access", payload: "x" }, "attacker-secret", { jwtid: "acc:1" });
		await expect(verify(forged)).rejects.toThrow(/Invalid token/);
	});
});

describe("log out everywhere", () => {
	test("refresh tokens and sessions are removed (they are indexed under the numeric id)", async () => {
		await issue();
		await issue();
		expect((await redis.smembers("user_sessions:t1:7")).length).toBe(2);
		expect([...redis.data.keys()].filter(k => k.startsWith("refresh:")).length).toBe(2);

		await logoutAll();

		expect([...redis.data.keys()].filter(k => k.startsWith("refresh:") || k.startsWith("user:"))).toEqual([]);
	});

	test("an access token issued before the logout is refused, although it has not expired", async () => {
		const { accessToken } = await issue();
		await expect(verify(accessToken)).resolves.toBeTruthy();

		await logoutAll(accessToken);

		await expect(verify(accessToken)).rejects.toThrow(/revoked/i);
	});

	test("an access token on *another* device is refused too", async () => {
		const first = await issue();
		const second = await issue();

		await logoutAll(first.accessToken);

		await expect(verify(second.accessToken)).rejects.toThrow(/revoked/i);
	});

	test("another user's tokens are unaffected", async () => {
		const other = await issueAs({ ...user, id: 8, userId: "bob" });
		await logoutAll();
		await expect(verify(other.accessToken)).resolves.toMatchObject({ userId: "bob" });
	});
});

describe("S2S / TL token use limits", () => {
	const seed = (kind, token, extra = {}) => redis.set(`${kind}:${token}`, JSON.stringify({ counter: 0, ip: "1.2.3.4", ...extra }));
	const verifyS2S = (token) => authService.actions.verifyS2SToken.handler.call({}, { ...ctxFor(), params: { token } });
	const verifyTL = (token) => authService.actions.verifyTLToken.handler.call({}, { ...ctxFor(), params: { token } });

	test("an S2S token works up to its limit and is then deleted", async () => {
		await seed("S2STOKENS", "abc");
		for (let i = 0; i < 10; i++) await expect(verifyS2S("abc")).resolves.toBeTruthy();
		await expect(verifyS2S("abc")).rejects.toThrow(/S2S Token/);
		expect(await redis.get("S2STOKENS:abc")).toBeNull();
	});

	test("concurrent uses cannot exceed the limit", async () => {
		await seed("S2STOKENS", "race");
		const results = await Promise.allSettled(Array.from({ length: 25 }, () => verifyS2S("race")));
		expect(results.filter(r => r.status === "fulfilled")).toHaveLength(10);
	});

	test("using a token does not rewrite it (its expiry is not extended)", async () => {
		await seed("S2STOKENS", "exp");
		const before = redis.data.get("S2STOKENS:exp");
		await verifyS2S("exp");
		expect(redis.data.get("S2STOKENS:exp")).toBe(before);
	});

	test("a TL token is refused from another IP", async () => {
		await seed("TLTOKENS", "tl");
		const wrongIp = { ...ctxFor(), meta: { ...ctxFor().meta, remoteIP: "9.9.9.9" }, params: { token: "tl" } };
		await expect(authService.actions.verifyTLToken.handler.call({}, wrongIp)).rejects.toThrow(/Invalid TL token/);
		await expect(verifyTL("tl")).resolves.toBeTruthy();
	});

	test("an unknown token is refused", async () => {
		await expect(verifyS2S("nope")).rejects.toThrow(/Invalid S2S token/);
	});
});
