"use strict";

// /ai/knowledge: admin only, always scoped to the caller's tenant.

global._ = require("lodash");

const service = require("../../api/services/ai/knowledge.service");

const asUser = (roles, params = {}, guid = "tenant-a") => ({ meta: { user: { guid, roles } }, params: { knowledgeCode: "kb.support", ...params } });
const run = (action, ctx) => service.actions[action].handler.call({}, ctx);

let seen;
beforeEach(() => {
	seen = [];
	const record = (name) => async (...args) => { seen.push({ name, args }); return { ok: true, found: true, nextCursor: null }; };
	global.KNOWLEDGE = {
		list: record("list"), get: async (...a) => { seen.push({ name: "get", args: a }); return { knowledge_code: "kb.support" }; },
		upsert: record("upsert"), remove: record("remove"), search: record("search"), ingest: record("ingest"),
		ingestBatch: record("ingestBatch"), listDocuments: record("listDocuments"), getDocument: record("getDocument"),
		removeDocuments: record("removeDocuments"), sync: record("sync"), health: record("health")
	};
	global.AICORE = { ingestKnowledge: record("ingestKnowledge") };
	global.TOOLING = { health: record("toolingHealth") };
});

describe("knowledge service", () => {
	const callable = {
		list: {}, get: {}, upsert: { serverUrl: "http://a", dbId: "d", namespace: "n" }, remove: {}, search: { query: "q" },
		ingest: { docId: "d1", text: "t" }, ingestBatch: { documents: [{ docId: "d", text: "t" }] }, ingestFile: { file: 7 },
		listDocuments: {}, getDocument: { docId: "d1" }, removeDocuments: { docIds: ["d1"] }, sync: {}, health: {}, toolingHealth: {}
	};

	test("every action is covered by these tests", () => {
		expect(Object.keys(service.actions).sort()).toEqual(Object.keys(callable).sort());
	});

	test.each(Object.keys(callable))("%s refuses a non-admin and does nothing", async (action) => {
		await expect(run(action, asUser(["user"], callable[action]))).rejects.toThrow("Admin access only");
		await expect(run(action, { meta: {}, params: {} })).rejects.toThrow("Admin access only");
		expect(seen).toEqual([]);
	});

	test.each(Object.keys(callable))("%s works for an admin and uses the caller's own tenant", async (action) => {
		// the body tries to name another tenant - it must be ignored
		await run(action, asUser(["admin"], { ...callable[action], guid: "tenant-b", ownerGuid: "tenant-b" }));

		expect(seen.length).toBeGreaterThan(0);
		seen.forEach(call => { if (call.name !== "ingestKnowledge") expect(call.args[0]).toBe("tenant-a"); });
	});

	test("upsert does not pass the code from the URL into the data", async () => {
		await run("upsert", asUser(["admin"], { serverUrl: "http://a", dbId: "d", namespace: "n" }));
		const call = seen.find(c => c.name === "upsert");
		expect(call.args[1]).toBe("kb.support");
		expect(call.args[2]).not.toHaveProperty("knowledgeCode");
		expect(call.args[2]).toMatchObject({ serverUrl: "http://a", dbId: "d", namespace: "n" });
	});

	test("ingestFile goes through AICORE.ingestKnowledge with the code and file", async () => {
		await run("ingestFile", asUser(["admin"], { file: 7, docId: "policy" }));
		const call = seen.find(c => c.name === "ingestKnowledge");
		expect(call.args[0]).toBe("kb.support");
		expect(call.args[1]).toBe(7);
		expect(call.args[3]).toMatchObject({ docId: "policy" });
	});

	test("a debug search surfaces gateway errors instead of returning nothing", async () => {
		await run("search", asUser(["admin"], { query: "refunds", limit: 3 }));
		const call = seen.find(c => c.name === "search");
		expect(call.args[3]).toEqual({ scopes: ["kb.support"] });
		expect(call.args[4]).toMatchObject({ strict: true });
		expect(call.args[5]).toBe(3);
	});

	test("an unknown base or document is an error, not an empty answer", async () => {
		KNOWLEDGE.get = async () => null;
		await expect(run("get", asUser(["admin"]))).rejects.toThrow(/not found/);
		await expect(run("search", asUser(["admin"], { query: "q" }))).rejects.toThrow(/not found/);

		KNOWLEDGE.getDocument = async () => ({ found: false });
		await expect(run("getDocument", asUser(["admin"], { docId: "nope" }))).rejects.toThrow(/Document 'nope' not found/);
	});
});
