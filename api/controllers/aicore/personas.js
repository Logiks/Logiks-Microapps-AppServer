//Persona registry for AICore - what the AI is and what it's allowed to
//touch: system prompt, which engine/model to use, which MCP tools and
//knowledge scopes are in play. DB-backed (sys_ai_personas, appdb) the same
//way api/controllers/providers.js manages sys_providers, with reads cached
//in _CACHE and invalidated on upsert.

const CACHE_PREFIX = "aicore:persona:";
const CACHE_TTL = 300; //5 minutes

module.exports = {

    list: async function(guid) {
        const result = await _DB.db_selectQ("appdb", "sys_ai_personas", "*", { guid, blocked: "false" }, {});
        return (result?.results || []).map(parseRecord);
    },

    get: async function(guid, personaCode) {
        const cacheKey = CACHE_PREFIX + guid + ":" + personaCode;
        const cached = await _CACHE.fetchDataSync(cacheKey, null);
        if (cached) return cached;

        const result = await _DB.db_selectQ("appdb", "sys_ai_personas", "*", { guid, persona_code: personaCode, blocked: "false" }, {});
        const persona = result?.results?.[0] ? parseRecord(result.results[0]) : null;

        if (persona) await _CACHE.storeDataEx(cacheKey, persona, CACHE_TTL);
        return persona;
    },

    upsert: async function(guid, personaCode, data, ctx) {
        const existing = await this.get(guid, personaCode);

        const record = {
            guid,
            persona_code: personaCode,
            title: data.title || personaCode,
            system_prompt: data.systemPrompt || "",
            engine_key: data.engineKey || "",
            model: data.model || "",
            allowed_tools: JSON.stringify(data.allowedTools || []),
            allowed_knowledge: JSON.stringify(data.allowedKnowledge || []),
            params: JSON.stringify(data.params || {}),
            blocked: "false"
        };

        if (existing) {
            await _DB.db_updateQ("appdb", "sys_ai_personas", _.extend(record, MISC.generateDefaultDBRecord(ctx, true)), { guid, persona_code: personaCode });
        } else {
            await _DB.db_insertQ1("appdb", "sys_ai_personas", _.extend(record, MISC.generateDefaultDBRecord(ctx, false)));
        }

        await _CACHE.deleteKey(CACHE_PREFIX + guid + ":" + personaCode);
        return this.get(guid, personaCode);
    },

    remove: async function(guid, personaCode, ctx) {
        await _DB.db_updateQ("appdb", "sys_ai_personas", _.extend({ blocked: "true" }, MISC.generateDefaultDBRecord(ctx, true)), { guid, persona_code: personaCode });
        await _CACHE.deleteKey(CACHE_PREFIX + guid + ":" + personaCode);
    }
}

function parseRecord(row) {
    return _.extend({}, row, {
        allowed_tools: safeParseArray(row.allowed_tools),
        allowed_knowledge: safeParseArray(row.allowed_knowledge),
        params: safeParseObject(row.params)
    });
}

function safeParseArray(str) {
    try {
        const parsed = JSON.parse(str);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function safeParseObject(str) {
    try {
        return JSON.parse(str) || {};
    } catch (e) {
        return {};
    }
}
