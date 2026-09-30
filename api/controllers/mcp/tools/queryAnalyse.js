//MCP system tool: query_analyse
//Runs EXPLAIN on a query, either compiled from the Logiks JSON query DSL
//(same as query_results) or from a raw SELECT string. No helper for this
//existed in the codebase yet - this is new, purpose-built for MCP.

module.exports = {
    definition: {
        name: "query_analyse",
        description: "Returns the query execution plan (EXPLAIN) for a SELECT, either built from the Logiks JSON query DSL (table/where/join/...) or from a raw SQL string. Use this to check whether a query_results call will use an index before running it against real data.",
        inputSchema: {
            type: "object",
            properties: {
                dbkey: { type: "string", description: "Configured database key. Defaults to 'appdb'." },
                table: { type: "string", description: "Table name, when building the query from the DSL." },
                column: { type: "string" },
                where: { type: "object" },
                filter: { type: "object" },
                join: { type: "array" },
                groupby: { type: "string" },
                orderby: { type: "string" },
                sql: { type: "string", description: "A raw SELECT statement to analyse instead of the DSL fields above." }
            }
        }
    },

    handler: async function (args = {}, ctx) {
        const dbkey = args.dbkey || "appdb";
        let sqlQuery;

        if (args.sql) {
            sqlQuery = args.sql.trim();
        } else {
            if (!args.table) {
                throw new LogiksError("Provide either `sql` or `table` (to build the query from the DSL)", 400, "INVALID_PARAMS");
            }

            const queryObj = {
                table: args.table,
                column: args.column || "*",
                where: args.where || {},
                groupby: args.groupby,
                orderby: args.orderby,
                limit: 1,
                offset: 0
            };
            if (args.join) queryObj.join = args.join;

            sqlQuery = await QUERY.parseQuery(queryObj, args.filter || {}, ctx?.meta || {});
            if (!sqlQuery) {
                throw new LogiksError("Failed to compile query", 400, "QUERY_COMPILE_FAILED");
            }
        }

        if (sqlQuery.slice(0, 6).toLowerCase() !== "select") {
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
