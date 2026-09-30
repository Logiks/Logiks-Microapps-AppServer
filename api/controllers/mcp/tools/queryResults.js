//MCP system tool: query_results
//Runs a read query against a configured database using the existing Logiks
//JSON query DSL (QUERY.parseQuery), the same compiler api/services/query.service.js
//uses for its dev-only /api/query endpoint. The DSL only ever compiles to a
//SELECT statement, but a startsWith("select") check is kept as a defensive
//backstop before anything touches _DB.db_query.

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 50;

module.exports = {
    definition: {
        name: "query_results",
        description: "Runs a read-only SELECT against a configured database using Logiks' JSON query DSL (table + column/where/join/groupby/orderby), and returns the matching rows. Use query_schema first to see available tables/columns.",
        inputSchema: {
            type: "object",
            properties: {
                dbkey: { type: "string", description: "Configured database key. Defaults to 'appdb'." },
                table: { type: "string", description: "Table name (or comma-separated tables when joining)." },
                column: { type: "string", description: "Comma-separated column list. Defaults to '*'." },
                where: { type: "object", description: "Logiks DSL where-clause object, e.g. {\"status\": \"active\", \"age\": [18, \"gt\"]}." },
                filter: { type: "object", description: "Additional Logiks DSL filter object, merged with where." },
                join: { type: "array", description: "Logiks DSL join definitions." },
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

        const queryObj = {
            table: args.table,
            column: args.column || "*",
            where: args.where || {},
            groupby: args.groupby,
            orderby: args.orderby,
            limit,
            offset: parseInt(args.offset) || 0
        };
        if (args.join) queryObj.join = args.join;

        const sqlQuery = await QUERY.parseQuery(queryObj, args.filter || {}, ctx?.meta || {});
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
