"use strict";

// KNOWLEDGE: routing across Vector-Gateway servers, tolerance of a dead/invalid server, and the data_index
// bookkeeping that lets search skip empty bases. The database and the gateways are in-memory fakes.

const { fakeCache } = require("./helpers/fakes");

global._ = require("lodash");
global.MISC = { generateDefaultDBRecord: () => ({}) };

let rows;
global._DB = {
	db_selectQ: async (db, table, cols, where) => ({
		results: rows.filter(r => Object.entries(where).every(([k, v]) => r[k] === v)).map(r => ({ ...r }))
	}),
	db_insertQ1: async (db, table, row) => { rows.push({ id: rows.length + 1, ...row }); return { insertId: rows.length }; },
	db_updateQ: async (db, table, data, where) => {
		rows.filter(r => Object.entries(where).every(([k, v]) => r[k] === v)).forEach(r => Object.assign(r, data));
		return { affectedRows: 1 };
	}
};

let KNOWLEDGE;
let gateways; // url -> (path, body, headers) => response data, or throws { status, data }
let calls;

const base = (code, url, extra = {}) => ({
	id: rows.length + 1, guid: "g1", knowledge_code: code, title: code, server_url: url, authorization_key: "secret-" + code,
	db_id: "main", tenant_id: "", namespace: "ns-" + code, params: "{}", data_index: null, blocked: "false", ...extra
});
const indexOf = (code) => JSON.parse(rows.find(r => r.knowledge_code === code).data_index || "{}");
const flush = () => new Promise(resolve => setImmediate(resolve)); // fire-and-forget index writes

beforeEach(() => {
	jest.resetModules();
	jest.spyOn(console, "error").mockImplementation(() => {});

	global._CACHE = fakeCache();
	global.CONFIG = { aicore: { retry: { maxAttempts: 1 }, breaker: { failureThreshold: 3, cooldownMs: 30000 } } };

	rows = [];
	calls = [];
	gateways = {};
	global.axios = jest.fn(async (cfg) => {
		calls.push(cfg);
		const origin = cfg.url.match(/^https?:\/\/[^/]+/)[0];
		const handler = gateways[origin];
		if (!handler) { const e = new Error("connect ECONNREFUSED"); throw e; }
		return { data: handler(cfg.url.slice(origin.length), cfg.data, cfg.headers) };
	});

	KNOWLEDGE = require("../../api/controllers/knowledge");
});

afterEach(() => jest.restoreAllMocks());

const searchHit = (docId, score, text) => ({ docId, chunk_index: 0, score, text });

