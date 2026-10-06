//MCP tool registry.
//
//Holds two kinds of tools:
//  - system tools (./tools/*.js) - always available, implemented in core.
//  - plugin tools - declared per-plugin in a tools.json manifest next to
//    that plugin's logiks.json (see ./schema/tools.schema.json for the
//    format, ./schema/tools.example.json for a worked example). The Worker
//    is expected to aggregate every installed plugin's tools.json and
//    include it as a `tools` array in its system.registerWorker call, the
//    same way it already reports `policies`/`navigation`. This is the
//    AppServer-side half of that contract - it still needs:
//      1. The Worker repo actually reading tools.json and sending `tools`.
//      2. system.service.js's registerWorker `params` to accept a `tools`
//         array, and its `plugins` action to aggregate node.tools into a
//         TOOLS array the same way it aggregates PLUGINS/SERVICES/MENUS.
//    Until #2 is made, system.plugins won't return TOOLS and
//    loadPluginTools() below will just register nothing (harmless no-op).

const SYSTEM_TOOLS = require("./tools/index.js");

const TOOLS = new Map();

function registerTool(definition, handler, source = "system") {
    if (!definition || !definition.name || typeof handler !== "function") {
        throw new Error("registerTool requires a definition with a `name` and a handler function");
    }
    TOOLS.set(definition.name, { definition, handler, source });
}

function registerSystemTools() {
    for (const tool of SYSTEM_TOOLS) {
        registerTool(tool.definition, tool.handler, "system");
    }
}

//Reads plugin-declared tools back out of system.plugins (see header
//comment) and registers each one. A no-op until the Worker side and
//system.service.js are updated to actually carry a `tools` array through -
//aggregated.TOOLS will simply be undefined/empty until then.
async function loadPluginTools() {
    let aggregated;
    try {
        aggregated = await SERVER.getBroker().call("system.plugins", {});
    } catch (e) {
        console.error("MCP: failed to load plugin tools from system.plugins", e.message);
        return;
    }

    const tools = (aggregated && aggregated.TOOLS) || [];
    for (const entry of tools) {
        registerPluginTool(entry);
    }
}

function registerPluginTool(entry) {
    if (!entry || !entry.namespace || !entry.name || !entry.action) {
        console.error("MCP: skipping malformed plugin tool entry", entry);
        return;
    }

    const toolName = `${entry.namespace}__${entry.name}`;

    if (TOOLS.has(toolName)) {
        console.error(`MCP: tool name collision on '${toolName}' - keeping the first registration, skipping '${entry.plugin || "unknown plugin"}'`);
        return;
    }

    registerTool(
        {
            name: toolName,
            description: entry.description,
            inputSchema: entry.inputSchema
        },
        async function pluginToolHandler(args, ctx) {
            if (entry.policy) {
                const allowed = await RBAC.checkPolicy(ctx, entry.policy, false);
                if (!allowed) {
                    const err = new Error(`Not authorized to use '${toolName}': missing policy '${entry.policy}'`);
                    err.code = "FORBIDDEN";
                    throw err;
                }
            }

            return await SERVER.getBroker().call(entry.action, args || {}, { meta: (ctx && ctx.meta) || {} });
        },
        entry.plugin || "plugin"
    );
}

// System tools read schema and rows from any configured database, so they are limited to admins by default
// (same rule as the gateway's `admin.*` actions). CONFIG.mcp.system_tool_privileges can widen it.
function canUseSystemTools(ctx) {
    const user = ctx && ctx.meta && ctx.meta.user;
    if (!user) return false;

    const privileges = (CONFIG.mcp && CONFIG.mcp.system_tool_privileges) || ["root", "devroot", "admin"];
    return (Array.isArray(user.roles) && user.roles.includes("admin")) || privileges.includes(user.privilege);
}

function listTools(ctx) {
    const allowSystem = canUseSystemTools(ctx);
    return Array.from(TOOLS.values())
        .filter((t) => t.source !== "system" || allowSystem)
        .map((t) => t.definition);
}

async function callTool(name, args, ctx) {
    const tool = TOOLS.get(name);
    if (!tool) {
        const err = new Error(`Unknown tool: ${name}`);
        err.code = "TOOL_NOT_FOUND";
        throw err;
    }

    if (tool.source === "system" && !canUseSystemTools(ctx)) {
        const err = new Error(`Not authorized to use '${name}'`);
        err.code = "FORBIDDEN";
        throw err;
    }

    return await tool.handler(args || {}, ctx);
}

module.exports = {
    registerTool,
    registerSystemTools,
    loadPluginTools,
    listTools,
    callTool
};
