"use strict";

// AICore: conversations are private to the user, engine failures are classified correctly, and tool results reach
// Claude in the shape its API accepts.

const { fakeCache } = require("./helpers/fakes");

global._CACHE = fakeCache();
global._ = require("lodash");
global.MISC = { generateDefaultDBRecord: (ctx) => ({ created_by: ctx?.meta?.user?.userId || "-" }) };

const dbRows = [];
global._DB = {
	db_insertQ1: async (db, table, row) => { dbRows.push({ table, ...row }); return { insertId: dbRows.length }; },
	db_selectQ: async (db, table, cols, where) => ({
		results: dbRows.filter(r => r.table === table && Object.entries(where).every(([k, v]) => r[k] === v))
	})
};

const CONVERSATIONS = require("../../api/controllers/aicore/conversations");
const RESILIENCE = require("../../api/controllers/aicore/resilience");
const Claude = require("../../api/controllers/aicore/engines/claude");

const ctxOf = (userId, guid = "g1") => ({ meta: { user: { userId, guid } } });

describe("conversation privacy", () => {
	beforeEach(() => dbRows.length = 0);

	test("another user who knows the session id gets no history", async () => {
		await CONVERSATIONS.appendTurn("sess-1", "g1", "agent", [{ role: "user", content: "my secret plan" }], ctxOf("alice"));

		expect(await CONVERSATIONS.getHistory("sess-1", ctxOf("alice"))).toHaveLength(1);
		expect(await CONVERSATIONS.getHistory("sess-1", ctxOf("mallory"))).toEqual([]);
		expect(await CONVERSATIONS.getHistory("sess-1", ctxOf("alice", "other-tenant"))).toEqual([]);
	});

	test("two users with the same session id keep separate histories", async () => {
		await CONVERSATIONS.appendTurn("same", "g1", "a", [{ role: "user", content: "alice says" }], ctxOf("alice"));
		await CONVERSATIONS.appendTurn("same", "g1", "a", [{ role: "user", content: "bob says" }], ctxOf("bob"));

		expect((await CONVERSATIONS.getHistory("same", ctxOf("alice")))[0].content).toBe("alice says");
		expect((await CONVERSATIONS.getHistory("same", ctxOf("bob")))[0].content).toBe("bob says");
	});

	test("the stored log can be restricted to the creating user", async () => {
		await CONVERSATIONS.appendTurn("sess-2", "g1", "agent", [{ role: "user", content: "hi" }], ctxOf("alice"));

		expect(await CONVERSATIONS.history("g1", "sess-2", "alice")).toHaveLength(1);
		expect(await CONVERSATIONS.history("g1", "sess-2", "mallory")).toEqual([]);
		expect(await CONVERSATIONS.history("g1", "sess-2")).toHaveLength(1); // internal callers keep the old behaviour
	});
});

describe("RESILIENCE.callEngine", () => {
	const engine = (key, behaviour) => ({ key, instance: { sendMessage: jest.fn(behaviour) } });
	const failing = (status) => async () => { const e = new Error(`HTTP ${status}`); e.status = status; throw e; };

	beforeEach(() => {
		global._CACHE = fakeCache();
		jest.spyOn(console, "error").mockImplementation(() => {});
		jest.spyOn(console, "log").mockImplementation(() => {});
	});
	afterEach(() => jest.restoreAllMocks());

	const run = (engines, cfg = {}) => RESILIENCE.callEngine(engines, "s", [], [], {}, {}, { retry: { maxAttempts: 3, baseDelayMs: 1 }, breaker: { failureThreshold: 2 }, ...cfg });

	test("a rejected request (400) is not retried and does not trip the breaker", async () => {
		const bad = engine("claude", failing(400));
		for (let i = 0; i < 4; i++) await expect(run([bad])).rejects.toThrow(/400/);
		expect(bad.instance.sendMessage).toHaveBeenCalledTimes(4); // once per call, no retries

		// the breaker is still closed: a healthy call reaches the engine
		bad.instance.sendMessage.mockImplementation(async () => ({ message: "ok", toolCalls: [] }));
		await expect(run([bad])).resolves.toMatchObject({ message: "ok" });
	});

	test("server errors are retried, and repeated failure opens the breaker so the next engine is used", async () => {
		const primary = engine("claude", failing(503));
		const backup = engine("openai", async () => ({ message: "from backup", toolCalls: [] }));

		const first = await run([primary, backup]);
		expect(first.engineKey).toBe("openai");
		expect(primary.instance.sendMessage).toHaveBeenCalledTimes(3); // retried

		await run([primary, backup]);
		primary.instance.sendMessage.mockClear();
		await run([primary, backup]);
		expect(primary.instance.sendMessage).not.toHaveBeenCalled(); // breaker open: skipped
	});

	test("a timeout is enforced and cleaned up", async () => {
		const slow = engine("claude", () => new Promise(() => {}));
		await expect(run([slow], { retry: { maxAttempts: 1, timeoutMs: 20 } })).rejects.toThrow(/timed out/);
	});
});

describe("Claude request shaping", () => {
	const send = async (messages) => {
		const create = jest.fn(async () => ({ content: [{ type: "text", text: "ok" }], usage: {} }));
		const engine = new Claude({ apikey: "k" });
		engine._anthropic = { messages: { create } };
		await engine.sendMessage("s", messages, []);
		return create.mock.calls[0][0].messages;
	};

	test("results of parallel tool calls share one user message", async () => {
		const out = await send([
			{ role: "user", content: "do two things" },
			{ role: "assistant", content: "", toolCalls: [{ id: "a", name: "x", arguments: {} }, { id: "b", name: "y", arguments: {} }] },
			{ role: "tool", toolCallId: "a", name: "x", content: "1" },
			{ role: "tool", toolCallId: "b", name: "y", content: "2" }
		]);

		expect(out).toHaveLength(3);
		expect(out[2].role).toBe("user");
		expect(out[2].content.map(b => b.tool_use_id)).toEqual(["a", "b"]);
	});

	test("an assistant turn with neither text nor tool calls is dropped (the API rejects empty content)", async () => {
		const out = await send([{ role: "user", content: "hi" }, { role: "assistant", content: "" }, { role: "user", content: "again" }]);
		expect(out.map(m => m.role)).toEqual(["user", "user"]);
	});

	test("a later user message is not merged into tool results", async () => {
		const out = await send([
			{ role: "assistant", content: "", toolCalls: [{ id: "a", name: "x", arguments: {} }] },
			{ role: "tool", toolCallId: "a", content: "1" },
			{ role: "user", content: "thanks" }
		]);
		expect(out).toHaveLength(3);
		expect(out[2].content).toBe("thanks");
	});
});
