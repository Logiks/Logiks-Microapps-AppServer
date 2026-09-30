//MCP system tool: query_results
//Runs a read query against a configured database using the existing Logiks
//JSON query DSL (QUERY.parseQuery), the same compiler api/services/query.service.js
//uses for its dev-only /api/query endpoint.
//
//QUERY.parseQuery does not escape values on its own (its cleanSQL() hook is
//a no-op) - that's why query.service.js restricts itself to dev/staging.
//This tool is meant to work in production, so table/column/groupby/orderby
//are validated against the real schema and where/filter values are
//quote-escaped by ./_sqlGuard.js before anything is compiled to SQL. join
//and having are rejected outright rather than passed through unvalidated.

const SQLGUARD = require("./_sqlGuard.js");

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 50;

module.exports = {
    definition: {
        name: "query_results",
        description: "Runs a read-only SELECT against a configured database using Logiks' JSON query DSL (table + column/where/groupby/orderby), and returns the matching rows. Use query_schema first to see available tables/columns. join and having are not supported.",
        inputSchema: {
            type: "object",
            properties: {
                dbkey: { type: "string", description: "Configured database key. Defaults to 'appdb'." },
                table: { type: "string", description: "A single table name (must exist in query_schema's output)." },
                column: { type: "string", description: "Comma-separated column list, each a real column of `table`. Defaults to '*'." },
                where: { type: "object", description: "Logiks DSL where-clause object, e.g. {\"status\": \"active\", \"age\": [18, \"gt\"]}. Keys must be real columns." },
                filter: { type: "object", description: "Additional Logiks DSL filter object, merged with where. Keys must be real columns." },
                groupby: { type: "string" },
                orderby: { type: "string" },
                limit: { type: "number", description: `Row cap, default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.` },
                offset: { type: "number" }
            },
            required: ["table"]
        }
    },

    handler: async function (args = {}, ctx) {
        if (!args.table) {
            throw new LogiksError("`table` is required", 400, "INVALID_PARAMS");
        }

        const dbkey = args.dbkey || "appdb";
        const limit = Math.max(1, Math.min(parseInt(args.limit) || DEFAULT_LIMIT, MAX_LIMIT));

        const safeArgs = await SQLGUARD.guardQueryArgs(args, dbkey);

        const queryObj = {
            table: safeArgs.table,
            column: safeArgs.column || "*",
            where: safeArgs.where,
            groupby: safeArgs.groupby,
            orderby: safeArgs.orderby,
            limit,
            offset: parseInt(args.offset) || 0
        };

        const sqlQuery = await QUERY.parseQuery(queryObj, safeArgs.filter, ctx?.meta || {});
        if (!sqlQuery) {
            throw new LogiksError("Failed to compile query", 400, "QUERY_COMPILE_FAILED");
        }
        if (sqlQuery.trim().slice(0, 6).toLowerCase() !== "select") {
            throw new LogiksError("Only SELECT queries are permitted through this tool", 400, "NON_SELECT_QUERY");
        }

        const dbResponse = await _DB.db_query(dbkey, sqlQuery, {});
        if (!dbResponse) {
            throw new LogiksError(`Database not connected: ${dbkey}`, 500, "DB_NOT_CONNECTED");
        }
        if (dbResponse.err_code) {
            throw new LogiksError(dbResponse.err_message || "Query failed", 500, "QUERY_FAILED", dbResponse.err_code);
        }

        return {
            dbkey,
            sql: sqlQuery,
            rows: dbResponse.results || [],
            count: (dbResponse.results || []).length
        };
    }
};
