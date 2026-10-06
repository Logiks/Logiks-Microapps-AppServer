"use strict";

// SSE: an event stream id belongs to the user who opened it.

const { EventEmitter } = require("events");
const sse = require("../../api/services/sse.service");

const opened = [];

const connect = (eventId, userId) => {
	const req = new EventEmitter();
	const res = new EventEmitter();
	res.written = [];
	res.writeHead = jest.fn();
	res.write = (chunk) => { res.written.push(chunk); return true; };
	res.end = jest.fn();
	const ctx = { params: { eventId }, meta: { $req: req, $res: res, user: { userId } } };
	const done = sse.actions.recieveEvents.handler.call({}, ctx);
	opened.push(req);
	return { req, res, done };
};

const service = { sendEvent: sse.methods.sendEvent };

describe("SSE streams", () => {
	beforeEach(() => jest.spyOn(console, "log").mockImplementation(() => {}));
	afterEach(() => {
		// closing every stream clears its heartbeat timer, so a failing test cannot leave jest hanging
		opened.splice(0).forEach(req => req.emit("close"));
		jest.restoreAllMocks();
	});

	test("the owner receives pushed events", async () => {
		const a = connect("s1", "alice");
		expect(service.sendEvent("s1", "note", { n: 1 })).toBe(true);
		expect(a.res.written.join("")).toContain("event: note");
		a.req.emit("close");
		await a.done;
	});

	test("another user cannot take over an id that is in use", async () => {
		const alice = connect("s2", "alice");
		const mallory = connect("s2", "mallory");

		expect(mallory.done).toMatchObject({ status: "error" });
		expect(alice.res.end).not.toHaveBeenCalled();

		service.sendEvent("s2", "secret", { for: "alice" });
		expect(alice.res.written.join("")).toContain("secret");

		alice.req.emit("close");
		await alice.done;
	});

	test("the same user reconnecting replaces the old stream, and the old stream closing does not drop the new one", async () => {
		const first = connect("s3", "alice");
		const second = connect("s3", "alice");
		expect(first.res.end).toHaveBeenCalled();

		first.req.emit("close");
		await first.done;

		expect(service.sendEvent("s3", "still-here", {})).toBe(true);
		expect(second.res.written.join("")).toContain("still-here");

		second.req.emit("close");
		await second.done;
		expect(service.sendEvent("s3", "gone", {})).toBe(false);
	});

	test("newlines in an event name cannot inject extra SSE fields", async () => {
		const a = connect("s4", "alice");
		service.sendEvent("s4", "x\ndata: forged", { n: 1 });
		const out = a.res.written.join("");
		expect(out).toContain("event: x data: forged\n");
		expect(out.split("\n").filter(l => l.startsWith("data: forged"))).toHaveLength(0);
		a.req.emit("close");
		await a.done;
	});
});
