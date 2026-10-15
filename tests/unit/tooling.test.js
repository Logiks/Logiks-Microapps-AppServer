"use strict";

// TOOLING: the tooling server's wire format (flat /run bodies, results wrapped in { response }, errors returned as
// HTTP 200), temporary file links for extraction, and what does and doesn't trip the circuit breaker.

const { fakeCache } = require("./helpers/fakes");

global._ = require("lodash");
global.moment = require("moment");

let TOOLING;
let calls;
let respond; // (cfg) => data, or throws an axios-style error
let db;

const URL_BASE = "http://tools.test:10005";

const axiosError = (status, data) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

beforeEach(() => {
	jest.resetModules();
	jest.spyOn(console, "error").mockImplementation(() => {});
	jest.spyOn(console, "log").mockImplementation(() => {});

	global._CACHE = fakeCache();
	global.CONFIG = {
		aicore: {
			enabled: true,
			retry: { maxAttempts: 1 },
			breaker: { failureThreshold: 3, cooldownMs: 30000 },
			tooling: { enabled: true, url: URL_BASE + "/", token: "tok", publicBaseUrl: "http://appserver.lan:9999/" }
		}
	};

	calls = [];
	respond = () => ({});
	global.axios = jest.fn(async (cfg) => { calls.push(cfg); return { data: respond(cfg) }; });

	db = { updates: [], files: [{ id: 7, path_uri: "docs/policy.pdf", guid: "g1", blocked: "false" }] };
	global._DB = {
		db_selectQ: async (d, table, cols, where) => ({ results: db.files.filter(f => Object.entries(where).every(([k, v]) => f[k] === v)) }),
		db_updateQ: async (d, table, data, where) => { db.updates.push({ table, data, where }); return {}; }
	};
	global.FILES = { publishFile: jest.fn(async (guid, id) => `http://localhost:9999/api/public/files/Ab12Cd34.pdf?exp=2026-10-15 18:00:00`) };

	TOOLING = require("../../api/controllers/tooling");
});

afterEach(() => jest.restoreAllMocks());

describe("TOOLING.execute", () => {
	test("sends a flat /run body with the bearer token and returns the tool's own result", async () => {
		respond = () => ({ response: { status: "success", embeddings: [[1, 2]], dimension: 2 } });

		const result = await TOOLING.execute("g1", "embedding", { text: "hi" });

		expect(calls[0]).toMatchObject({ url: URL_BASE + "/run", method: "POST", headers: { Authorization: "Bearer tok" } });
		expect(calls[0].data).toEqual({ command: "run", tool: "embedding", text: "hi" });
		expect(result).toMatchObject({ status: "success", dimension: 2 });
	});

	test("a tool error is thrown whether the server wraps it in `response` or not", async () => {
		respond = () => ({ response: { status: "error", message: "Parameter 'url' or 'file_path' is required." } });
		await expect(TOOLING.execute("g1", "unstructured_tool", {})).rejects.toThrow(/unstructured_tool.*'url' or 'file_path'/);

		respond = () => ({ status: "error", message: "Tool 'nope' not found in the 'tools' folder." });
		await expect(TOOLING.execute("g1", "nope", {})).rejects.toThrow(/not found/);
	});

	test("tool errors never open the breaker, because the server did answer", async () => {
		respond = () => ({ response: { status: "error", message: "bad input" } });
		for (let i = 0; i < 6; i++) await expect(TOOLING.execute("g1", "t", {})).rejects.toThrow(/bad input/);
		expect(calls).toHaveLength(6);
	});

	test("an unreachable server opens the breaker, and later calls fail without a request", async () => {
		respond = () => { throw new Error("connect ECONNREFUSED"); };
		for (let i = 0; i < 3; i++) await expect(TOOLING.execute("g1", "t", {})).rejects.toThrow(/request failed/);

		await expect(TOOLING.execute("g1", "t", {})).rejects.toThrow(/Circuit breaker open/);
		expect(calls).toHaveLength(3);
	});

	test("an HTTP error body's detail is surfaced", async () => {
		respond = () => { throw axiosError(500, { detail: "An error occurred: 400: Tool parameter is required" }); };
		await expect(TOOLING.execute("g1", "t", {})).rejects.toThrow(/Tool parameter is required/);
	});

	test("without a token no Authorization header is sent", async () => {
		jest.resetModules();
		delete CONFIG.aicore.tooling.token;
		TOOLING = require("../../api/controllers/tooling");
		respond = () => ({ response: { status: "success" } });

		await TOOLING.execute("g1", "t");
		expect(calls[0].headers).toEqual({});
	});

	test("a missing tool name is rejected before any request", async () => {
		await expect(TOOLING.execute("g1", "")).rejects.toThrow(/tool is required/);
		expect(calls).toHaveLength(0);
	});
});