describe("KNOWLEDGE.search", () => {
	test("queries each base on its own server with its own key, and merges results best-first", async () => {
		rows.push(base("support", "http://a:1"), base("legal", "http://b:2"));
		gateways["http://a:1"] = () => ({ status: "ok", results: [searchHit("d1", 0.4, "from support")] });
		gateways["http://b:2"] = () => ({ status: "ok", results: [searchHit("d9", 0.9, "from legal")] });

		const hits = await KNOWLEDGE.search("g1", "refund policy", false, { scopes: ["support", "legal"] }, {}, 5);

		expect(hits.map(h => h.text)).toEqual(["from legal", "from support"]);
		expect(hits[0]).toMatchObject({ knowledge: "legal", docId: "d9", score: 0.9 });

		const toLegal = calls.find(c => c.url === "http://b:2/vdb/search");
		expect(toLegal.headers.Authorization).toBe("Bearer secret-legal");
		expect(toLegal.data).toMatchObject({ dbId: "main", tenantId: "g1", namespace: "ns-legal", query: "refund policy", limit: 5, rerank: true });
	});

	test("a base with its own tenant_id uses it instead of the caller's guid", async () => {
		rows.push(base("support", "http://a:1", { tenant_id: "shared-tenant" }));
		gateways["http://a:1"] = () => ({ status: "ok", results: [] });

		await KNOWLEDGE.search("g1", "q", false, { scopes: ["support"] });
		expect(calls[0].data.tenantId).toBe("shared-tenant");
	});

	test("a server that is down does not fail the search, and the failure is recorded on that base", async () => {
		rows.push(base("up", "http://a:1"), base("down", "http://dead:9"));
		gateways["http://a:1"] = () => ({ status: "ok", results: [searchHit("d1", 0.5, "still here")] });

		const hits = await KNOWLEDGE.search("g1", "q", false, { scopes: ["up", "down"] });
		await flush();

		expect(hits.map(h => h.text)).toEqual(["still here"]);
		expect(indexOf("down").lastError).toMatch(/Vector-Gateway request failed/);
		expect(indexOf("up").lastError).toBeUndefined();
	});

	test("the gateway's 200-with-status-error is a failure, not an empty result", async () => {
		rows.push(base("bad", "http://a:1"));
		gateways["http://a:1"] = () => ({ status: "error", msg: "Input Validation Failed", errors: { namespace: "required" } });

		expect(await KNOWLEDGE.search("g1", "q", false, { scopes: ["bad"] })).toEqual([]);
		await flush();
		expect(indexOf("bad").lastError).toMatch(/Input Validation Failed/);
	});

	test("a base that a sync showed empty is not queried; unknown and blocked codes are ignored", async () => {
		rows.push(
			base("empty", "http://a:1", { data_index: JSON.stringify({ docCount: 0, exact: true, lastSyncAt: "2026-10-01T00:00:00Z" }) }),
			base("full", "http://a:1"),
			base("off", "http://a:1", { blocked: "true" })
		);
		gateways["http://a:1"] = () => ({ status: "ok", results: [] });

		await KNOWLEDGE.search("g1", "q", false, { scopes: ["empty", "full", "off", "nope"] });

		expect(calls.map(c => c.data.namespace)).toEqual(["ns-full"]);
	});

	test("no scopes or no query means no gateway call", async () => {
		rows.push(base("support", "http://a:1"));
		expect(await KNOWLEDGE.search("g1", "q", false, { scopes: [] })).toEqual([]);
		expect(await KNOWLEDGE.search("g1", "", false, { scopes: ["support"] })).toEqual([]);
		expect(calls).toHaveLength(0);
	});

	test("a chunk returned twice by one base is shown once, and unscored hits sort last", async () => {
		rows.push(base("a", "http://a:1"), base("b", "http://b:2"));
		gateways["http://a:1"] = () => ({ results: [searchHit("d1", 0.5, "dup"), searchHit("d1", 0.5, "dup"), { docId: "d2", text: "no score" }] });
		gateways["http://b:2"] = () => ({ results: [searchHit("d1", 0.5, "dup")] });

		const hits = await KNOWLEDGE.search("g1", "q", false, { scopes: ["a", "b"] }, {}, 10);

		// d1/chunk 0 exists in both bases, and those are different knowledge, so one copy per base stays
		expect(hits.map(h => `${h.knowledge}:${h.text}`).sort()).toEqual(["a:dup", "a:no score", "b:dup"]);
		expect(hits[hits.length - 1].text).toBe("no score");
	});
});

