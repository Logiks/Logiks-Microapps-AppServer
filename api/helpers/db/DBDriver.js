//Abstract base for all DB engine drivers.
//Every method returns raw, undecrypted rows/counts - _db.js layers
//encryption, hooks and the {status,...} envelope on top so that behaviour
//stays identical across engines.

class DBDriver {

    constructor(dbKey, dbProps) {
        this.DBKEY = dbKey;
        this.DBPROPS = dbProps;
    }

    //Synchronous by contract: creates the pool/client and returns immediately
    //(mirrors the pre-refactor _db.js, whose non-async initialize() is invoked
    //without await by api/baseapp.js). Any real connectivity check should run
    //in the background and only log - it must not block registration, since
    //db_query()/db_connection() need the driver usable the instant connect()
    //returns.
    connect() {
        throw new Error("connect() not implemented");
    }

    async disconnect() {
        throw new Error("disconnect() not implemented");
    }

    //Native pool/client, exposed for backward-compat callers (eg. dbMigrator)
    getRawConnection() {
        throw new Error("getRawConnection() not implemented");
    }

    //Raw SQL passthrough - used by db_query. Not every engine supports SQL text.
    async rawQuery(sql, params, table) {
        throw new Error("rawQuery() not implemented");
    }

    async findOne(table, columns, where, orderBy) {
        throw new Error("findOne() not implemented");
    }

    //joins: optional array of { query, table, condition, as, type } used by
    //the SQL-family drivers (see buildJoinClause below) - engines with no
    //JOIN concept (Mongo, DynamoDB) should reject a non-empty array instead
    //of silently ignoring it.
    async select(table, columns, where, whereParams, additionalQueryParams, joins) {
        throw new Error("select() not implemented");
    }

    //Builds "{TYPE} JOIN (subquery) alias ON condition" clauses shared by
    //every SQL-family driver (MySQL/PgSQL/MSSQL/DuckDB) - the syntax is
    //identical ANSI SQL across all of them. Each join entry:
    //  - query: a subquery SQL string, wrapped in parens - OR -
    //    table: a plain table name, used as-is (no parens)
    //  - condition: raw ON-clause text (required)
    //  - as: alias text spliced in verbatim after the join target (eg.
    //    "as ydt", or just "ydt" - whatever the caller supplies is used
    //    exactly as given, no "AS" keyword is assumed or added)
    //  - type: join type, defaults to "INNER"
    //`query`/`condition`/`as` are raw trusted SQL text (like the existing
    //"RAW" where-clause passthrough) - not parameterized, no escaping.
    buildJoinClause(joins) {
        if (!Array.isArray(joins) || joins.length <= 0) return "";

        return joins.map((j) => {
            if (!j || !j.condition || (!j.query && !j.table)) {
                throw new Error(`invalid join entry ${JSON.stringify(j)} - a join needs "condition" and either "query" or "table"`);
            }

            const type = (j.type || "INNER").toUpperCase();
            const target = j.query ? `(${j.query})` : j.table;
            const alias = j.as || "";

            return ` ${type} JOIN ${target} ${alias} ON ${j.condition} `;
        }).join(" ");
    }

    async insertOne(table, data) {
        throw new Error("insertOne() not implemented");
    }

    async insertBatch(table, dataArr) {
        throw new Error("insertBatch() not implemented");
    }

    async update(table, data, where) {
        throw new Error("update() not implemented");
    }

    async delete(table, where) {
        throw new Error("delete() not implemented");
    }

    //Dialect literal-escaping, used by db_clean/db_clean_key style helpers
    escape(value) {
        throw new Error("escape() not implemented");
    }
}

module.exports = DBDriver;
