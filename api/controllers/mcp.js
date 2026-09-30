//Real MCP (Model Context Protocol) server
//
//Protocol/session/registry logic lives in ./mcp/*.js - this file just wires
//the controller up: initialize() registers the core system tools, and
//handleRequest is what api/server.js's /mcp route alias calls directly with
//the raw req/res (see api/controllers/mcp/handler.js for why).

const HANDLER = require("./mcp/handler.js");
const REGISTRY = require("./mcp/registry.js");

module.exports = {

    initialize: async function () {
        REGISTRY.registerSystemTools();
        await REGISTRY.loadPluginTools();

        console.log("\x1b[36m%s\x1b[0m", "MCP Server Initialized");

        //Reached via a direct route alias (api/server.js -> mcp/handler.js),
        //not the system.controllers dispatcher, so no need to return true.
    },

    handleRequest: HANDLER.handleRequest
}
