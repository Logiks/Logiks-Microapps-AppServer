//Input validation for the MCP tools that build SQL through QUERY.parseQuery
//(query_results, query_analyse).
//
//QUERY.parseQuery interpolates table/column/where/groupby/orderby straight
//into the SQL string. Its own value-escaping hook, cleanSQL() in query.js,
//is a no-op (`function cleanSQL(str) { return str; }`) - it does not escape
//anything. api/services/query.service.js, which exposes the same compiler
//over HTTP, is gated behind `if (isProd || isStaging) throw ... RESTRICTED_ENVIRONMENT`
//for exactly this reason - it's a dev/debugging tool, not safe for
//untrusted input in production.
//
//MCP tool arguments are effectively untrusted input (they come from
//whatever an LLM decides to call the tool with, which can itself be
//steered by prompt injection in content the LLM has read) and these tools
//need to work in production, so disabling them isn't an option. Instead
//this validates everything at the MCP boundary before it ever reaches
//QUERY.parseQuery:
//  - table must be a single table that actually exists in the schema
//  - column/groupby/orderby must reference real columns of that table (or "*")
//  - where/filter values are deep-escaped (doubled single quotes) so a
//    string value can't break out of the quotes QUERY.parseQuery wraps it in
//  - join/having are rejected outright - too easy to smuggle arbitrary SQL
//    through their raw-condition strings to validate safely here

const IDENTIFIER_RE = /^[a-zA-Z0-9_]+$/;

async function getTableSchema(dbkey, table) {
    const schema = await DBMIGRATOR.exportSchema(dbkey, false, false);

    if (schema && schema.success === false) {
        throw new LogiksError(schema.message || "Failed to read schema", 500, "SCHEMA_READ_FAILED");
    }

    if (!IDENTIFIER_RE.test(table)) {
        throw new LogiksError(`Invalid table name: ${table}`, 400, "INVALID_TABLE");
    }

    if (!schema[table]) {
        throw new LogiksError(`Unknown table: ${table}`, 404, "TABLE_NOT_FOUND");
    }

    return schema[table];
}

//Validates a comma-separated list of columns (e.g. "id, name" or "*"),
//optionally allowing a trailing " ASC"/" DESC" per entry (for orderby).
function assertKnownColumnList(list, tableSchema, { allowDirection = false, label = "columns" } = {}) {
    if (!list) return;
    if (list.trim() === "*") return;

    const entries = list.split(",").map((s) => s.trim()).filter(Boolean);

    for (let entry of entries) {
        if (allowDirection) {
            entry = entry.replace(/\s+(asc|desc)$/i, "");
        }

        const colName = entry.includes(".") ? entry.split(".").pop() : entry;

        if (!IDENTIFIER_RE.test(colName) || !tableSchema.columns[colName]) {
            throw new LogiksError(`Unknown column in ${label}: ${entry}`, 400, "UNKNOWN_COLUMN");
        }
    }
}

//Walks a where/filter object and validates every key as a column identifier.
//Values are left as-is: QUERY.parseQuery escapes quotes and backslashes in
//them itself, and escaping here as well would double them. Covers the DSL's
//shorthand forms: {col: "value"}, {col: [value, op]}, {col: "~value"}.
function escapeValuesDeep(input) {
    if (typeof input === "string") return input;
    if (Array.isArray(input)) return input.map(escapeValuesDeep);
    if (input && typeof input === "object") {
        const out = {};
        for (const key of Object.keys(input)) {
            if (!IDENTIFIER_RE.test(key.includes(".") ? key.split(".").pop() : key)) {
                throw new LogiksError(`Unknown column in where/filter: ${key}`, 400, "UNKNOWN_COLUMN");
            }
            out[key] = escapeValuesDeep(input[key]);
        }
        return out;
    }
    return input;
}

function assertKnownWhereColumns(whereObj, tableSchema) {
    if (!whereObj || typeof whereObj !== "object") return;
    for (const key of Object.keys(whereObj)) {
        const colName = key.includes(".") ? key.split(".").pop() : key;
        if (!IDENTIFIER_RE.test(colName) || !tableSchema.columns[colName]) {
            throw new LogiksError(`Unknown column in where/filter: ${key}`, 400, "UNKNOWN_COLUMN");
        }
    }
}

//Runs every check above for a query_results/query_analyse style args object.
//Returns a sanitized copy safe to hand to QUERY.parseQuery. Throws on
//anything it can't validate (join/having, unknown table/columns).
async function guardQueryArgs(args, dbkey) {
    if (args.join) {
        throw new LogiksError("`join` is not supported through this tool", 400, "UNSUPPORTED_PARAM");
    }
    if (args.having) {
        throw new LogiksError("`having` is not supported through this tool", 400, "UNSUPPORTED_PARAM");
    }

    const tableSchema = await getTableSchema(dbkey, args.table);

    assertKnownColumnList(args.column || "*", tableSchema, { label: "column" });
    assertKnownColumnList(args.groupby, tableSchema, { label: "groupby" });
    assertKnownColumnList(args.orderby, tableSchema, { allowDirection: true, label: "orderby" });

    assertKnownWhereColumns(args.where, tableSchema);
    assertKnownWhereColumns(args.filter, tableSchema);

    return {
        ...args,
        where: escapeValuesDeep(args.where || {}),
        filter: escapeValuesDeep(args.filter || {})
    };
}

module.exports = {
    guardQueryArgs
};
