"use strict";
//REST surface for AICore's persona/agent registries and agent runs.
//Thin wrapper - all logic lives in AICORE (api/controllers/aicore.js and
//api/controllers/aicore/*.js), this just exposes it over HTTP and scopes
//everything to the caller's tenant (ctx.meta.user.guid).

module.exports = {
	name: "agents",

	actions: {

        listPersonas: {
            rest: { method: "GET", fullPath: "/ai/personas" },
            async handler(ctx) {
                return await AICORE.personas.list(ctx.meta.user.guid);
            }
        },

        upsertPersona: {
            rest: { method: "POST", fullPath: "/ai/personas/:personaCode" },
            async handler(ctx) {
                return await AICORE.personas.upsert(ctx.meta.user.guid, ctx.params.personaCode, ctx.params, ctx);
            }
        },

        removePersona: {
            rest: { method: "DELETE", fullPath: "/ai/personas/:personaCode" },
            async handler(ctx) {
                await AICORE.personas.remove(ctx.meta.user.guid, ctx.params.personaCode, ctx);
                return { status: "removed" };
            }
        },

        listAgents: {
            rest: { method: "GET", fullPath: "/ai/agents" },
            async handler(ctx) {
                return await AICORE.agents.list(ctx.meta.user.guid);
            }
        },

        upsertAgent: {
            rest: { method: "POST", fullPath: "/ai/agents/:agentCode" },
            async handler(ctx) {
                return await AICORE.agents.upsert(ctx.meta.user.guid, ctx.params.agentCode, ctx.params, ctx);
            }
        },

        removeAgent: {
            rest: { method: "DELETE", fullPath: "/ai/agents/:agentCode" },
            async handler(ctx) {
                await AICORE.agents.remove(ctx.meta.user.guid, ctx.params.agentCode, ctx);
                return { status: "removed" };
            }
        },

        //Runs an agent. Inline by default; pass ?async=true to publish the
        //run to the cross-node queue instead (see AICORE.queueAgentRun).
        runAgent: {
            rest: { method: "POST", fullPath: "/ai/agents/:agentCode/run" },
            async handler(ctx) {
                const { agentCode } = ctx.params;
                const { message, sessId, async: runAsync } = ctx.params;

                if (runAsync === true || runAsync === "true") {
                    return await AICORE.queueAgentRun(agentCode, message, sessId, ctx);
                }

                return await AICORE.runAgent(agentCode, message, sessId, ctx);
            }
        },

        sessionHistory: {
            rest: { method: "GET", fullPath: "/ai/sessions/:sessId" },
            async handler(ctx) {
                return await AICORE.sessionHistory(ctx.meta.user.guid, ctx.params.sessId, ctx.meta.user.userId);
            }
        }
    }
}
