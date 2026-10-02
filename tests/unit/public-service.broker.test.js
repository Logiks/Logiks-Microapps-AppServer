"use strict";

const path = require("path");
const { createTestBroker } = require("./helpers/brokerHarness");

describe("public service (in-process broker.call, no HTTP/DB)", () => {
	let broker;

	beforeAll(async () => {
		broker = await createTestBroker([
			path.resolve(__dirname, "../../api/services/public.service.js")
		]);
	});

	afterAll(async () => {
		await broker.stop();
	});

	test("public.ping returns an ok status with a timestamp", async () => {
		const res = await broker.call("public.ping");
		expect(res.status).toBe("ok");
		expect(typeof res.timestamp).toBe("number");
	});

	test("public.health reports healthy", async () => {
		const res = await broker.call("public.health");
		expect(res.status).toBe("ok");
		expect(res.health).toBe("healthy");
	});
});
