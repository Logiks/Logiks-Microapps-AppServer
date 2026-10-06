//Tooling Gateway Integration Layer for AICore.
//Wraps the existing MCP tool registry directly (in-process, no HTTP hop) -
//AICore does not have its own separate tool system, it uses the same local
//tools MCP clients see via tools/list and tools/call.

const REGISTRY = require("../mcp/registry.js");

module.exports = {

    //Full MCP tool catalog, optionally narrowed to a persona's allowed_tools list.
    list: function(ctx, allowedTools = null) {
        const tools = REGISTRY.listTools(ctx);
        if (!Array.isArray(allowedTools) || allowedTools.length === 0) return tools;
        return tools.filter(t => allowedTools.indexOf(t.name) >= 0);
    },

    run: async function(toolId, args = {}, ctx) {
        return await REGISTRY.callTool(toolId, args, ctx);
    }
}