describe("KNOWLEDGE strict search and extract", () => {
	test("strict search throws a base's failure instead of skipping it", async () => {
		rows.push(base("down", "http://dead:9"));
		await expect(KNOWLEDGE.search("g1", "q", false, { scopes: ["down"] }, { strict: true })).rejects.toThrow(/Vector-Gateway request failed/);
		expect(await KNOWLEDGE.search("g1", "q", false, { scopes: ["down"] })).toEqual([]);
	});

	test("extract returns the tooling server's text, and null when the file has none", async () => {
		global.TOOLING = { extract: jest.fn(async () => "  some text  ") };
		expect(await KNOWLEDGE.extract("g1", 7, { ctx: 1 })).toBe("  some text  ");
		expect(TOOLING.extract).toHaveBeenCalledWith("g1", 7, { ctx: 1 });

		TOOLING.extract = async () => "   ";
		expect(await KNOWLEDGE.extract("g1", 7)).toBeNull();
	});

	test("ingestKnowledge extracts, then ingests under the file as docId", async () => {
		global.TOOLING = { extract: async () => "Refunds take 5 days" };
		rows.push(base("support", "http://a:1"));
		gateways["http://a:1"] = () => ({ accepted: true, chunks: 1 });

		global.KNOWLEDGE = KNOWLEDGE;
		const AICORE = require("../../api/controllers/aicore");
		const result = await AICORE.ingestKnowledge("support", 7, { meta: { user: { guid: "g1" } } }, { payload: { team: "cx" } });

		expect(result).toMatchObject({ ingested: true, docId: "7" });
		expect(calls[0].data).toMatchObject({ docId: "7", text: "Refunds take 5 days", payload: { source: "7", team: "cx" } });
	});
});

describe("KNOWLEDGE ingest and data_index", () => {
	test("ingest sends the gateway's field names, replaces by default, and counts the document", async () => {
		rows.push(base("support", "http://a:1", { params: JSON.stringify({ chunk_size: 500, chunk_overlap: 50 }) }));
		gateways["http://a:1"] = () => ({ accepted: true, chunks: 3 });

		await KNOWLEDGE.ingest("g1", "support", 42, "some text", { source: "x" });

		expect(calls[0].url).toBe("http://a:1/vdb/ingest");
		expect(calls[0].data).toMatchObject({
			dbId: "main", tenantId: "g1", namespace: "ns-support", docId: "42", text: "some text",
			payload: { source: "x" }, replace: true, chunk_size: 500, chunk_ovarlap: 50
		});
		expect(indexOf("support")).toMatchObject({ ingestedSince: 1 });
		expect(indexOf("support").lastIngestAt).toBeTruthy();
	});

	test("data_index holds counters only - never document text", async () => {
		rows.push(base("support", "http://a:1"));
		gateways["http://a:1"] = () => ({ accepted: true, chunks: 1 });

		await KNOWLEDGE.ingest("g1", "support", "d1", "a very long document body");
		expect(rows[0].data_index).not.toMatch(/long document body|d1/);
	});

	test("ingesting into a base a sync found empty makes it searchable again", async () => {
		rows.push(base("support", "http://a:1", { data_index: JSON.stringify({ docCount: 0, exact: true, lastSyncAt: "2026-10-01T00:00:00Z" }) }));
		gateways["http://a:1"] = (path) => path === "/vdb/search" ? { results: [searchHit("d1", 1, "hello")] } : { accepted: true, chunks: 1 };

		expect(await KNOWLEDGE.search("g1", "q", false, { scopes: ["support"] })).toEqual([]);
		await KNOWLEDGE.ingest("g1", "support", "d1", "hello");
		expect(await KNOWLEDGE.search("g1", "q", false, { scopes: ["support"] })).toHaveLength(1);
	});

	test("ingestBatch is sent once (no retry), and removeDocuments counts deletions", async () => {
		global.CONFIG.aicore.retry = { maxAttempts: 3, baseDelayMs: 1 };
		rows.push(base("support", "http://a:1"));
		let attempts = 0;
		global.axios = jest.fn(async (cfg) => {
			if (cfg.url.endsWith("/vdb/ingest/batch")) {
				attempts++;
				const e = new Error("Service Unavailable");
				e.response = { status: 503, data: {} };
				throw e;
			}
			return { data: { status: "ok" } };
		});

		await expect(KNOWLEDGE.ingestBatch("g1", "support", [{ docId: "a", text: "x" }, { docId: "b", text: "y" }])).rejects.toThrow(/Vector-Gateway request failed/);
		expect(attempts).toBe(1);

		await KNOWLEDGE.removeDocuments("g1", "support", ["a", "b"]);
		expect(indexOf("support").removedSince).toBe(2);
	});

	test("sync takes the gateway's total, resets the since-counters and clears lastIngestAt for an empty base", async () => {
		rows.push(base("support", "http://a:1", { data_index: JSON.stringify({ ingestedSince: 7, removedSince: 2, lastIngestAt: "x" }) }));
		gateways["http://a:1"] = () => ({ status: "ok", documents: [], total: 12345, truncated: false });

		await KNOWLEDGE.sync("g1", "support");
		expect(indexOf("support")).toMatchObject({ docCount: 12345, exact: true, ingestedSince: 0, removedSince: 0 });
		expect(calls[0].data.limit).toBe(1);

		gateways["http://a:1"] = () => ({ status: "ok", documents: [], total: 0, truncated: false });
		await KNOWLEDGE.sync("g1", "support");
		expect(indexOf("support")).toMatchObject({ docCount: 0, lastIngestAt: null });
	});

	test("getDocument turns the gateway's 404 into { found: false }", async () => {
		rows.push(base("support", "http://a:1"));
		global.axios = jest.fn(async () => { const e = new Error("nf"); e.response = { status: 404, data: { message: "Document not found" } }; throw e; });

		expect(await KNOWLEDGE.getDocument("g1", "support", "missing")).toEqual({ found: false, docId: "missing" });
	});

	test("working with an unknown base is an error, not a silent no-op", async () => {
		await expect(KNOWLEDGE.ingest("g1", "nope", "d", "t")).rejects.toThrow(/not found/);
	});
});

