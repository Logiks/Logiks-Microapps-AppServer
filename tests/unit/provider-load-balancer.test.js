"use strict";

// Provider load balancer: each policy picks as designed, state is shared through Redis (so a second "node" sees
// the first one's counters), failover switches to the next provider once and only once, request errors are not
// switched, and a Redis outage degrades to local state instead of failing the request.

const { FakeRedis, fakeCache } = require("./helpers/fakes");

// FakeRedis plus what the balancer needs: DECR, EXISTS, key expiry and a connection status
class BalancerRedis extends FakeRedis {
	constructor() { super(); this.status = "ready"; this.expiry = new Map(); this.failing = false; }

	_check() {
		if (this.failing) throw new Error("redis down");
	}
	_live(key) {
		const at = this.expiry.get(key);
		if (at && Date.now() >= at) { this.data.delete(key); this.expiry.delete(key); }
	}
	async get(key) { this._check(); this._live(key); return super.get(key); }
	async incr(key) { this._check(); this._live(key); return super.incr(key); }
	async decr(key) { this._check(); this._live(key); const n = Number(this.data.get(key) || 0) - 1; this.data.set(key, String(n)); return n; }
	async exists(key) { this._check(); this._live(key); return this.data.has(key) ? 1 : 0; }
	async del(key) { this._check(); this.expiry.delete(key); return super.del(key); }
	async expire(key, sec) { this._check(); this.expiry.set(key, Date.now() + sec * 1000); return 1; }
	async zadd(key, score, member) { this._check(); if (!this.zs) this.zs = new Map(); const z = this.zs.get(key) || new Map(); z.set(member, score); this.zs.set(key, z); return 1; }
	async zrem(key, member) { this._check(); return (this.zs?.get(key)?.delete(member)) ? 1 : 0; }
	async zremrangebyscore(key, min, max) { this._check(); const z = this.zs?.get(key); if (!z) return 0; let n = 0; for (const [m, sc] of z) if (sc <= max) { z.delete(m); n++; } return n; }
	async zcard(key) { this._check(); return this.zs?.get(key)?.size || 0; }
	async pexpire(key, ms) { this._check(); this.expiry.set(key, Date.now() + ms); return 1; }
	async set(key, value, mode, ttl) {
		this._check();
		await super.set(key, value);
		if (mode === "PX") this.expiry.set(key, Date.now() + ttl);
		else if (mode === "EX") this.expiry.set(key, Date.now() + ttl * 1000);
		else this.expiry.delete(key);
		return "OK";
	}
}

let redis;
function freshCluster() {
	redis = new BalancerRedis();
	global._CACHE = fakeCache(redis);
}

global.CONFIG = global.CONFIG || {};
freshCluster();
const LB = require("../../api/controllers/provider_load_balancer");

const prov = (code, params) => ({ provider_code: code, provider_engine: "mistral", params: params ? JSON.stringify(params) : "" });
const A = () => prov("a"), B = () => prov("b"), C = () => prov("c");

async function tally(providers, n, options, fn = async () => {}) {
	const counts = {};
	for (let i = 0; i < n; i++) {
		await LB.dispatch(providers, async (p) => { counts[p.provider_code] = (counts[p.provider_code] || 0) + 1; return fn(p); }, options);
	}
	return counts;
}

