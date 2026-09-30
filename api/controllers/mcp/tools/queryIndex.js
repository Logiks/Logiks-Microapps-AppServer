//MCP system tool: query_index
//Surfaces index information for a database/table, sourced from the same
//DBMIGRATOR.exportSchema() introspection as query_schema (SHOW INDEX FROM).

module.exports = {
    definition: {
        name: "query_index",
        description: "Lists indexes defined on a table (or all tables in a database), to help decide how a query should filter/sort/join for performance.",
        inputSchema: {
            type: "object",
            properties: {
                dbkey: { type: "string", description: "Configured database key, e.g. 'appdb' or 'logdb'. Defaults to 'appdb'." },
                table: { type: "string", description: "Only return indexes for this table. Omit to list indexes for every table." }
            }
        }
    },

    handler: async function (args = {}) {
        const dbkey = args.dbkey || "appdb";

        const schema = await DBMIGRATOR.exportSchema(dbkey, false, false);

        if (schema && schema.success === false) {
            throw new LogiksError(schema.message || "Failed to read schema", 500, "SCHEMA_READ_FAILED");
        }

        if (args.table) {
            if (!schema[args.table]) {
                throw new LogiksError(`Table not found: ${args.table}`, 404, "TABLE_NOT_FOUND");
            }
            return { dbkey, indexes: { [args.table]: schema[args.table].indexes } };
        }

        const indexes = {};
        for (const table of Object.keys(schema)) {
            indexes[table] = schema[table].indexes;
        }

        return { dbkey, indexes };
    }
};