describe("KNOWLEDGE registry", () => {
	test("reads never expose the bearer key, and an upsert without a key keeps the stored one", async () => {
		const created = await KNOWLEDGE.upsert("g1", "support", { serverUrl: "http://a:1", dbId: "main", namespace: "kb", authorizationKey: "k1" }, {});
		expect(created.authorization_key).toBeUndefined();
		expect(created.has_key).toBe(true);
		expect((await KNOWLEDGE.list("g1"))[0].authorization_key).toBeUndefined();

		await KNOWLEDGE.upsert("g1", "support", { serverUrl: "http://a:1", dbId: "main", namespace: "kb2" }, {});
		expect(rows[0].authorization_key).toBe("k1");
		expect(rows[0].namespace).toBe("kb2");
	});

	test("upsert requires the gateway coordinates", async () => {
		await expect(KNOWLEDGE.upsert("g1", "x", { serverUrl: "http://a:1" }, {})).rejects.toThrow(/db_id|namespace/);
	});

	test("an upsert never overwrites data_index", async () => {
		rows.push(base("support", "http://a:1", { data_index: JSON.stringify({ docCount: 5 }) }));
		await KNOWLEDGE.upsert("g1", "support", { serverUrl: "http://a:1", dbId: "main", namespace: "kb" }, {});
		expect(indexOf("support").docCount).toBe(5);
	});

	test("upsert only accepts an http(s) server URL, since the bearer key is sent there", async () => {
		for (const bad of ["ftp://a/b", "javascript:alert(1)", "//a", "not a url"]) {
			await expect(KNOWLEDGE.upsert("g1", "x", { serverUrl: bad, dbId: "d", namespace: "n" }, {})).rejects.toThrow(/http\(s\) URL/);
		}
		expect(rows).toHaveLength(0);
	});

	test("one tenant cannot read another tenant's base", async () => {
		rows.push(base("support", "http://a:1"));
		expect(await KNOWLEDGE.get("other-tenant", "support")).toBeNull();
	});
});

describe("rag.js with real hits", () => {
	test("forced retrieval shows the text and where it came from", async () => {
		global.KNOWLEDGE = { search: async () => [{ text: "Refunds take 5 days", knowledge: "support", docId: "faq-3" }] };
		const RAG = require("../../api/controllers/aicore/rag");

		const msg = await RAG.retrieveForced("g1", "refunds?", { allowed_knowledge: ["support"], params: { knowledgeMode: "forced" } });
		expect(msg.content).toContain("[1] (support/faq-3) Refunds take 5 days");
	});
});
