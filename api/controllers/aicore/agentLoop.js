//The actual agentic core: a real multi-turn tool-use loop. No provider
//autonomously executes our MCP tools - this drives the same caller-holds-
//the-loop protocol every engine adapter speaks natively (see engines/*.js):
//send conversation + tool schemas, get back a final answer or a tool-call
//request, execute the tool via tooling.js (the MCP registry), feed the
//result back, repeat until the model stops asking for tools or the agent's
//max_steps is hit.

const RESILIENCE = require("./resilience.js");
const TOOLING = require("./tooling.js");
const PERSONAS = require("./personas.js");
const AGENTS = require("./agents.js");
const CONVERSATIONS = require("./conversations.js");
const RAG = require("./rag.js");

//engines: [{key, priority, instance}] from ./index.js's createEngines()
//resilienceConfig: {retry, breaker} from CONFIG.aicore
async function runTurn(engines, resilienceConfig, sessId, agentCode, userMessage, ctx) {
    const guid = ctx?.meta?.user?.guid;

    const agent = await AGENTS.get(guid, agentCode);
    if (!agent) throw new Error(`AICore: unknown agent '${agentCode}'`);

    const persona = await PERSONAS.get(guid, agent.persona_code);
    if (!persona) throw new Error(`AICore: unknown persona '${agent.persona_code}' for agent '${agentCode}'`);

    return await executeLoop(engines, resilienceConfig, sessId, persona, agent, userMessage, ctx, { persist: true, agentCode });
}

//The loop itself, factored out of runTurn so built-in AICore utilities
//(queryNL today) can drive it with a transient, in-memory persona/agent -
//e.g. a fixed system prompt + a fixed tool allow-list - without needing a
//DB-backed persona/agent row for a capability that isn't user-defined data.
//
//persona: { system_prompt, model, allowed_tools, params }
//agent: { max_steps, timeout_ms }
//opts: { persist = true, agentCode } - persist=false skips conversation
//  history/logging entirely (used for one-off utility calls).
async function executeLoop(engines, resilienceConfig, sessId, persona, agent, userMessage, ctx, opts = {}) {
    const persist = opts.persist !== false;
    const guid = ctx?.meta?.user?.guid;

    const history = persist ? await CONVERSATIONS.getHistory(sessId) : [];
    const engineParams = _.extend({ model: persona.model, timeout_ms: agent.timeout_ms }, persona.params || {});

    //Knowledge: "forced" mode retrieves once up front and goes straight
    //into context; "on_demand" (and "both") add knowledge_search to the
    //tool list so the model can choose to call it, same as any MCP tool.
    const tools = TOOLING.list(ctx, persona.allowed_tools);
    if (RAG.usesOnDemand(persona)) {
        tools.push(RAG.knowledgeSearchTool(guid, persona).definition);
    }

    const turnMessages = [];
    if (RAG.usesForced(persona)) {
        const knowledgeContext = await RAG.retrieveForced(guid, userMessage, persona);
        if (knowledgeContext) turnMessages.push(knowledgeContext);
    }
    turnMessages.push({ role: "user", content: userMessage });

    const maxSteps = agent.max_steps || 6;

    let result = null;
    let steps = 0;

    for (steps = 1; steps <= maxSteps; steps++) {
        const messages = [{ role: "system", content: persona.system_prompt }]
            .concat(history)
            .concat(turnMessages);

        result = await RESILIENCE.callEngine(engines, sessId, messages, tools, ctx?.meta?.user || {}, engineParams, resilienceConfig);

        turnMessages.push({ role: "assistant", content: result.message, toolCalls: result.toolCalls });

        if (!result.toolCalls || result.toolCalls.length === 0) break;

        for (const call of result.toolCalls) {
            let toolResult;
            try {
                //knowledge_search isn't an MCP tool (it's AICore's own
                //knowledge source, not an AppServer broker action), so it's
                //dispatched directly through rag.js instead of TOOLING.run.
                toolResult = call.name === RAG.KNOWLEDGE_TOOL_NAME
                    ? await RAG.knowledgeSearchTool(guid, persona).handler(call.arguments)
                    : await TOOLING.run(call.name, call.arguments, ctx);
            } catch (err) {
                toolResult = { error: err.message || String(err) };
            }
            turnMessages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify(toolResult) });
        }
    }

    const maxStepsReached = steps > maxSteps;

    if (persist) {
        await CONVERSATIONS.appendTurn(sessId, guid, opts.agentCode || null, turnMessages, ctx);
    }

    return {
        sessId,
        status: maxStepsReached ? "max_steps_reached" : "success",
        message: result?.message || "",
        response: result,
        steps: Math.min(steps, maxSteps),
        turnMessages
    };
}

module.exports = { runTurn, executeLoop };
