"use strict";

// QUEUE signs every message and refuses to run anything unsigned, tampered with or expired.
// The broker is replaced by an in-memory fake; the consumer handler is called directly.

const mockBroker = { published: [], handlers: {} };

jest.mock("../../api/helpers/queue/QueueManager", () => class FakeQueueManager {
	async connect() {}
	async publish(queueKey, payload) {
		// a real broker serialises to JSON, so do the same round trip
		mockBroker.published.push({ queueKey, payload: JSON.parse(JSON.stringify(payload)) });
		return true;
	}
	async consume(queueKey, handler) { mockBroker.handlers[queueKey] = handler; }
});

const QUEUE = require("../../api/helpers/queue");

const message = (payload) => ({ id: "m1", payload, toString: () => "m1" });

describe("QUEUE message signing", () => {
	let handled;
	let errorSpy;

	const originalClusterToken = process.env.CLUSTER_TOKEN;

	beforeAll(async () => {
		delete process.env.CLUSTER_TOKEN; // the key must come from authjwt.secret for these tests, wherever they run
		global.CONFIG = { ...global.CONFIG, queue: { host: "nats://fake" }, authjwt: { ...(global.CONFIG.authjwt || {}), secret: "unit-test-secret" } };
		global.SERVER = { getBroker: () => ({ emit: () => {} }) };
		global._DB = { db_insertQ1: async () => {} };
		await QUEUE.initialize();
	});

	afterAll(() => {
		if (originalClusterToken !== undefined) process.env.CLUSTER_TOKEN = originalClusterToken;
	});

	beforeEach(async () => {
		mockBroker.published.length = 0;
		handled = [];
		errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
		jest.spyOn(console, "log").mockImplementation(() => {});
		await QUEUE.setupConsumer("agent", async (payload) => { handled.push(payload); return "done"; });
	});

	afterEach(() => jest.restoreAllMocks());

	const publish = async (payload) => {
		await QUEUE.publish("tenant-1", "agent", payload);
		return mockBroker.published[0];
	};
	const consumer = () => mockBroker.handlers[Object.keys(mockBroker.handlers)[0]];

	test("published messages carry a timestamp and signature", async () => {
		const { payload } = await publish({ agentCode: "a", user: { userId: "u1", roles: ["x"] } });
		expect(payload.__sig).toMatch(/^[0-9a-f]{64}$/);
		expect(payload.__ts).toBeGreaterThan(0);
		expect(payload.guid).toBe("tenant-1");
	});

	test("a genuine message is processed, and the handler never sees the signature fields", async () => {
		const { payload } = await publish({ agentCode: "a", user: { userId: "u1", roles: ["x"] } });
		await consumer()(message(payload));
		expect(handled).toHaveLength(1);
		expect(handled[0]).toEqual({ agentCode: "a", user: { userId: "u1", roles: ["x"] }, guid: "tenant-1" });
	});

	test("changing identity inside a signed message is rejected", async () => {
		const { payload } = await publish({ agentCode: "a", user: { userId: "u1", roles: ["user"] } });
		payload.user.roles = ["admin"];
		await consumer()(message(payload));
		expect(handled).toHaveLength(0);
	});

	test("changing the tenant is rejected", async () => {
		const { payload } = await publish({ agentCode: "a" });
		payload.guid = "tenant-2";
		await consumer()(message(payload));
		expect(handled).toHaveLength(0);
	});

	test("an unsigned message is rejected", async () => {
		await consumer()(message({ agentCode: "a", user: { userId: "attacker", roles: ["admin"] } }));
		expect(handled).toHaveLength(0);
	});

	test("a message signed with another key is rejected", async () => {
		const { payload } = await publish({ agentCode: "a" });
		global.CONFIG.authjwt.secret = "some-other-cluster";
		try {
			await consumer()(message(payload));
		} finally {
			global.CONFIG.authjwt.secret = "unit-test-secret";
		}
		expect(handled).toHaveLength(0);
	});

	test("an expired message is rejected", async () => {
		const { payload } = await publish({ agentCode: "a" });
		const realNow = Date.now;
		Date.now = () => realNow() + 2 * 24 * 3600 * 1000;
		try {
			await consumer()(message(payload));
		} finally {
			Date.now = realNow;
		}
		expect(handled).toHaveLength(0);
	});

	test("a message signed for one queue cannot be replayed on another", async () => {
		const { payload } = await publish({ agentCode: "a" });
		await QUEUE.setupConsumer("other", async (p) => { handled.push(p); });
		await mockBroker.handlers[Object.keys(mockBroker.handlers).find(k => k.endsWith(".other"))](message(payload));
		expect(handled).toHaveLength(0);
	});

	test("key order inside the payload does not matter", async () => {
		const { payload } = await publish({ b: 2, a: { y: 1, x: 2 } });
		const reordered = { __sig: payload.__sig, __ts: payload.__ts, guid: payload.guid, a: { x: 2, y: 1 }, b: 2 };
		await consumer()(message(reordered));
		expect(handled).toHaveLength(1);
	});

	test("publishing is refused when there is nothing to sign with", async () => {
		const saved = { env: process.env.CLUSTER_TOKEN, secret: global.CONFIG.authjwt.secret };
		delete process.env.CLUSTER_TOKEN;
		global.CONFIG.authjwt.secret = undefined;
		try {
			expect(await QUEUE.publish("g", "agent", { a: 1 })).toBe(false);
			expect(mockBroker.published).toHaveLength(0);
		} finally {
			global.CONFIG.authjwt.secret = saved.secret;
			if (saved.env !== undefined) process.env.CLUSTER_TOKEN = saved.env;
		}
	});
});