beforeEach(() => {
	freshCluster();
	LB._resetLocalState();
	jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("policies", () => {
	test("round_robin spreads evenly and stays in a stable order", async () => {
		const order = [];
		for (let i = 0; i < 6; i++) await LB.dispatch([C(), A(), B()], async (p) => order.push(p.provider_code), { policy: "round_robin", scope: "rr" });
		expect(order).toEqual(["a", "b", "c", "a", "b", "c"]);
	});

	test("weighted gives a provider its weight in turns per cycle", async () => {
		const counts = await tally([prov("a", { weight: 3 }), B()], 8, { policy: "weighted", scope: "w" });
		expect(counts).toEqual({ a: 6, b: 2 });
	});

	test("least_used evens out served requests", async () => {
		const counts = await tally([A(), B()], 10, { policy: "least_used", scope: "u" });
		expect(counts).toEqual({ a: 5, b: 5 });
	});

	test("least_loaded avoids the provider with requests in flight", async () => {
		let release;
		const hold = new Promise(r => release = r);
		const first = LB.dispatch([A(), B()], async () => { await hold; return "a-done"; }, { policy: "least_loaded", scope: "l" });
		await new Promise(r => setImmediate(r));

		const picked = await LB.dispatch([A(), B()], async (p) => p.provider_code, { policy: "least_loaded", scope: "l" });
		expect(picked).toBe("b");

		release();
		expect(await first).toBe("a-done");
	});

	test("latency prefers the faster provider once both are measured", async () => {
		await redis.set("providerlb:stats:a", JSON.stringify({ latency: 900 }));
		await redis.set("providerlb:stats:b", JSON.stringify({ latency: 100 }));
		const picked = await LB.dispatch([A(), B()], async (p) => p.provider_code, { policy: "latency", scope: "lat" });
		expect(picked).toBe("b");
	});

	test("latency tries a never-measured provider first", async () => {
		await redis.set("providerlb:stats:a", JSON.stringify({ latency: 5 }));
		const picked = await LB.dispatch([A(), B()], async (p) => p.provider_code, { policy: "latency", scope: "lat2" });
		expect(picked).toBe("b");
	});

	test("random only ever returns configured providers", async () => {
		const counts = await tally([A(), B()], 30, { policy: "random", scope: "r" });
		expect(Object.keys(counts).every(k => ["a", "b"].includes(k))).toBe(true);
	});

	test("max_concurrent takes a saturated provider out of rotation", async () => {
		let release;
		const hold = new Promise(r => release = r);
		const busy = LB.dispatch([prov("a", { max_concurrent: 1 })], async () => hold, { scope: "m" });
		await new Promise(r => setImmediate(r));

		const picked = await LB.dispatch([prov("a", { max_concurrent: 1 }), B()], async (p) => p.provider_code, { policy: "round_robin", scope: "m" });
		expect(picked).toBe("b");
		release();
		await busy;
	});

	test("an unknown policy is rejected", async () => {
		await expect(LB.dispatch([A()], async () => 1, { policy: "nope" })).rejects.toThrow(/Unsupported/);
	});

	test("no providers is an error, not a hang", async () => {
		await expect(LB.dispatch([], async () => 1)).rejects.toThrow(/No providers/);
	});
});

describe("shared state across the cluster", () => {
	test("the round robin cursor lives in Redis, not in the process", async () => {
		await LB.dispatch([A(), B()], async () => {}, { policy: "round_robin", scope: "shared" });
		// a different node would only have Redis to go on
		LB._resetLocalState();
		const picked = await LB.dispatch([A(), B()], async (p) => p.provider_code, { policy: "round_robin", scope: "shared" });
		expect(picked).toBe("b");
		expect(await redis.get("providerlb:rr:shared")).toBe("2");
	});

	test("in-flight is tracked in Redis and released afterwards, even on failure", async () => {
		let seen;
		await LB.dispatch([A()], async () => { seen = await redis.zcard("providerlb:inflight:a"); }, { scope: "i" });
		expect(seen).toBe(1);
		expect(await redis.zcard("providerlb:inflight:a")).toBe(0);

		await expect(LB.dispatch([A()], async () => { throw new Error("boom"); }, { scope: "i" })).rejects.toThrow("boom");
		expect(await redis.zcard("providerlb:inflight:a")).toBe(0);
	});

	test("a request left behind by a crashed node stops counting once its deadline passes", async () => {
		const now = Date.now();
		const spy = jest.spyOn(Date, "now").mockReturnValue(now);
		// simulates the dead node: it registered the request and never reported back
		await redis.zadd("providerlb:inflight:a", now + 1000, "dead-node-request");
		expect((await LB.stats([A()]))[0].inflight).toBe(1);

		spy.mockReturnValue(now + 2000);
		expect((await LB.stats([A()]))[0].inflight).toBe(0);
	});

	test("a stuck provider with max_concurrent comes back after the dead request expires", async () => {
		const now = Date.now();
		const spy = jest.spyOn(Date, "now").mockReturnValue(now);
		await redis.zadd("providerlb:inflight:a", now + 1000, "dead");
		const only = [prov("a", { max_concurrent: 1 })];
		await expect(LB.dispatch(only, async () => "ok", { scope: "stuck" })).rejects.toThrow(/No healthy/);

		spy.mockReturnValue(now + 2000);
		expect(await LB.dispatch(only, async () => "ok", { scope: "stuck" })).toBe("ok");
	});

	test("a breaker opened on one node is respected by another", async () => {
		const breaker = { failureThreshold: 1, cooldownMs: 60000 };
		await expect(LB.dispatch([A()], async () => { throw new Error("down"); }, { scope: "br", breaker })).rejects.toThrow("down");
		expect(await redis.exists("providerlb:open:a")).toBe(1);

		LB._resetLocalState();
		await expect(LB.dispatch([A()], async () => "ok", { scope: "br", breaker })).rejects.toThrow(/No healthy providers/);
		expect(await LB.dispatch([A(), B()], async (p) => p.provider_code, { scope: "br", breaker })).toBe("b");
	});

	test("the breaker closes again after the cooldown", async () => {
		const breaker = { failureThreshold: 1, cooldownMs: 5000 };
		const now = Date.now();
		const spy = jest.spyOn(Date, "now").mockReturnValue(now);
		await expect(LB.dispatch([A()], async () => { throw new Error("down"); }, { scope: "cd", breaker })).rejects.toThrow();

		spy.mockReturnValue(now + 6000);
		expect(await LB.dispatch([A()], async () => "recovered", { scope: "cd", breaker })).toBe("recovered");
	});

	test("a success resets the failure count", async () => {
		const breaker = { failureThreshold: 2, cooldownMs: 60000 };
		await expect(LB.dispatch([A()], async () => { throw new Error("x"); }, { scope: "f", breaker, maxFailovers: 0 })).rejects.toThrow();
		await LB.dispatch([A()], async () => "ok", { scope: "f", breaker });
		await expect(LB.dispatch([A()], async () => { throw new Error("x"); }, { scope: "f", breaker, maxFailovers: 0 })).rejects.toThrow();
		expect(await redis.exists("providerlb:open:a")).toBe(0);
	});

	test("usage counters are written with an expiry window", async () => {
		await LB.dispatch([A()], async () => {}, { scope: "ux", usageWindowSec: 100 });
		expect(await redis.get("providerlb:usage:a")).toBe("1");
		expect(redis.expiry.get("providerlb:usage:a")).toBeGreaterThan(Date.now());
	});
});

describe("failover", () => {
	test("switches to the next provider once when the first fails", async () => {
		const calls = [];
		const result = await LB.dispatch([A(), B(), C()], async (p) => {
			calls.push(p.provider_code);
			if (p.provider_code === "a") throw new Error("a down");
			return "served-by-" + p.provider_code;
		}, { policy: "round_robin", scope: "fo", idempotent: true });
		expect(calls).toEqual(["a", "b"]);
		expect(result).toBe("served-by-b");
	});

	test("does not keep going: with two failures it stops after the second provider", async () => {
		const calls = [];
		await expect(LB.dispatch([A(), B(), C()], async (p) => {
			calls.push(p.provider_code);
			throw new Error(p.provider_code + " down");
		}, { policy: "round_robin", scope: "fo2", idempotent: true })).rejects.toThrow("b down");
		expect(calls).toEqual(["a", "b"]);
	});

	test("maxFailovers 0 turns switching off", async () => {
		const calls = [];
		await expect(LB.dispatch([A(), B()], async (p) => { calls.push(p.provider_code); throw new Error("down"); }, { scope: "fo3", maxFailovers: 0, idempotent: true })).rejects.toThrow();
		expect(calls).toHaveLength(1);
	});

	test.each([400, 404, 413, 422])("a %i is the caller's problem and is not sent to another provider", async (status) => {
		const calls = [];
		await expect(LB.dispatch([A(), B()], async (p) => {
			calls.push(p.provider_code);
			const e = new Error("rejected"); e.response = { status }; throw e;
		}, { scope: "re" })).rejects.toThrow("rejected");
		expect(calls).toHaveLength(1);
	});

	test("a request error does not count against the provider's breaker", async () => {
		const e = new Error("bad"); e.response = { status: 400 };
		await expect(LB.dispatch([A()], async () => { throw e; }, { scope: "re2", breaker: { failureThreshold: 1, cooldownMs: 60000 } })).rejects.toThrow();
		expect(await redis.exists("providerlb:open:a")).toBe(0);
	});

	test("5xx and 429 do switch providers", async () => {
		for (const status of [429, 500, 503]) {
			freshCluster();
			const result = await LB.dispatch([A(), B()], async (p) => {
				if (p.provider_code === "a") { const e = new Error("x"); e.response = { status }; throw e; }
				return "b-served";
			}, { policy: "round_robin", scope: "5xx", idempotent: true });
			expect(result).toBe("b-served");
		}
	});
});

describe("failover safety (no duplicated actions)", () => {
	const fails = (code, extra = {}) => async (p) => {
		if (p.provider_code !== "a") return "b-served";
		const e = new Error("a failed"); Object.assign(e, extra); throw e;
	};
	const opts = (o = {}) => ({ policy: "round_robin", scope: "safe", ...o });

	test.each([["ECONNREFUSED"], ["ENOTFOUND"], ["EAI_AGAIN"], ["EHOSTUNREACH"]])("%s proves the request never arrived, so it switches without idempotent", async (code) => {
		freshCluster();
		expect(await LB.dispatch([A(), B()], fails("a", { code }), opts())).toBe("b-served");
	});

	test.each([[429], [503]])("HTTP %i switches without idempotent", async (status) => {
		freshCluster();
		expect(await LB.dispatch([A(), B()], fails("a", { response: { status } }), opts())).toBe("b-served");
	});

	test.each([[{ response: { status: 500 } }], [{ response: { status: 504 } }], [{ code: "ECONNABORTED" }], [{ code: "ECONNRESET" }], [{}]])("%j may have been processed, so it is NOT sent to a second provider", async (extra) => {
		freshCluster();
		const calls = [];
		await expect(LB.dispatch([A(), B()], async (p) => { calls.push(p.provider_code); return fails("a", extra)(p); }, opts())).rejects.toThrow("a failed");
		expect(calls).toEqual(["a"]);
	});

	test("the caller can declare a call idempotent to allow switching on any failure", async () => {
		freshCluster();
		expect(await LB.dispatch([A(), B()], fails("a", { response: { status: 500 } }), opts({ idempotent: true }))).toBe("b-served");
	});

	test("an unsafe failure still counts against the provider's breaker", async () => {
		freshCluster();
		const breaker = { failureThreshold: 1, cooldownMs: 60000 };
		await expect(LB.dispatch([A(), B()], fails("a", { response: { status: 500 } }), opts({ breaker }))).rejects.toThrow();
		expect(await redis.exists("providerlb:open:a")).toBe(1);
	});
});

describe("redis outage", () => {
	test("falls back to local state and still serves the request", async () => {
		redis.failing = true;
		const counts = await tally([A(), B()], 6, { policy: "round_robin", scope: "out" });
		expect(counts).toEqual({ a: 3, b: 3 });
	});

	test("works when Redis is not connected at all", async () => {
		redis.status = "connecting";
		expect(await LB.dispatch([A()], async () => "ok", { scope: "nc" })).toBe("ok");
	});

	test("works when the cache layer has no Redis instance", async () => {
		global._CACHE = { getRedisInstance: () => null };
		expect(await LB.dispatch([A()], async () => "ok", { scope: "nr" })).toBe("ok");
	});
});

describe("stats", () => {
	test("reports live numbers per provider", async () => {
		await LB.dispatch([A(), B()], async () => {}, { policy: "round_robin", scope: "st" });
		const stats = await LB.stats([A(), B()]);
		expect(stats.find(s => s.provider_code === "a")).toMatchObject({ inflight: 0, usage: 1, breaker_open: false });
		expect(stats.find(s => s.provider_code === "b").usage).toBe(0);
	});
});

describe("PROVIDERS.sendLB", () => {
	let PROVIDERS, rows, sent;

	beforeEach(() => {
		global.PROVIDER_LOAD_BALANCER = LB;
		global._ = require("lodash");
		rows = [
			{ provider_code: "m1", provider_engine: "mistral", guid: "global", params: "" },
			{ provider_code: "m2", provider_engine: "mistral", guid: "g1", params: "" },
		];
		sent = [];
		global._DB = { db_selectQ: async (db, table, cols, where) => ({ results: rows.filter(r => !where.provider_engine || r.provider_engine === where.provider_engine) }) };
		jest.resetModules();
		PROVIDERS = require("../../api/controllers/providers");
		// send() is the direct path; replace the network part, keep everything else real
		PROVIDERS.send = async (guid, code, endpoint, payload) => {
			sent.push(code);
			if (PROVIDERS.failing === code) throw new Error(code + " down");
			return { servedBy: code, endpoint, payload };
		};
		PROVIDERS.failing = null;
	});

	test("balances across every provider of the engine", async () => {
		await PROVIDERS.sendLB("g1", "mistral", "/chat", { q: 1 }, { policy: "round_robin" });
		await PROVIDERS.sendLB("g1", "mistral", "/chat", { q: 2 }, { policy: "round_robin" });
		expect(sent.sort()).toEqual(["m1", "m2"]);
	});

	test("passes endpoint and payload through unchanged", async () => {
		const res = await PROVIDERS.sendLB("g1", "mistral", "/chat", { q: 1 });
		expect(res).toMatchObject({ endpoint: "/chat", payload: { q: 1 } });
	});

	test("a failed POST is not re-sent to the other provider when it may have been processed", async () => {
		PROVIDERS.failing = "m1";
		await expect(PROVIDERS.sendLB("g1", "mistral", "/chat", {}, { policy: "round_robin" })).rejects.toThrow("m1 down");
		expect(sent).toEqual(["m1"]);
	});

	test("a POST declared idempotent switches to the other provider once", async () => {
		PROVIDERS.failing = "m1";
		const res = await PROVIDERS.sendLB("g1", "mistral", "/chat", {}, { policy: "round_robin", idempotent: true });
		expect(res.servedBy).toBe("m2");
	});

	test("a GET switches to the other provider by default", async () => {
		PROVIDERS.failing = "m1";
		const res = await PROVIDERS.sendLB("g1", "mistral", "/status", null, { policy: "round_robin" }, "GET");
		expect(res.servedBy).toBe("m2");
	});

	test("a POST switches when the first provider refused the connection", async () => {
		PROVIDERS.send = async (guid, code) => { sent.push(code); if (code === "m1") { const e = new Error("refused"); e.code = "ECONNREFUSED"; throw e; } return { servedBy: code }; };
		const res = await PROVIDERS.sendLB("g1", "mistral", "/chat", {}, { policy: "round_robin" });
		expect(res.servedBy).toBe("m2");
	});

	test("an engine with no providers is an error", async () => {
		await expect(PROVIDERS.sendLB("g1", "unknown", "/x", {})).rejects.toThrow(/No providers found/);
	});

	test("an engine must be given", async () => {
		await expect(PROVIDERS.sendLB("g1", "", "/x", {})).rejects.toThrow(/engine not specified/);
	});
});
