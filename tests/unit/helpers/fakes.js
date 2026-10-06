"use strict";

// Small in-memory stand-ins for the pieces of the app that need Redis or a running server, so security-relevant
// logic can be exercised without either. Only the calls the code under test actually makes are implemented.

class FakeRedis {
	constructor() { this.data = new Map(); this.sets = new Map(); }

	on() {}
	async get(key) { return this.data.has(key) ? this.data.get(key) : null; }
	async set(key, value) { this.data.set(key, String(value)); return "OK"; }
	async del(key) { return this.data.delete(key) | this.sets.delete(key); }
	async incr(key) { const n = Number(this.data.get(key) || 0) + 1; this.data.set(key, String(n)); return n; }
	async expire() { return 1; }
	async sadd(key, member) { if (!this.sets.has(key)) this.sets.set(key, new Set()); this.sets.get(key).add(member); }
	async smembers(key) { return [...(this.sets.get(key) || [])]; }
}

// Mirrors the _CACHE helper surface used by the code under test, backed by a FakeRedis
function fakeCache(redis = new FakeRedis()) {
	return {
		redis,
		getRedisInstance: () => redis,
		initialize: async () => {},
		fetchDataSync: async (key, defaultValue = false) => {
			const raw = await redis.get(key);
			if (raw === null) return defaultValue;
			try { return JSON.parse(raw); } catch (e) { return raw; }
		},
		storeData: async (key, value) => redis.set(key, typeof value === "object" ? JSON.stringify(value) : value),
		storeDataEx: async (key, value) => redis.set(key, typeof value === "object" ? JSON.stringify(value) : value),
		deleteKey: async (key) => redis.del(key)
	};
}

// Same constructor shape as the app's LogiksError (api/server.js)
class LogiksError extends Error {
	constructor(message = "Source Not Found", errCode = 404, errShortName = "INTERNAL_ONLY", errObj = {}) {
		super(message);
		this.code = errCode;
		this.type = errShortName;
		this.data = errObj;
		this.name = "LogiksError";
	}
}

module.exports = { FakeRedis, fakeCache, LogiksError };