describe("TOOLING not configured", () => {
	test("is disabled, and using it is a clear error", async () => {
		jest.resetModules();
		CONFIG.aicore.tooling.enabled = false;
		TOOLING = require("../../api/controllers/tooling");

		expect(TOOLING.isEnabled()).toBe(false);
		await expect(TOOLING.extract("g1", 7)).rejects.toThrow(/not configured/);
		expect(await TOOLING.health("g1")).toMatchObject({ ok: false });
	});
});

describe("TOOLING.extract", () => {
	beforeEach(() => { respond = () => ({ response: { status: "success", data: { extracted_text: "Dummy PDF file" } } }); });

	test("publishes a stored file as a temporary link on the address the tooling server can reach, then retires it", async () => {
		const text = await TOOLING.extract("g1", 7);

		expect(text).toBe("Dummy PDF file");
		expect(FILES.publishFile).toHaveBeenCalledWith("g1", 7, expect.stringMatching(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/), expect.anything());

		const sent = calls[0].data;
		expect(sent.tool).toBe("unstructured_tool");
		expect(sent.url).toMatch(/^http:\/\/appserver\.lan:9999\/api\/public\/files\/Ab12Cd34\.pdf\?/);

		expect(db.updates).toEqual([{ table: "files_published", data: { blocked: "true" }, where: { guid: "g1", uri: "Ab12Cd34.pdf" } }]);
	});

	test("the temporary link is retired even when the extraction fails", async () => {
		respond = () => ({ response: { status: "error", message: "No text could be extracted from the file." } });

		await expect(TOOLING.extract("g1", 7)).rejects.toThrow(/No text could be extracted/);
		expect(db.updates).toHaveLength(1);
	});

	test("a failure to retire the link does not fail the extraction", async () => {
		global._DB.db_updateQ = async () => { throw new Error("db down"); };
		expect(await TOOLING.extract("g1", 7)).toBe("Dummy PDF file");
	});

	test("a path_uri is looked up within the caller's tenant only", async () => {
		await TOOLING.extract("g1", "docs/policy.pdf");
		expect(FILES.publishFile.mock.calls[0][1]).toBe(7);

		await expect(TOOLING.extract("other-tenant", "docs/policy.pdf")).rejects.toThrow(/no file found/);
	});

	test("a public URL is passed straight through with no link published", async () => {
		await TOOLING.extract("g1", "https://example.com/a.pdf");
		expect(calls[0].data.url).toBe("https://example.com/a.pdf");
		expect(FILES.publishFile).not.toHaveBeenCalled();
		expect(db.updates).toEqual([]);
	});

	test.each(["http://localhost/x.pdf", "http://127.0.0.1:8080/x", "http://192.168.0.31:10005/list_tools", "http://10.1.2.3/x", "http://[::1]/x", "http://169.254.169.254/latest"])
		("a URL aimed at %s is refused", async (url) => {
			await expect(TOOLING.extract("g1", url)).rejects.toThrow(/private or local/);
			expect(calls).toHaveLength(0);
		});

	test("private URLs can be allowed explicitly", async () => {
		jest.resetModules();
		CONFIG.aicore.tooling.allowPrivateUrls = true;
		TOOLING = require("../../api/controllers/tooling");

		await TOOLING.extract("g1", "http://192.168.0.5/a.pdf");
		expect(calls[0].data.url).toBe("http://192.168.0.5/a.pdf");
	});

	test("reads text from the page-wise tools' list of chunks", async () => {
		respond = () => ({ response: { status: "success", data: [{ content: "page one", page_number: "1" }, { content: "page two", page_number: "2" }], callback: null } });
		expect(await TOOLING.extract("g1", "https://example.com/a.pdf", null, { tool: "extraction_pagewise" })).toBe("page one\n\npage two");
		expect(calls[0].data.tool).toBe("extraction_pagewise");
	});

	test("a file with no text comes back as an empty string", async () => {
		respond = () => ({ response: { status: "success", data: {} } });
		expect(await TOOLING.extract("g1", "https://example.com/a.pdf")).toBe("");
	});

	test("extraction is attempted once and with the long timeout", async () => {
		CONFIG.aicore.retry = { maxAttempts: 3, baseDelayMs: 1 };
		respond = () => { throw new Error("socket hang up"); };

		await expect(TOOLING.extract("g1", "https://example.com/a.pdf")).rejects.toThrow();
		expect(calls).toHaveLength(1);
		expect(calls[0].timeout).toBe(300000);
	});

	test("nothing to extract is an error", async () => {
		await expect(TOOLING.extract("g1", "")).rejects.toThrow(/required/);
	});
});

