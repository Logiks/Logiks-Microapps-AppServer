//Aggregates the core system tools that are always available over MCP,
//regardless of which plugins are installed.

module.exports = [
    require("./querySchema.js"),
    require("./queryIndex.js"),
    require("./queryResults.js"),
    require("./queryAnalyse.js")
];
