//MCP system tool: query_analyse
//Runs EXPLAIN on a query built from the Logiks JSON query DSL - same DSL,
//same validation (./_sqlGuard.js), same table/column/where restrictions as
//query_results. There is deliberately no raw-`sql` passthrough option: an
//EXPLAIN over caller-supplied raw SQL text is a direct injection vector
//(checking the string merely starts with "select" does not stop a stacked
//query or UNION-based read), so this only ever runs SQL it compiled itself.

const SQLGUARD = require("./_sqlGuard.js");

module.exports = {
    definition: {
        name: "query_analyse",
        description: "Returns the query execution plan (EXPLAIN) for a SELECT built from the Logiks JSON query DSL (table/where/groupby/orderby) - the same shape query_results takes. Use this to check whether a query_results call will use an index before running it against real data. join and having are not supported.",
        inputSchema: {
            type: "object",
            properties: {
                dbkey: { type: "string", description: "Configured database key. Defaults to 'appdb'." },
                table: { type: "string", description: "A single table name (must exist in query_schema's output)." },
                column: { type: "string" },
                where: { type: "object" },
                filter: { type: "object" },
                groupby: { type: "string" },
                orderby: { type: "string" }
            },
            required: ["table"]
        }
    },

    handler: async function (args = {}, ctx) {
        if (!args.table) {
            throw new LogiksError("`table` is required", 400, "INVALID_PARAMS");
        }

        const dbkey = args.dbkey || "appdb";
        const safeArgs = await SQLGUARD.guardQueryArgs(args, dbkey);

        const queryObj = {
            table: safeArgs.table,
            column: safeArgs.column || "*",
            where: safeArgs.where,
            groupby: safeArgs.groupby,
            orderby: safeArgs.orderby,
            limit: 1,
            offset: 0
        };

        const sqlQuery = await QUERY.parseQuery(queryObj, safeArgs.filter, ctx?.meta || {});
        if (!sqlQuery) {
            throw new LogiksError("Failed to compile query", 400, "QUERY_COMPILE_FAILED");
        }
        if (sqlQuery.trim().slice(0, 6).toLowerCase() !== "select") {
            throw new LogiksError("Only SELECT queries can be analysed through this tool", 400, "NON_SELECT_QUERY");
        }

        const dbResponse = await _DB.db_query(dbkey, `EXPLAIN ${sqlQuery}`, {});
        if (!dbResponse) {
            throw new LogiksError(`Database not connected: ${dbkey}`, 500, "DB_NOT_CONNECTED");
        }
        if (dbResponse.err_code) {
            throw new LogiksError(dbResponse.err_message || "Explain failed", 500, "EXPLAIN_FAILED", dbResponse.err_code);
        }

        return {
            dbkey,
            sql: sqlQuery,
            plan: dbResponse.results || []
        };
    }
};
