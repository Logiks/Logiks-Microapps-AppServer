"use strict";

// MCP sessions live in Redis, so a second gateway process can serve a session the first one created.

const { EventEmitter } = require("events");

const data = new Map();
const fakeRedis = {
	set: async (k, v) => { data.set(k, v); return "OK"; },
	get: async (k) => (data.has(k) ? data.get(k) : null),
	expire: async (k) => (data.has(k) ? 1 : 0),
	del: async (k) => (data.delete(k) ? 1 : 0)
};
global._CACHE = { getRedisInstance: () => fakeRedis };
global.UNIQUEID = { generate: (n) => "a".repeat(n) };

const SESSION = require("../../api/controllers/mcp/session");

beforeEach(() => data.clear());

test("a session is stored in Redis, not only in this process", async () => {
	const s = await SESSION.createSession({ user: { userId: "alice" } });
	expect([...data.keys()]).toEqual([`mcp:session:${s.id}`]);

	const loaded = await SESSION.getSession(s.id);
	expect(loaded.user.userId).toBe("alice");
});

test("changes made after initialize are persisted", async () => {
	const s = await SESSION.createSession({ user: { userId: "alice" } });
	s.initialized = true;
	s.protocolVersion = "2025-03-26";
	s.clientInfo = { name: "client" };
	await SESSION.updateSession(s);

	const loaded = await SESSION.getSession(s.id);
	expect(loaded).toMatchObject({ initialized: true, protocolVersion: "2025-03-26", clientInfo: { name: "client" } });
});

test("unknown, malformed and closed ids give nothing", async () => {
	expect(await SESSION.getSession("short")).toBeNull();
	expect(await SESSION.getSession(undefined)).toBeNull();
	expect(await SESSION.getSession("b".repeat(24))).toBeNull();

	const s = await SESSION.createSession({});
	await SESSION.closeSession(s.id);
	expect(await SESSION.getSession(s.id)).toBeNull();
});

test("the notification stream stays local and is closed with the session", async () => {
	const s = await SESSION.createSession({});
	const res = new EventEmitter();
	res.written = [];
	res.write = (c) => { res.written.push(c); return true; };
	res.end = jest.fn();

	SESSION.attachStream(s.id, res);
	expect(SESSION.sendEvent(s.id, { n: 1 }, "note")).toBe(true);
	expect(res.written.join("")).toContain("event: note");
	expect((await SESSION.getSession(s.id)).sseRes).toBe(res);

	await SESSION.closeSession(s.id);
	expect(res.end).toHaveBeenCalled();
	expect(SESSION.sendEvent(s.id, "x")).toBe(false);
});
