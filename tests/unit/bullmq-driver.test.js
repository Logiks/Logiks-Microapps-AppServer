"use strict";

// BullMQ driver: picks the queue's own Redis when one is configured, the system Redis otherwise,
// and always keeps its keys under its own prefix. Redis and BullMQ are faked.

const mockRedisCalls = [];
const mockQueueOpts = [];

jest.mock("ioredis", () => class FakeRedis {
	constructor(...args) { mockRedisCalls.push(args); this.status = "ready"; }
	on() {}
	once(ev, fn) { if (ev === "ready") fn(); }
	async quit() {}
});
jest.mock("bullmq", () => ({
	Queue: class { constructor(name, opts) { mockQueueOpts.push({ name, opts }); } async add(name, data, opts) { this.added = { name, data, opts }; } async close() {} },
	Worker: class { constructor() {} on() {} async close() {} }
}));

const BullMQDriver = require("../../api/helpers/queue/drivers/BullMQDriver");
const QueueManager = require("../../api/helpers/queue/QueueManager");

beforeEach(() => { mockRedisCalls.length = 0; mockQueueOpts.length = 0; jest.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

test("the queue manager builds a BullMQ driver for 'bullmq' and 'bull'", () => {
	expect(new QueueManager({ driver: "bullmq" }).driver).toBeInstanceOf(BullMQDriver);
	expect(new QueueManager({ driver: "BULL" }).driver).toBeInstanceOf(BullMQDriver);
});

test("without queue.redis it uses the system Redis, with BullMQ's own connection settings", async () => {
	const d = new BullMQDriver({ systemRedis: { host: "sys", port: 6379, db: 0, enableOfflineQueue: false, keyPrefix: "x:" } });
	await d.connect();
	const [opts] = mockRedisCalls[0];
	expect(opts).toMatchObject({ host: "sys", port: 6379, db: 0, maxRetriesPerRequest: null, enableOfflineQueue: true });
	expect(opts).not.toHaveProperty("keyPrefix");
});

test("queue.redis (options) wins over the system Redis", async () => {
	const d = new BullMQDriver({ redis: { host: "queue-redis", db: 3 }, systemRedis: { host: "sys" } });
	await d.connect();
	expect(mockRedisCalls[0][0]).toMatchObject({ host: "queue-redis", db: 3 });
});

test("queue.redis can be a URL, and queue.host may carry one", async () => {
	await new BullMQDriver({ redis: "redis://q:6380/2" }).connect();
	expect(mockRedisCalls[0][0]).toBe("redis://q:6380/2");

	await new BullMQDriver({ servers: "redis://h:6381", systemRedis: { host: "sys" } }).connect();
	expect(mockRedisCalls[1][0]).toBe("redis://h:6381");
});

test("every queue uses a prefix of its own, lgksq by default", async () => {
	const d = new BullMQDriver({ systemRedis: {} });
	await d.connect();
	await d.publish("a.b", { x: 1 });
	expect(mockQueueOpts[0].opts.prefix).toBe("lgksq");

	const custom = new BullMQDriver({ systemRedis: {}, prefix: "mine" });
	await custom.connect();
	await custom.publish("a.b", { x: 1 });
	expect(mockQueueOpts[1].opts.prefix).toBe("mine");
});

test("publish reports the message id and that it was published", async () => {
	const d = new BullMQDriver({ systemRedis: {} });
	await d.connect();
	const out = await d.publish("q", { a: 1 }, { id: "m1" });
	expect(out).toEqual({ id: "m1", published: true });
});
