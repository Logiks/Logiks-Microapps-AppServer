//Session/conversation persistence for AICore.
//Two tiers, same pattern as log_queue/log_providers elsewhere in this repo:
// - hot buffer in _CACHE (aicore:session:<sessId>, sliding TTL) so the
//   agent loop can rebuild `messages[]` without a DB round trip on every step.
// - durable audit trail in logdb (log_ai_conversations/log_ai_messages),
//   written per turn, for history lookups and debugging after the fact.

const SESSION_PREFIX = "aicore:session:";
const SESSION_TTL = 1800; //30 minutes, sliding

// sessId comes from the client, so the hot buffer is keyed by tenant + user as well; knowing another
// user's sessId must not give access to their conversation.
function sessionKey(sessId, ctx) {
    return `${SESSION_PREFIX}${ctx?.meta?.user?.guid || "-"}:${ctx?.meta?.user?.userId || "-"}:${sessId}`;
}

module.exports = {

    getHistory: async function(sessId, ctx) {
        return await _CACHE.fetchDataSync(sessionKey(sessId, ctx), []);
    },

    //Persists a batch of turn messages (user/assistant/tool) both to the hot
    //buffer and to the durable log. Starts the conversation log row the
    //first time a session is seen.
    appendTurn: async function(sessId, guid, agentCode, newMessages, ctx) {
        const history = await this.getHistory(sessId, ctx);

        if (history.length === 0) {
            await _DB.db_insertQ1("logdb", "log_ai_conversations", _.extend({
                sessId,
                guid,
                agent_code: agentCode,
                status: "active"
            }, MISC.generateDefaultDBRecord(ctx, false)));
        }

        const updated = history.concat(newMessages);
        await _CACHE.storeDataEx(sessionKey(sessId, ctx), updated, SESSION_TTL);

        for (const m of newMessages) {
            await _DB.db_insertQ1("logdb", "log_ai_messages", _.extend({
                sessId,
                guid,
                role: m.role,
                content: typeof m.content === "string" ? m.content : JSON.stringify(m.content || ""),
                tool_calls: (m.toolCalls || m.toolCallId) ? JSON.stringify({ toolCalls: m.toolCalls, toolCallId: m.toolCallId }) : null
            }, MISC.generateDefaultDBRecord(ctx, false)));
        }
    },

    // userId (optional) limits the lookup to messages that user created
    history: async function(guid, sessId, userId = null) {
        const where = { guid, sessId };
        if(userId) where.created_by = userId;
        const result = await _DB.db_selectQ("logdb", "log_ai_messages", "*", where, {});
        return result?.results || [];
    }
}
