//RAG unit for AICore - turns a persona's `allowed_knowledge` scope into
//retrieved context, in whichever delivery mode that persona is configured
//for (persona.params.knowledgeMode, set via personas.js's upsert):
//
//  - "off"       (default when allowed_knowledge is empty) - no knowledge at all.
//  - "forced"    - retrieved once per turn and injected into context before
//                  the model is ever called - the model doesn't choose.
//  - "on_demand" - exposed as the `knowledge_search` tool instead, the same
//                  way MCP tools are offered - the model decides whether
//                  and what to search, same tool-calling mechanism agentLoop
//                  already drives for every other tool.
//  - "both"      - forces an initial retrieval AND still offers the tool,
//                  for follow-up/deeper queries within the same turn.
//
//Backed by KNOWLEDGE.search() (api/controllers/knowledge.js) - still a
//stub returning [] today. This module is the stable call site for once
//it's implemented; nothing here needs to change when it is.

const KNOWLEDGE_TOOL_NAME = "knowledge_search";
const DEFAULT_TOP_N = 5;

function mode(persona) {
    const scopes = persona.allowed_knowledge;
    if (!Array.isArray(scopes) || scopes.length === 0) return "off";
    return (persona.params && persona.params.knowledgeMode) || "on_demand";
}

function usesForced(persona) {
    const m = mode(persona);
    return m === "forced" || m === "both";
}

function usesOnDemand(persona) {
    const m = mode(persona);
    return m === "on_demand" || m === "both";
}

//Called once per turn, before the first engine call - not per loop step,
//so a forced retrieval doesn't re-run on every tool round-trip within the
//same turn. Returns a system-role context message, or null if nothing came back.
async function retrieveForced(guid, query, persona) {
    const hits = await search(guid, query, persona);
    if (!hits || hits.length === 0) return null;

    return {
        role: "system",
        content: "Relevant knowledge (retrieved automatically for this question):\n" + formatHits(hits)
    };
}

//Tool definition + handler for on-demand mode - added to the tool list
//agentLoop builds alongside MCP tools, and dispatched specially (it isn't
//registered in the MCP registry - this is AICore's own knowledge source,
//not an AppServer broker action).
function knowledgeSearchTool(guid, persona) {
    return {
        definition: {
            name: KNOWLEDGE_TOOL_NAME,
            description: "Search the knowledge base for information relevant to a query. Use this when the conversation needs facts/context you don't already have.",
            inputSchema: {
                type: "object",
                properties: { query: { type: "string", description: "What to search for" } },
                required: ["query"]
            }
        },
        handler: async function(args) {
            const hits = await search(guid, args.query, persona);
            return { results: hits || [] };
        }
    };
}

async function search(guid, query, persona) {
    return await KNOWLEDGE.search(guid, query, false, { scopes: persona.allowed_knowledge }, {}, DEFAULT_TOP_N);
}

function formatHits(hits) {
    return hits.map((h, i) => `[${i + 1}] ${typeof h === "string" ? h : JSON.stringify(h)}`).join("\n");
}

module.exports = { KNOWLEDGE_TOOL_NAME, mode, usesForced, usesOnDemand, retrieveForced, knowledgeSearchTool };