describe("TOOLING.listTools / embed / health", () => {
	test("lists the server's tools and caches the answer", async () => {
		respond = () => ({ tools: [{ name: "ocr", description: "OCR", inputSchema: { type: "object" } }, { name: "embedding" }] });

		const first = await TOOLING.listTools("g1");
		const second = await TOOLING.listTools("g1");

		expect(first.map(t => t.name)).toEqual(["ocr", "embedding"]);
		expect(second).toEqual(first);
		expect(calls).toHaveLength(1);

		await TOOLING.listTools("g1", true);
		expect(calls).toHaveLength(2);
	});

	test("embed sends text or texts depending on the input", async () => {
		respond = () => ({ response: { status: "success", embeddings: [[0.1]], dimension: 1, model: "m" } });

		await TOOLING.embed("g1", "one");
		await TOOLING.embed("g1", ["a", "b"], { model: "bge" });

		expect(calls[0].data).toMatchObject({ tool: "embedding", text: "one" });
		expect(calls[1].data).toMatchObject({ tool: "embedding", texts: ["a", "b"], model: "bge" });
		expect((await TOOLING.embed("g1", "one")).dimension).toBe(1);
	});

	test("health reports a dead server instead of throwing", async () => {
		respond = () => ({ tools: [{ name: "a" }, { name: "b" }] });
		expect(await TOOLING.health("g1")).toMatchObject({ ok: true, tools: 2 });

		respond = () => { throw new Error("connect ECONNREFUSED"); };
		expect(await TOOLING.health("g1")).toMatchObject({ ok: false });
	});

	test("start and result use the async lane", async () => {
		respond = (cfg) => cfg.method === "POST" ? { status: "processing", reference_id: "ref-1" } : { status: "processing", reference_id: "ref-1" };

		expect(await TOOLING.start("g1", "unstructured_tool", { url: "https://example.com/a.pdf" })).toEqual({ referenceId: "ref-1", status: "processing" });
		expect(calls[0].url).toBe(URL_BASE + "/initiate_run");

		await TOOLING.result("g1", "ref 1");
		expect(calls[1].url).toBe(URL_BASE + "/get_result?reference_id=ref%201");
	});
});
