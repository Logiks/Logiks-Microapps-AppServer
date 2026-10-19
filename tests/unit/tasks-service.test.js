"use strict";

// POST /ai/tasks: the owning tenant always comes from the caller, never from the request body.

const tasksService = require("../../api/services/ai/tasks.service");
const { LogiksError } = require("./helpers/fakes");

beforeAll(() => { global.LogiksError = LogiksError; });

describe("tasks service", () => {
	test("an ownerGuid in the request body is ignored", async () => {
		const calls = [];
		global.AICORE = { tasks: { create: async (guid, data, ctx) => { calls.push({ guid, data }); return { task_id: "t1" }; } } };

		const ctx = { meta: { user: { guid: "tenant-a" } }, params: { title: "x", message: "y", agentCode: "a", ownerGuid: "tenant-b" } };
		await tasksService.actions.createTask.handler.call({}, ctx);

		expect(calls).toHaveLength(1);
		expect(calls[0].guid).toBe("tenant-a");
		expect(calls[0].data).not.toHaveProperty("ownerGuid");
		expect(calls[0].data).toMatchObject({ title: "x", message: "y", agentCode: "a" });
	});

	test("every action reads and writes under the caller's own tenant", async () => {
		const seen = [];
		global.AICORE = { tasks: {
			list: async (g) => seen.push(g), get: async (g) => seen.push(g), cancel: async (g) => seen.push(g)
		} };
		const ctx = { meta: { user: { guid: "tenant-a" } }, params: { taskId: "t1", ownerGuid: "tenant-b", guid: "tenant-b" } };

		await tasksService.actions.listTasks.handler.call({}, ctx);
		await tasksService.actions.getTask.handler.call({}, ctx);
		await tasksService.actions.cancelTask.handler.call({}, ctx);

		//cancel looks the task up first (404 if unknown), then cancels: both under the caller's tenant
		expect(seen).toEqual(["tenant-a", "tenant-a", "tenant-a", "tenant-a"]);
	});

	test("an unknown task is a 404, for both lookup and cancel", async () => {
		const cancelled = [];
		global.AICORE = { tasks: { get: async () => null, cancel: async (...a) => cancelled.push(a) } };
		const ctx = { meta: { user: { guid: "tenant-a" } }, params: { taskId: "nope" } };

		await expect(tasksService.actions.getTask.handler.call({}, ctx)).rejects.toMatchObject({ code: 404 });
		await expect(tasksService.actions.cancelTask.handler.call({}, ctx)).rejects.toMatchObject({ code: 404 });
		expect(cancelled).toHaveLength(0);
	});
});
