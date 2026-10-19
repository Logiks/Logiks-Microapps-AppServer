"use strict";

// AICore x LogiksAI, whole message flow with the LogiksAI server faked at the HTTP layer:
// "how many providers do I have?" -> token minted for (guid, userId) -> schema sent as a tool ->
// model asks for it -> AppServer runs the tool -> result resumed through /msg/continue -> final answer.

const { fakeCache } = require("./helpers/fakes");

global._CACHE = fakeCache();
global._ = require("lodash");

const toolRuns = [];
jest.mock("../../api/controllers/aicore/tooling.js", () => ({
	list: () => [
		{ name: "query_schema", description: "Describe tables", inputSchema: { type: "object", properties: { dbkey: { type: "string" } } } },
		{ name: "query_results", description: "Run a query", inputSchema: { type: "object", properties: { table: { type: "string" } } } }
	],
	run: async (name, args) => {
		toolRuns.push({ name, args });
		if (name === "query_schema") return { tables: { sys_llm_providers: ["id", "name"] } };
		return { rows: [{ count: 7 }] };
	}
}));

const AGENT_LOOP = require("../../api/controllers/aicore/agentLoop");
const LogiksAI = require("../../api/controllers/aicore/engines/logiksai");

const jwt = (exp) => `h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`;
const ctx = { meta: { user: { guid: "tenant-1", userId: "alice" } } };
const persona = { system_prompt: "Answer from data.", model: null, allowed_tools: [], params: {} };
const agent = { max_steps: 6, timeout_ms: 5000 };

// A scripted LogiksAI server: records every call, answers per path.
function fakeServer(script) {
	const calls = [];
	global.axios = jest.fn(async (req) => {
		calls.push(req);
		return { data: await script(req, calls) };
	});
	return calls;
}

const engineSet = (cfg = {}) => [{ key: "logiksai", priority: 1, instance: new LogiksAI({ url: "http://ai.test/", apikey: "KEY", ...cfg }) }];

beforeEach(() => { toolRuns.length = 0; });

test("providers question: token -> /msg with tool schema -> tool run -> /msg/continue -> answer", async () => {
	let step = 0;
	const calls = fakeServer((req) => {
		if (req.url.endsWith("/generateToken")) return { status: "success", token: jwt(Math.floor(Date.now() / 1000) + 3600) };
		if (req.url.endsWith("/msg")) {
			return step++ === 0
				? { status: "success", data: { STATUS: "tool_call_pending", PENDING_TOKEN: "pt-1", PENDING_TOOL_CALLS: [{ id: "c1", name: "query_results", input: { table: "sys_llm_providers" } }] } }
				: { status: "error", errors: "unexpected second /msg" };
		}
		if (req.url.endsWith("/msg/continue")) return { status: "success", data: { STATUS: "success", RESPONSE: "You have 7 providers." } };
	});

	const result = await AGENT_LOOP.executeLoop(engineSet(), {}, "sess-1", persona, agent, "What is the number of providers I have?", ctx, { persist: false });

	expect(result.status).toBe("success");
	expect(result.message).toBe("You have 7 providers.");
	expect(toolRuns).toEqual([{ name: "query_results", args: { table: "sys_llm_providers" } }]);

	const [tokenReq, msgReq, contReq] = calls;

	// token is minted with the tenant guid and the logged-in user id as uuid, using the API key
	expect(tokenReq.url).toBe("http://ai.test/generateToken");
	expect(tokenReq.data).toEqual({ guid: "tenant-1", uuid: "alice" });
	expect(tokenReq.headers.Authorization).toBe("Bearer KEY");

	// the question and the tool schemas go out, with the token and session
	expect(msgReq.headers["auth-token"]).toMatch(/^h\./);
	expect(msgReq.headers.sesskey).toBe("sess-1");
	expect(msgReq.data.msg).toBe("What is the number of providers I have?");
	expect(msgReq.data.tools_available.map(t => t.name)).toEqual(["query_schema", "query_results"]);
	expect(msgReq.data.tools_available[0].inputSchema.type).toBe("object");

	// the tool result is resumed against the pending token, keyed by call id
	expect(contReq.data).toEqual({ sesskey: "sess-1", pending_token: "pt-1", tool_results: { c1: { rows: [{ count: 7 }] } } });
});

test("the token is reused for the same user and re-minted for another", async () => {
	const calls = fakeServer((req) => req.url.endsWith("/generateToken")
		? { status: "success", token: jwt(Math.floor(Date.now() / 1000) + 3600) }
		: { status: "success", data: { STATUS: "success", RESPONSE: "ok" } });
	const [engine] = engineSet();

	const send = (userId) => engine.instance.sendMessage("s", [{ role: "user", content: "hi" }], [], { guid: "g", userId });
	await send("alice"); await send("alice"); await send("bob");

	expect(calls.filter(c => c.url.endsWith("/generateToken")).map(c => c.data.uuid)).toEqual(["alice", "bob"]);
});

test("an expired token is re-minted once on 401", async () => {
	let msgCalls = 0;
	const calls = fakeServer((req) => {
		if (req.url.endsWith("/generateToken")) return { status: "success", token: jwt(Math.floor(Date.now() / 1000) + 3600) };
		if (msgCalls++ === 0) { const e = new Error("x"); e.response = { status: 401, data: { message: "Authorization Failed, Session Expired or Invalid" } }; throw e; }
		return { status: "success", data: { STATUS: "success", RESPONSE: "ok" } };
	});
	const [engine] = engineSet();

	const out = await engine.instance.sendMessage("s", [{ role: "user", content: "hi" }], [], { guid: "g", userId: "u" });

	expect(out.message).toBe("ok");
	expect(calls.filter(c => c.url.endsWith("/generateToken"))).toHaveLength(2);
});

test("a refusal from LogiksAI (unknown persona) is a request error: no retry, breaker untouched", async () => {
	fakeServer((req) => req.url.endsWith("/generateToken")
		? { status: "success", token: jwt(Math.floor(Date.now() / 1000) + 3600) }
		: { status: "error", msg: { SESSKEY: "s" }, errors: "Persona not found, either not available to you or is not published" });
	const [engine] = engineSet();

	await expect(engine.instance.sendMessage("s", [{ role: "user", content: "hi" }], [], { guid: "g", userId: "u" }))
		.rejects.toMatchObject({ status: 400, message: expect.stringContaining("Persona not found") });
});

test("a caller with no guid is refused before anything is sent", async () => {
	const calls = fakeServer(() => ({}));
	const [engine] = engineSet();
	await expect(engine.instance.sendMessage("s", [{ role: "user", content: "hi" }], [], {})).rejects.toThrow(/guid/);
	expect(calls).toHaveLength(0);
});
