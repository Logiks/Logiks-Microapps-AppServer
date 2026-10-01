//Task registry for AICore - a durable work item an agent executes under
//the identity of the user who owns it. DB-backed (sys_ai_tasks, appdb),
//same pattern as agents.js/personas.js, but mutable (status moves
//pending -> queued -> completed/failed/cancelled as the run progresses -
//see aicore.js's startQueueConsumer, which calls back into updateStatus()
//once the queued agent run finishes).
//
//Every task is dispatched through AICORE.queueAgentRun() using the owner's
//own ctx.meta.user - no task runs without a user's identity behind it, and
//whatever permissions that user has are exactly what the agent gets, same
//as any other agent run. `assigned_by` records who created the task
//(usually the owner themselves, via chat) separately from `owner_guid` (who
//it runs as), so an assignment made on someone else's behalf stays
//traceable even though both are set to the same value today.
//
//The task's background run gets its OWN sessId (left to queueAgentRun to
//generate) rather than reusing the chat session that spawned it - source_sess_id
//just links back to that originating conversation for traceability. Reusing
//the chat's sessId would interleave an async background run into a live
//conversation's history, which is confusing and not what's wanted here.

const AGENTS = require("./agents.js");

const CREATE_TASK_TOOL_NAME = "create_task";

module.exports = {

    CREATE_TASK_TOOL_NAME,

    list: async function(guid, filters = {}) {
        const where = { guid };
        if (filters.status) where.status = filters.status;
        if (filters.ownerGuid) where.owner_guid = filters.ownerGuid;

        const result = await _DB.db_selectQ("appdb", "sys_ai_tasks", "*", where, {});
        return result?.results || [];
    },

    get: async function(guid, taskId) {
        const result = await _DB.db_selectQ("appdb", "sys_ai_tasks", "*", { guid, task_id: taskId }, {});
        return result?.results?.[0] || null;
    },

    //data: { title, message, agentCode, ownerGuid?, assignedBy?, triggerSource?, sourceRef?, sourceSessId? }
    //ownerGuid defaults to the calling user (ctx.meta.user.guid) - the common
    //case of a user creating a task for themselves. Validates agentCode
    //against the agent registry up front so a bad code fails immediately
    //instead of after a queue round-trip.
    create: async function(guid, data, ctx) {
        const taskId = UNIQUEID.generate(12);
        const ownerGuid = data.ownerGuid || ctx?.meta?.user?.guid;
        const assignedBy = ctx?.meta?.user?.guid || ownerGuid;

        const record = {
            guid,
            task_id: taskId,
            title: data.title || "Untitled task",
            message: data.message || "",
            agent_code: data.agentCode,
            owner_guid: ownerGuid,
            assigned_by: assignedBy,
            trigger_source: data.triggerSource || "manual",
            source_ref: data.sourceRef || null,
            source_sess_id: data.sourceSessId || null,
            status: "pending",
            result: null,
            error: null,
            blocked: "false"
        };

        await _DB.db_insertQ1("appdb", "sys_ai_tasks", _.extend(record, MISC.generateDefaultDBRecord(ctx, false)));

        if (!ownerGuid) {
            await this.updateStatus(guid, taskId, "failed", null, "No owner could be resolved for this task", ctx);
            return this.get(guid, taskId);
        }

        const agent = await AGENTS.get(guid, record.agent_code);
        if (!agent) {
            await this.updateStatus(guid, taskId, "failed", null, `Unknown agent '${record.agent_code}'`, ctx);
            return this.get(guid, taskId);
        }

        try {
            const taskCtx = { meta: { user: { guid: ownerGuid } } };
            //queueAgentRun generates its own sessId (null here) - see header note.
            await AICORE.queueAgentRun(record.agent_code, record.message, null, taskCtx, taskId);
            await this.updateStatus(guid, taskId, "queued", null, null, ctx);
        } catch (err) {
            await this.updateStatus(guid, taskId, "failed", null, err.message || String(err), ctx);
        }

        return this.get(guid, taskId);
    },

    updateStatus: async function(guid, taskId, status, result, error, ctx) {
        const record = { status };
        if (result !== undefined && result !== null) record.result = typeof result === "string" ? result : JSON.stringify(result);
        if (error !== undefined && error !== null) record.error = typeof error === "string" ? error : JSON.stringify(error);

        await _DB.db_updateQ("appdb", "sys_ai_tasks", _.extend(record, MISC.generateDefaultDBRecord(ctx, true)), { guid, task_id: taskId });
        return this.get(guid, taskId);
    },

    complete: async function(guid, taskId, result, ctx) {
        return this.updateStatus(guid, taskId, "completed", result, null, ctx);
    },

    fail: async function(guid, taskId, error, ctx) {
        return this.updateStatus(guid, taskId, "failed", null, error, ctx);
    },

    cancel: async function(guid, taskId, ctx) {
        return this.updateStatus(guid, taskId, "cancelled", null, null, ctx);
    },

    //Tool definition + handler for create_task - added to the tool list
    //agentLoop builds for any persisted (real chat) turn, gated by the same
    //persona.allowed_tools convention TOOLING.list() already applies to MCP
    //tools (empty/missing allowed_tools = unrestricted). Not an MCP tool -
    //dispatched directly by agentLoop.js, the same way rag.js's
    //knowledge_search is.
    createTaskTool: function(guid, currentAgentCode, sessId, ctx) {
        const self = this;
        return {
            definition: {
                name: CREATE_TASK_TOOL_NAME,
                description:
                    "Create a background task for an AI agent to work on asynchronously, for requests that need " +
                    "work deferred rather than answered in this turn - a follow-up, a longer-running job, or " +
                    "something to hand off for later. The task runs under the current user's own identity and " +
                    "permissions. Only use this when deferred execution is actually appropriate - if you can just " +
                    "answer or act directly in this turn, do that instead.",
                inputSchema: {
                    type: "object",
                    properties: {
                        title: { type: "string", description: "Short title for the task" },
                        instructions: { type: "string", description: "What the agent should do, detailed enough to act on without this conversation's context" },
                        agentCode: { type: "string", description: "Which registered agent should run this task. Defaults to the current agent." }
                    },
                    required: ["title", "instructions"]
                }
            },
            handler: async function(args) {
                const task = await self.create(guid, {
                    title: args.title,
                    message: args.instructions,
                    agentCode: args.agentCode || currentAgentCode,
                    triggerSource: "chat",
                    sourceSessId: sessId
                }, ctx);

                return { taskId: task.task_id, status: task.status, error: task.error || undefined };
            }
        };
    },

    //Whether create_task should be offered given a persona's allowed_tools -
    //same semantics TOOLING.list() uses for MCP tools (empty/missing list =
    //unrestricted; otherwise the tool name must be explicitly present).
    isAllowedFor: function(persona) {
        const allowedTools = persona.allowed_tools;
        return !Array.isArray(allowedTools) || allowedTools.length === 0 || allowedTools.indexOf(CREATE_TASK_TOOL_NAME) >= 0;
    }
}
