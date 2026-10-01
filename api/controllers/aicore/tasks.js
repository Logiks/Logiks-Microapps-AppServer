//Task registry for AICore - a durable work item an agent executes under
//the identity of the user who owns it. DB-backed (sys_ai_tasks, appdb),
//same pattern as agents.js/personas.js, but mutable (status moves
//pending -> queued -> completed/failed/cancelled, or -> scheduled and back
//to queued on every firing for a recurring task - see aicore.js's
//startQueueConsumer, which calls back into complete()/fail() once a queued
//run finishes).
//
//Every run is dispatched through AICORE.queueAgentRun() using the owner's
//own ctx.meta.user - no task runs without a user's identity behind it, and
//whatever permissions that user has are exactly what the agent gets, same
//as any other agent run. `assigned_by` records who created the task
//(usually the owner themselves, via chat) separately from `owner_guid` (who
//it runs as), so an assignment made on someone else's behalf stays
//traceable even though both are set to the same value today.
//
//Recurrence piggybacks on the platform's existing cron infrastructure
//(sys_ai_tasks.repeat_schedule -> a row in lgks_autojobs, driven by
//AUTOJOBS/node-cron - see autojobs.js) instead of running a second,
//bespoke scheduler: a recurring task registers a "method" autojob whose
//job_script is "tasks.runScheduled", so every firing just re-dispatches
//the same task under the same owner. The task's row always reflects the
//MOST RECENT firing only (result/error get overwritten each run) - the
//full transcript of any individual run is still in log_ai_conversations/
//log_ai_messages under that run's own sessId if deeper history is needed.
//
//Each run - recurring or not - gets its OWN fresh sessId (left to
//queueAgentRun to generate) rather than reusing the chat session that
//spawned it; source_sess_id just links back to that originating
//conversation for traceability.

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

    //data: { title, message, agentCode, ownerGuid?, triggerSource?, sourceRef?,
    //        sourceSessId?, repeat?: { every, unit, until? } }
    //ownerGuid defaults to the calling user (ctx.meta.user.guid) - the common
    //case of a user creating a task for themselves. Validates agentCode
    //against the agent registry, and repeat.unit/every against
    //buildCronExpression(), up front so a bad value fails immediately
    //instead of after a queue round-trip.
    create: async function(guid, data, ctx) {
        const taskId = UNIQUEID.generate(12);
        const ownerGuid = data.ownerGuid || ctx?.meta?.user?.guid;
        const assignedBy = ctx?.meta?.user?.guid || ownerGuid;

        const repeat = data.repeat && data.repeat.every && data.repeat.unit ? data.repeat : null;
        const repeatSchedule = repeat ? buildCronExpression(repeat.every, repeat.unit) : null;

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
            repeat_schedule: repeatSchedule,
            repeat_until: repeat?.until || null,
            autojob_id: null,
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

        if (repeat && !repeatSchedule) {
            await this.updateStatus(guid, taskId, "failed", null, `Unsupported repeat interval: ${repeat.every} ${repeat.unit}`, ctx);
            return this.get(guid, taskId);
        }

        const agent = await AGENTS.get(guid, record.agent_code);
        if (!agent) {
            await this.updateStatus(guid, taskId, "failed", null, `Unknown agent '${record.agent_code}'`, ctx);
            return this.get(guid, taskId);
        }

        if (repeatSchedule) {
            const autojobId = await registerRecurringJob(guid, ownerGuid, taskId, repeatSchedule, ctx);
            await _DB.db_updateQ("appdb", "sys_ai_tasks", _.extend({ autojob_id: autojobId }, MISC.generateDefaultDBRecord(ctx, true)), { guid, task_id: taskId });
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

    //Called by lgks_autojobs (via tasks.service.js's runScheduled action,
    //see job_script "tasks.runScheduled" on the row registerRecurringJob
    //creates) on every cron firing of a recurring task. Re-dispatches the
    //same task under its owner's identity; a cancelled task or one past
    //its repeat_until just retires itself instead of running again.
    runScheduled: async function(guid, taskId) {
        const task = await this.get(guid, taskId);
        if (!task) return { status: "error", message: `Unknown task '${taskId}'` };
        if (task.status === "cancelled") return { status: "skipped", message: "Task is cancelled" };

        const taskCtx = { meta: { user: { guid: task.owner_guid } } };

        if (task.repeat_until && moment().isAfter(moment(task.repeat_until))) {
            await this.cancel(guid, taskId, taskCtx);
            return { status: "skipped", message: "Past repeat_until" };
        }

        await AICORE.queueAgentRun(task.agent_code, task.message, null, taskCtx, taskId);
        return await this.updateStatus(guid, taskId, "queued", null, null, taskCtx);
    },

    updateStatus: async function(guid, taskId, status, result, error, ctx) {
        const record = { status };
        if (result !== undefined && result !== null) record.result = typeof result === "string" ? result : JSON.stringify(result);
        if (error !== undefined && error !== null) record.error = typeof error === "string" ? error : JSON.stringify(error);

        await _DB.db_updateQ("appdb", "sys_ai_tasks", _.extend(record, MISC.generateDefaultDBRecord(ctx, true)), { guid, task_id: taskId });
        return this.get(guid, taskId);
    },

    //A recurring task that's still active goes to "scheduled" (waiting for
    //its next firing) instead of the terminal "completed"/"failed" a
    //one-off task gets - it isn't actually done.
    complete: async function(guid, taskId, result, ctx) {
        const task = await this.get(guid, taskId);
        const status = isRecurringActive(task) ? "scheduled" : "completed";
        return this.updateStatus(guid, taskId, status, result, null, ctx);
    },

    fail: async function(guid, taskId, error, ctx) {
        const task = await this.get(guid, taskId);
        const status = isRecurringActive(task) ? "scheduled" : "failed";
        return this.updateStatus(guid, taskId, status, null, error, ctx);
    },

    //Also retires (and best-effort deactivates) the task's autojob row, if
    //any, so a cancelled recurring task actually stops firing rather than
    //just showing "cancelled" while the cron job keeps running underneath.
    cancel: async function(guid, taskId, ctx) {
        const task = await this.get(guid, taskId);

        if (task && task.autojob_id) {
            await _DB.db_updateQ("appdb", "lgks_autojobs", _.extend({ retired: "true" }, MISC.generateDefaultDBRecord(ctx, true)), { id: task.autojob_id });

            if (typeof AUTOJOBS !== "undefined" && typeof AUTOJOBS.deactivateJob === "function") {
                await AUTOJOBS.deactivateJob(`aicore_task_${taskId}_${task.autojob_id}`);
            }
        }

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
                    "something to hand off for later. Set `repeat` to make it recur (e.g. 'every 2 days'). The " +
                    "task runs under the current user's own identity and permissions. Only use this when deferred " +
                    "execution is actually appropriate - if you can just answer or act directly in this turn, do that instead.",
                inputSchema: {
                    type: "object",
                    properties: {
                        title: { type: "string", description: "Short title for the task" },
                        instructions: { type: "string", description: "What the agent should do, detailed enough to act on without this conversation's context" },
                        agentCode: { type: "string", description: "Which registered agent should run this task. Defaults to the current agent." },
                        repeat: {
                            type: "object",
                            description: "Omit for a one-off task. Set to make the task recur on an interval.",
                            properties: {
                                every: { type: "number", description: "How often to repeat, as a count of `unit` - e.g. 2" },
                                unit: { type: "string", enum: ["minutes", "hours", "days", "weeks"], description: "Unit for `every` - e.g. 'days'" },
                                until: { type: "string", description: "Optional ISO date (YYYY-MM-DD) after which the task stops repeating. Omit to repeat indefinitely until cancelled." }
                            },
                            required: ["every", "unit"]
                        }
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
                    sourceSessId: sessId,
                    repeat: args.repeat || null
                }, ctx);

                return { taskId: task.task_id, status: task.status, repeating: !!task.repeat_schedule, error: task.error || undefined };
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

function isRecurringActive(task) {
    if (!task || !task.repeat_schedule) return false;
    if (task.repeat_until && moment().isAfter(moment(task.repeat_until))) return false;
    return true;
}

//Converts a plain-language interval (what the create_task tool takes, and
//what an LLM reliably produces - "every 2 days") into a standard 5-field
//cron expression (what lgks_autojobs.schedule/node-cron need). Deliberately
//NOT a rolling/relative interval: day-of-month "*/N" resets to day 1 each
//month, so e.g. "every 3 days" can land a shorter gap across a month
//boundary. That approximation is accepted here rather than building a
//second, precise interval scheduler alongside the platform's existing
//cron-based one.
function buildCronExpression(every, unit) {
    const n = parseInt(every);
    if (!Number.isInteger(n) || n <= 0) return null;

    switch (unit) {
        case "minutes":
            return n <= 59 ? `*/${n} * * * *` : null;
        case "hours":
            return n <= 23 ? `0 */${n} * * *` : null;
        case "days":
            return n <= 27 ? `0 0 */${n} * *` : null;
        case "weeks":
            return buildCronExpression(n * 7, "days");
        default:
            return null;
    }
}

//Registers the lgks_autojobs row that drives a recurring task's future
//firings (see autojobs.js) - job_type "method" calling back into
//tasks.service.js's runScheduled action with {guid, taskId}. Also asks
//AUTOJOBS to pick it up immediately via registerNewJob(), which is a safe
//no-op on any node that isn't the current AUTOJOBS cron leader (same
//pattern as its existing activateJob/deactivateJob) - on a node that IS
//the leader, this avoids making the job wait for the next restart/election
//before it starts firing.
async function registerRecurringJob(guid, ownerGuid, taskId, cronExpr, ctx) {
    const jobName = `aicore_task_${taskId}`;
    const params = JSON.stringify({ guid, taskId });

    const insertResult = await _DB.db_insertQ1("appdb", "lgks_autojobs", _.extend({
        guid: ownerGuid,
        name: jobName,
        plugin: "aicore",
        job_type: "method",
        method: "LOCAL",
        job_script: "tasks.runScheduled",
        params,
        schedule: cronExpr,
        run_only_once: "false",
        description: `Recurring AICore task ${taskId}`,
        retired: "false",
        blocked: "false"
    }, MISC.generateDefaultDBRecord(ctx, false)));

    const autojobId = insertResult?.insertId || null;

    if (autojobId && typeof AUTOJOBS !== "undefined" && typeof AUTOJOBS.registerNewJob === "function") {
        await AUTOJOBS.registerNewJob({
            id: autojobId,
            guid: ownerGuid,
            name: jobName,
            job_type: "method",
            job_script: "tasks.runScheduled",
            params,
            schedule: cronExpr,
            run_only_once: "false"
        });
    }

    return autojobId;
}
