"use strict";
//REST surface for AICore's task layer (sys_ai_tasks) - background work
//items an agent executes under the identity of the user who owns them.
//Tasks are usually created implicitly via the create_task tool during a
//chat turn (see api/controllers/aicore/tasks.js); this exposes the same
//registry directly so the UI can list, create and cancel them outside chat.

module.exports = {
	name: "tasks",

	actions: {

        listTasks: {
            rest: { method: "GET", fullPath: "/ai/tasks" },
            async handler(ctx) {
                return await AICORE.tasks.list(ctx.meta.user.guid, ctx.params);
            }
        },

        getTask: {
            rest: { method: "GET", fullPath: "/ai/tasks/:taskId" },
            async handler(ctx) {
                return await AICORE.tasks.get(ctx.meta.user.guid, ctx.params.taskId);
            }
        },

        createTask: {
            rest: { method: "POST", fullPath: "/ai/tasks" },
            async handler(ctx) {
                return await AICORE.tasks.create(ctx.meta.user.guid, ctx.params, ctx);
            }
        },

        cancelTask: {
            rest: { method: "POST", fullPath: "/ai/tasks/:taskId/cancel" },
            async handler(ctx) {
                return await AICORE.tasks.cancel(ctx.meta.user.guid, ctx.params.taskId, ctx);
            }
        }
    }
}
