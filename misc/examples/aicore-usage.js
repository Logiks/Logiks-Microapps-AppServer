/*
 * Sample usage of AICore (api/controllers/aicore.js).
 *
 * This file is reference code, not wired into the app - misc/ isn't on the
 * autoload path (api/helpers, api/controllers, api/services), so nothing
 * here runs automatically. Two ways to use AICore are shown:
 *
 *   A) Programmatically, from inside a running service/controller, where
 *      AICORE and ctx already exist - this is how you'd actually call it
 *      day to day. Copy these snippets into a real service file.
 *
 *   B) Over REST, via the routes api/services/agents.service.js exposes -
 *      this is the front door for anything outside the AppServer process.
 *
 * Both paths go through the exact same agent loop
 * (api/controllers/aicore/agentLoop.js), so behavior is identical.
 */


// ---------------------------------------------------------------------------
// 0) One-time setup: define a persona and an agent.
//    Personas/agents are data (sys_ai_personas / sys_ai_agents), not code -
//    create them once (via REST below, or AICORE.personas/agents directly)
//    before anything can be run.
// ---------------------------------------------------------------------------

// Using the controllers directly (e.g. from a setup script or an admin
// service action, where `ctx` is a real Moleculer context):
async function setupSupportAgent(ctx) {
    const guid = ctx.meta.user.guid;

    await AICORE.personas.upsert(guid, "support-agent", {
        title: "Support Agent",
        systemPrompt:
            "You are a support assistant for this AppServer. " +
            "Use the available tools to look up real data before answering - " +
            "never guess at query results.",
        engineKey: "claude",            // must match a `key` in CONFIG.aicore.engines
        model: "claude-sonnet-5",
        allowedTools: ["query_schema", "query_index", "query_results"], // subset of REGISTRY.listTools()
        params: { temperature: 0.2 }
    }, ctx);

    await AICORE.agents.upsert(guid, "support-bot", {
        title: "Support Bot",
        personaCode: "support-agent",
        executionMode: "inline",        // "inline" | "queue" | "local_worker"
        maxSteps: 6,                    // tool-calling steps before giving up
        timeoutMs: 30000,
        trigger: "manual"
    }, ctx);
}


// ---------------------------------------------------------------------------
// 1) Run it synchronously (same process, waits for the final answer).
// ---------------------------------------------------------------------------

async function askSupportBot(ctx, question) {
    // sessId omitted -> AICore starts a new conversation and returns the id;
    // pass the same sessId back in to continue that conversation.
    const result = await AICORE.runAgent("support-bot", question, null, ctx);

    console.log(result.status);   // "success" | "max_steps_reached" | "error"
    console.log(result.message);  // the final assistant text
    console.log(result.steps);    // how many tool-calling turns it took
    console.log(result.sessId);   // reuse this for the next turn in the same chat

    return result;
}


// ---------------------------------------------------------------------------
// 2) Run it asynchronously (distributed via the existing NATS queue) -
//    use this for long jobs or batch/webhook-triggered runs. The result
//    isn't returned here; a consumer on some node (any node running
//    AICORE.startQueueConsumer(), wired in api/baseapp.js) picks it up.
// ---------------------------------------------------------------------------

async function queueSupportBotRun(ctx, question) {
    const queued = await AICORE.queueAgentRun("support-bot", question, null, ctx);
    console.log(queued); // { sessId, status: "queued" }
    return queued;
}


// ---------------------------------------------------------------------------
// 3) Generic entry point (no explicit agent) - sendMessage uses
//    intentDetector.js + CONFIG.aicore.intentAgentMap to pick an agent, or
//    falls back to CONFIG.aicore.defaultAgent.
// ---------------------------------------------------------------------------

async function askWithoutAnAgent(ctx, message) {
    return await AICORE.sendMessage(message, null, null, {}, ctx);
}


// ---------------------------------------------------------------------------
// 4) Fetch durable conversation history for a session.
// ---------------------------------------------------------------------------

async function getHistory(ctx, sessId) {
    return await AICORE.sessionHistory(ctx.meta.user.guid, sessId);
}


module.exports = { setupSupportAgent, askSupportBot, queueSupportBotRun, askWithoutAnAgent, getHistory };


/*
 * ---------------------------------------------------------------------------
 * B) Same flow over REST, via api/services/agents.service.js.
 * ---------------------------------------------------------------------------
 *
 * # 0) Create the persona
 * curl -X POST http://localhost:PORT/ai/personas/support-agent \
 *   -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
 *   -d '{
 *     "title": "Support Agent",
 *     "systemPrompt": "You are a support assistant...",
 *     "engineKey": "claude",
 *     "model": "claude-sonnet-5",
 *     "allowedTools": ["query_schema", "query_index", "query_results"],
 *     "params": { "temperature": 0.2 }
 *   }'
 *
 * # Create the agent
 * curl -X POST http://localhost:PORT/ai/agents/support-bot \
 *   -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
 *   -d '{
 *     "title": "Support Bot",
 *     "personaCode": "support-agent",
 *     "executionMode": "inline",
 *     "maxSteps": 6,
 *     "timeoutMs": 30000,
 *     "trigger": "manual"
 *   }'
 *
 * # 1) Run it synchronously
 * curl -X POST http://localhost:PORT/ai/agents/support-bot/run \
 *   -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
 *   -d '{ "message": "How many orders were placed last week?" }'
 *
 * # 2) Run it asynchronously via the queue
 * curl -X POST "http://localhost:PORT/ai/agents/support-bot/run?async=true" \
 *   -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
 *   -d '{ "message": "Generate the end-of-month report" }'
 *   -> { "sessId": "...", "status": "queued" }
 *
 * # 3) Continue the same conversation
 * curl -X POST http://localhost:PORT/ai/agents/support-bot/run \
 *   -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
 *   -d '{ "sessId": "<sessId from step 1>", "message": "Break that down by region" }'
 *
 * # 4) Read conversation history
 * curl http://localhost:PORT/ai/sessions/<sessId> -H "Authorization: Bearer <token>"
 * ---------------------------------------------------------------------------
 */
