//MCP system tool: query_schema
//Returns table/column definitions for a database, built on top of the
//existing DBMIGRATOR.exportSchema() introspection (SHOW TABLES + DESCRIBE).

module.exports = {
    definition: {
        name: "query_schema",
        description: "Lists tables and their column definitions (type, nullable, default, primary key) for a database configured on this server. Does not return row data.",
        inputSchema: {
            type: "object",
            properties: {
                dbkey: { type: "string", description: "Configured database key, e.g. 'appdb' or 'logdb'. Defaults to 'appdb'." },
                table_prefix: { type: "string", description: "Only include tables whose name starts with this prefix (e.g. a plugin's table namespace)." },
                table: { type: "string", description: "Return only this single table, if given." }
            }
        }
    },

    handler: async function (args = {}) {
        const dbkey = args.dbkey || "appdb";

        const schema = await DBMIGRATOR.exportSchema(dbkey, false, args.table_prefix || false);

        if (schema && schema.success === false) {
            throw new LogiksError(schema.message || "Failed to read schema", 500, "SCHEMA_READ_FAILED");
        }

        if (args.table) {
            if (!schema[args.table]) {
                throw new LogiksError(`Table not found: ${args.table}`, 404, "TABLE_NOT_FOUND");
            }
            return { dbkey, tables: { [args.table]: schema[args.table] } };
        }

        return { dbkey, tables: schema };
    }
};
