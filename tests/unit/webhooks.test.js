"use strict";

// WEBHOOKS.receiveRequest: auth-key check, and what ends up in the log.

const { LogiksError } = require("./helpers/fakes");
global.LogiksError = LogiksError;
global._ = require("lodash");

const logs = [];
const updates = [];
global.MISC = { generateDefaultDBRecord: () => ({}), executeFunctionByName: async (name, params) => ({ ran: name, params }) };
global.VALIDATIONS = { validateRule: () => ({ status: true, errors: {} }) };

let webhookRow;
global._DB = {
	db_insertQ1: async (db, table, row) => { logs.push(row); return { insertId: 1 }; },
	db_updateQ: async (db, table, data) => { updates.push(data); },
	db_selectQ: async () => ({ results: webhookRow ? [webhookRow] : [] })
};

const WEBHOOKS = require("../../api/controllers/webhooks");

const request = (overrides = {}) => ({
	query: {}, params: { event: "paid" }, headers: {},
	meta: { appInfo: { appid: "app1" }, method: "POST", remoteIP: "1.2.3.4", headers: {} },
	...overrides
});

beforeEach(() => {
	logs.length = 0;
	updates.length = 0;
	webhookRow = { guid: "g1", func_name: "billing.paid", authkey: "s3cret-key", keep_log: "true" };
	jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("webhook authentication", () => {
	test("the right key in the header runs the function", async () => {
		const out = await WEBHOOKS.receiveRequest("hook", request({ meta: { ...request().meta, headers: { "x-webhook-auth": "s3cret-key" } } }));
		expect(out).toMatchObject({ status: "success", ran: "billing.paid" });
	});

	test("a wrong or missing key is refused", async () => {
		expect(await WEBHOOKS.receiveRequest("hook", request())).toMatchObject({ status: "error", message: /Unauthorized/ });
		const wrong = request({ meta: { ...request().meta, headers: { "x-webhook-auth": "s3cret-kez" } } });
		expect(await WEBHOOKS.receiveRequest("hook", wrong)).toMatchObject({ status: "error" });
	});

	test("a key of a different length is refused without throwing", async () => {
		const short = request({ meta: { ...request().meta, headers: { "x-webhook-auth": "x" } } });
		expect(await WEBHOOKS.receiveRequest("hook", short)).toMatchObject({ status: "error" });
	});
});

describe("webhook request log", () => {
	test("credentials are redacted before the request is stored", async () => {
		const req = request({
			query: { auth: "s3cret-key", page: "1" },
			params: { auth: "s3cret-key", event: "paid" },
			headers: { "x-webhook-auth": "s3cret-key", authorization: "Bearer abc", cookie: "sid=1", "content-type": "application/json" },
			meta: { ...request().meta, headers: { "x-webhook-auth": "s3cret-key" } }
		});
		await WEBHOOKS.receiveRequest("hook", req);

		const stored = JSON.parse(logs[0].request_payload);
		expect(logs[0].request_payload).not.toContain("s3cret-key");
		expect(logs[0].request_payload).not.toContain("Bearer abc");
		expect(stored.headers["content-type"]).toBe("application/json");
		expect(stored.query.page).toBe("1");
		expect(stored.headers.authorization).toBe("[REDACTED]");
	});
});
