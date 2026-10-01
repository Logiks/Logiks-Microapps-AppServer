//Agent registry for AICore - when/how a persona actually runs: which
//persona it uses, how it's triggered, how it executes (inline / queue /
//local_worker), and the tool-calling loop's step/time limits. DB-backed
//(sys_ai_agents, appdb), same pattern as personas.js.

const CACHE_PREFIX = "aicore:agent:";
const CACHE_TTL = 300; //5 minutes

module.exports = {

    list: async function(guid) {
        const result = await _DB.db_selectQ("appdb", "sys_ai_agents", "*", { guid, blocked: "false" }, {});
        return result?.results || [];
    },

    get: async function(guid, agentCode) {
        const cacheKey = CACHE_PREFIX + guid + ":" + agentCode;
        const cached = await _CACHE.fetchDataSync(cacheKey, null);
        if (cached) return cached;

        const result = await _DB.db_selectQ("appdb", "sys_ai_agents", "*", { guid, agent_code: agentCode, blocked: "false" }, {});
        const agent = result?.results?.[0] || null;

        if (agent) await _CACHE.storeDataEx(cacheKey, agent, CACHE_TTL);
        return agent;
    },

    upsert: async function(guid, agentCode, data, ctx) {
        const existing = await this.get(guid, agentCode);

        const record = {
            guid,
            agent_code: agentCode,
            title: data.title || agentCode,
            persona_code: data.personaCode,
            execution_mode: data.executionMode || "inline",
            max_steps: data.maxSteps != null ? data.maxSteps : 6,
            timeout_ms: data.timeoutMs != null ? data.timeoutMs : 30000,
            trigger: data.trigger || "manual",
            blocked: "false"
        };

        if (existing) {
            await _DB.db_updateQ("appdb", "sys_ai_agents", _.extend(record, MISC.generateDefaultDBRecord(ctx, true)), { guid, agent_code: agentCode });
        } else {
            await _DB.db_insertQ1("appdb", "sys_ai_agents", _.extend(record, MISC.generateDefaultDBRecord(ctx, false)));
        }

        await _CACHE.deleteKey(CACHE_PREFIX + guid + ":" + agentCode);
        return this.get(guid, agentCode);
    },

    remove: async function(guid, agentCode, ctx) {
        await _DB.db_updateQ("appdb", "sys_ai_agents", _.extend({ blocked: "true" }, MISC.generateDefaultDBRecord(ctx, true)), { guid, agent_code: agentCode });
        await _CACHE.deleteKey(CACHE_PREFIX + guid + ":" + agentCode);
    }
}
