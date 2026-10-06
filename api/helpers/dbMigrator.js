//Controller for For database migration

const fs1 = require("fs-extra");
const diff = require("deep-diff").diff;
const nodeCrypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

const SCHEMA_DIR = "misc/dbschema/";//path.join(__dirname, "../schema_versions");
fs1.ensureDirSync(SCHEMA_DIR);

function _getMysqlConnection(dbKey) {
    const raw = _DB.db_connection(dbKey);
    if (!raw) throw new Error(`No database driver configured/enabled for dbkey "${dbKey}"`);
    return raw.promise();
}

module.exports = {
    
    initalize : function() {
        console.log("\x1b[36m%s\x1b[0m","DataMigrator Initialized");
    },

    getMigrationFile : async function(dbkey) {
        const files = await fs1.readdir(SCHEMA_DIR);

        const matched = files
                .filter(f => f.startsWith(`schema_${dbkey}`)  && f.endsWith(".json"))
                .map(f => ({
                    name: f,
                    time: fs.statSync(path.join(SCHEMA_DIR, f)).mtimeMs
                }));
        if (matched.length>0) {
            matched.sort((a, b) => b.time - a.time);

            return matched[0];
        } else {
            return false;
        }
    },

    pluginMigration: async function(pluginID, schemaFile) {
        printObj(`Plugin Migration Checking for ${pluginID} - mode:${process.env.MIGRATION_MODE}`, "pink", 2);

        const DBKEYS = _dbkeys();
        switch(process.env.MIGRATION_MODE) {
            case "IMPORT":
                var responses = {};
                const dbkeyList = Object.keys(schemaFile);
                for(var i=0;i<dbkeyList.length;i++) {
                    const dbkey = dbkeyList[i];
                    const schema = schemaFile[dbkey];

                    printObj(`Running Migration - Importing in ${dbkey} for ${pluginID}`, "pink", 3);
                    var schemaData = await DBMIGRATOR.generateMigration(dbkey, schema, false, false);
                    // console.log("XXXXXXXXXXX", pluginID, dbkey, schemaData);
                    
                    if(schemaData.success) {
                        if(schemaData.statements>0) {
                            printObj(`DB Difference Found in ${dbkey} for with ${schemaData.statements} changes`, "pink", 3);

                            var result = await DBMIGRATOR.applyMigrationSchema(dbkey, schemaData.schema);

                            printObj(`Migration Completed in ${dbkey} for with status - ${result.success}`, "pink", 3);
                            reportMigrationNotes(dbkey, schemaData, result, 3);
                            await logMigration(dbkey, `plugin:${pluginID}`, schemaData.schema, result.success ? "imported" : "error", migrationDetails(schemaData, result), pluginID);

                            if(result.success)
                                responses[dbkey] = {"mode": process.env.MIGRATION_MODE, "status": "success", "message": "Successfully Migrated", "statements": schemaData.statements};
                            else
                                responses[dbkey] = {"mode": process.env.MIGRATION_MODE, "status": "error", "message": result.message};
                        } else {
                            printObj(`Migration Completed in ${dbkey} for with No Changes Found`, "pink", 3);

                            responses[dbkey] = {"mode": process.env.MIGRATION_MODE, "status": "success", "message": "No Changes Found"};
                        }
                    } else {
                        printObj(`Migration Completed for ${dbkey} with Error - ${schemaData.message}`, "pink", 3);
                        await logMigration(dbkey, `plugin:${pluginID}`, "", "error", { error: schemaData.message }, pluginID);
                        responses[dbkey] = {"mode": process.env.MIGRATION_MODE, "status": "error", "message": schemaData.message};
                    }
                }
                return {"mode": process.env.MIGRATION_MODE, "responses": responses};
                break;
            case "EXPORT":
                var result = {};
                for(i=0;i<DBKEYS.length;i++) {
                    const dbkey = DBKEYS[i];
                    printObj(`Running Migration - Exporting in ${dbkey} for ${pluginID}`, "pink", 3);
                    result[dbkey] = await DBMIGRATOR.exportSchema(dbkey, false, pluginID);
                }
                return {"mode": process.env.MIGRATION_MODE, "schema": result};
                break;
            default:
                printObj("Running Migration - Mode Not Supported", "grey", 3);
                return {"mode": process.env.MIGRATION_MODE, "status": "error", "message": "Running Migration - Mode Not Supported"};
        }
    },

    startMigration : async function(dbkey) {
        printObj(`Migration Checking for ${dbkey}`, "yellow", 2);

        const matched = await DBMIGRATOR.getMigrationFile(dbkey);
        if (matched===false) {
            printObj(`Migration Completed for ${dbkey} with status - No Schema File Found For`, "yellow", 2);

            return {"status": "error", "message": `No Schema File Found For - ${dbkey}`};
        }

        const fileName = matched.name;
        printObj(`Migration Running for ${dbkey} from file - ${fileName}`, "yellow", 2);

        var schemaData = await DBMIGRATOR.generateMigration(dbkey, fileName, false);
        if(schemaData.success) {
            if(schemaData.statements>0) {
                printObj(`DB Difference Found in ${dbkey} with ${schemaData.statements} changes`, "yellow", 2);

                var result = await DBMIGRATOR.applyMigrationSchema(dbkey, schemaData.schema);

                printObj(`Migration Completed for ${dbkey} with status - ${result.success}`, "yellow", 2);
                reportMigrationNotes(dbkey, schemaData, result, 2);
                await logMigration(dbkey, fileName, schemaData.schema, result.success ? "imported" : "error", migrationDetails(schemaData, result));

                if(result.success)
                    return {"status": "success", "message": "Successfully Migrated", "statements": schemaData.statements};
                else
                    return {"status": "error", "message": result.message};
            } else {
                printObj(`Migration Completed for ${dbkey} with No Changes Found`, "yellow", 2);

                return {"status": "success", "message": "No Changes Found"};
            }
        } else {
            printObj(`Migration Completed for ${dbkey} with Error - ${schemaData.message}`, "yellow", 2);
            await logMigration(dbkey, fileName, "", "error", { error: schemaData.message });
            return {"status": "error", "message": schemaData.message};
        }
    },

    saveMigrationScript : async function(dbkey) {
        printObj(`Generating Migration Script for ${dbkey}`, "yellow", 2);

        var result = await DBMIGRATOR.exportSchema(dbkey, true);

        printObj(`Migration Completed for ${dbkey} with status - ${result.success} - ${result.file}`, "yellow", 2);

        if(result.success)
            return {"status": "success", "message": "Successfully Generated"};
        else
            return {"status": "error", "message": result.message};
    },

    /* ------------------------------------------
    1. EXPORT SCHEMA → JSON
    ------------------------------------------ */
    exportSchema : async function(dbKey, writeFile = true, tablePrefix = false) {
        try {
            const mysqlConnection = _getMysqlConnection(dbKey);

            const schema = {};
            const [tables] = await mysqlConnection.query(`SHOW TABLES`);

            for (const t of tables) {
                const table = Object.values(t)[0];
                
                if(["z", "y", "x", "backup", "temp"].indexOf(table.toLowerCase().split("_")[0])>=0) continue;

                if(tablePrefix) {
                    if(table.indexOf(`${tablePrefix}_`)!==0) continue;
                }

                const [columns] = await mysqlConnection.query(`DESCRIBE ${q(table)}`);
                const [indexes] = await mysqlConnection.query(`SHOW INDEX FROM ${q(table)}`);

                schema[table] = {
                    columns: {},
                    // names only, kept for older consumers; `keys` carries what is needed to recreate them
                    indexes: [...new Set(indexes.map(i => i.Key_name))],
                    keys: buildKeys(indexes)
                };

                columns.forEach(col => {
                    schema[table].columns[col.Field] = {
                        type: col.Type,
                        nullable: col.Null === "YES",
                        default: col.Default,
                        primary: col.Key === "PRI",
                        // auto_increment, on update CURRENT_TIMESTAMP, ...
                        extra: String(col.Extra || "").replace(/default_generated/ig, "").trim().toLowerCase()
                    };
                });
            }

            if(writeFile) {
                const filename = `schema_${dbKey}_${CONFIG.BUILD}.json`;//${Date.now()}
                const filepath = path.join(SCHEMA_DIR, filename);
                await fs1.writeJson(filepath, schema, { spaces: 2 });

                return { success: true, file: filename };
            } else {
                return schema;
            }
        } catch (err) {
            console.error(err);
            return { success: false, message: err.message };
        }
    },

    /* ------------------------------------------
    2. GENERATE MIGRATION SCRIPT (DDL ONLY)
    ------------------------------------------ */
    generateMigration : async function(dbKey, newSchemaFile, writeFile = false, inputSchemaIsFile = true) {//, oldSchemaFile
        try {
            //const mysqlConnection = _DB.db_connection(dbKey).promise();

            var fileContent = false;
            if(inputSchemaIsFile) {
                fileContent = await fs1.readJson(path.join(SCHEMA_DIR, newSchemaFile));
            } else {
                fileContent = newSchemaFile;
            }

            // Compare against the database being migrated, not always appdb
            const oldSchema = await DBMIGRATOR.exportSchema(dbKey, false);
            if (oldSchema && oldSchema.success === false) throw new Error(oldSchema.message);
            const newSchema = fileContent;

            const { sql, skipped, inferred } = diffSchemas(oldSchema, newSchema);

            if (sql.length === 0 && !writeFile) {
                return { success: true, message: "No schema changes found.", statements: 0, skipped, inferred };
            }

            if(writeFile) {
                const filename = `migration_${CONFIG.BUILD}.sql`;//${Date.now()}
                const filepath = path.join(SCHEMA_DIR, filename);
                await fs1.writeFile(filepath, sql.join("\n"));

                return { success: true, file: filename, statements: sql.length, skipped, inferred };
            } else {
                return { success: true, schema: sql.join("\n"), statements: sql.length, skipped, inferred };
            }
        } catch (err) {
            console.error(err);
            return { success: false, message: err.message };
        }
    },

    /* ------------------------------------------
    3. APPLY MIGRATION SCRIPT
    ------------------------------------------ */
    applyMigration : async function(dbKey, filename) {
        try {
            const mysqlConnection = _getMysqlConnection(dbKey);

            const sql = await fs1.readFile(path.join(SCHEMA_DIR, filename), "utf8");

            // Safety checks
            if (/\b(DROP|TRUNCATE|DELETE)\b/i.test(sql)) {
                return { success: false, message: "Destructive SQL detected — aborted" };
            }

            const queries = splitSQLStatements(sql);

            const conn = await mysqlConnection.getConnection();

            let outcome;
            try {
                outcome = await runStatements(conn, queries);
            } finally {
                conn.release();
            }
            if (!outcome.success) {
                console.error(outcome.message);
                await logMigration(dbKey, filename, sql, "error", { error: outcome.message, applied: outcome.executed, warnings: outcome.warnings });
                return { success: false, message: outcome.message, executed: outcome.executed };
            }

            await logMigration(dbKey, filename, sql, "imported", { warnings: outcome.warnings });
            return { success: true, file: filename, warnings: outcome.warnings };
        } catch (err) {
            console.error(err);
            return { success: false, message: err.message };
        }
    },

    applyMigrationSchema : async function(dbKey, sql) {
        try {
            const mysqlConnection = _getMysqlConnection(dbKey);

            // Safety checks
            if (/\b(DROP|TRUNCATE|DELETE)\b/i.test(sql)) {
                return { success: false, message: "Destructive SQL detected — aborted" };
            }

            const queries = splitSQLStatements(sql);

            const conn = await mysqlConnection.getConnection();

            let outcome;
            try {
                outcome = await runStatements(conn, queries);
            } finally {
                conn.release();
            }
            if (!outcome.success) {
                console.error(outcome.message);
                return { success: false, message: outcome.message, executed: outcome.executed };
            }

            return { success: true, statements: outcome.executed, warnings: outcome.warnings };
        } catch (err) {
            console.error(err);
            return { success: false, message: err.message };
        }
    }
}

/* ------------------------------------------
HELPERS
------------------------------------------ */
// Records a migration run in logdb.log_migration. Logging must never break or block a migration (logdb may itself be
// the database being migrated and not exist yet), so failures are only printed.
async function logMigration(dbkey, fileName, sql, status, details = {}, appid = "-") {
    try {
        const dated = moment().format("Y-MM-DD HH:mm:ss");
        await _DB.db_insertQ1("logdb", "log_migration", {
            "guid": uuidv4(),
            "appid": appid,
            "dbkey": dbkey,
            "file_name": String(fileName || "-").substring(0, 150),
            "version": String(CONFIG.BUILD || "-").substring(0, 250),
            "checksum": nodeCrypto.createHash("sha1").update(String(sql || "")).digest("hex"),
            "status": status,
            "changes": JSON.stringify({ statements: splitSQLStatements(String(sql || "")), ...details }),
            "blocked": "false",
            "created_on": dated,
            "created_by": "system",
            "edited_on": dated,
            "edited_by": "system",
        });
    } catch (err) {
        printObj(`Unable to write log_migration for ${dbkey} - ${err.message}`, "yellow", 3);
    }
}

// What a migration changed: the statements are added by logMigration; this adds what was skipped, inferred or failed
function migrationDetails(schemaData, result) {
    const d = { skipped: schemaData.skipped || [], inferred: schemaData.inferred || [], warnings: result?.warnings || [] };
    if (!result?.success) { d.error = result?.message; d.applied = result?.executed; }
    return d;
}

// What the migration did not do, or did by inference, is printed rather than left silent
function reportMigrationNotes(dbkey, schemaData, result, level) {
    for (const note of (schemaData.skipped || [])) printObj(`[${dbkey}] Skipped: ${note}`, "yellow", level);
    for (const note of (schemaData.inferred || [])) printObj(`[${dbkey}] Index rebuilt from its name: ${note}`, "yellow", level);
    for (const note of (result?.warnings || [])) printObj(`[${dbkey}] ${note}`, "yellow", level);
}

const q = (name) => "`" + String(name).replace(/`/g, "") + "`";

const INT_TYPE_RE = /^(tinyint|smallint|mediumint|int|integer|bigint)\b/i;
const NO_LITERAL_DEFAULT_RE = /(text|blob|json|geometry)/i;
const EXPR_DEFAULT_RE = /^(current_timestamp(\(\d*\))?|now\(\)|uuid\(\)|curdate\(\)|\(.*\))$/i;

// int(11) and int are the same column on MySQL 8 vs 5.7; do not report that as a difference
function normType(t) {
    return String(t || "").toLowerCase().replace(/\b(tinyint|smallint|mediumint|int|bigint)\(\d+\)/g, "$1").replace(/\s+/g, " ").trim();
}

function normDefault(v) {
    if (v === null || v === undefined) return null;
    const str = String(v);
    if (/^current_timestamp/i.test(str)) return "current_timestamp";
    return str.replace(/^'(.*)'$/, "$1");
}

// Columns of the table's primary key, from the exported key list when present, else from the per-column flags
function primaryColumns(def) {
    const pk = (def.keys || []).find(k => k.primary || k.name === "PRIMARY");
    if (pk) return pk.columns;
    return Object.entries(def.columns || {}).filter(([, c]) => c.primary).map(([n]) => n);
}

function hasAutoIncrement(def, name, col) {
    if (typeof col.extra === "string") return /auto_increment/i.test(col.extra);
    // Schema files exported before `extra` was recorded: every single-column integer `id` primary key on this
    // platform is auto-increment (inserts rely on insertId), so that is what the file means
    const pk = primaryColumns(def);
    return name === "id" && pk.length === 1 && pk[0] === name && INT_TYPE_RE.test(col.type);
}

function formatDefault(col) {
    const v = col.default;
    if (v === null || v === undefined) return "";
    if (EXPR_DEFAULT_RE.test(String(v))) return ` DEFAULT ${v}`;
    // TEXT/BLOB/JSON columns cannot take a literal default
    if (NO_LITERAL_DEFAULT_RE.test(col.type)) return "";
    return ` DEFAULT '${String(v).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function columnDDL(def, name, col) {
    const ai = hasAutoIncrement(def, name, col);
    let ddl = `${q(name)} ${col.type} ${col.nullable ? "NULL" : "NOT NULL"}`;

    if (!ai) ddl += formatDefault(col);
    if (ai) ddl += " AUTO_INCREMENT";

    const extra = typeof col.extra === "string" ? col.extra.replace(/auto_increment/ig, "").trim() : "";
    if (extra && !/generated/i.test(extra)) ddl += " " + extra;

    return ddl;
}

function indexClause(key) {
    const type = String(key.type || "").toUpperCase();
    const kind = type === "FULLTEXT" ? "FULLTEXT KEY" : type === "SPATIAL" ? "SPATIAL KEY" : key.unique ? "UNIQUE KEY" : "KEY";
    const cols = key.columns.map(c => q(c) + (key.lengths && key.lengths[c] ? `(${key.lengths[c]})` : ""));
    return `${kind} ${q(key.name)} (${cols.join(",")})`;
}

function buildKeys(indexRows) {
    const byName = {};
    for (const row of indexRows) {
        (byName[row.Key_name] = byName[row.Key_name] || []).push(row);
    }

    const keys = [];
    for (const [name, rows] of Object.entries(byName)) {
        rows.sort((a, b) => a.Seq_in_index - b.Seq_in_index);
        // functional/expression indexes have no column name and cannot be described here
        if (rows.some(r => !r.Column_name)) continue;

        const key = {
            name,
            primary: name === "PRIMARY",
            unique: rows[0].Non_unique === 0,
            type: rows[0].Index_type,
            columns: rows.map(r => r.Column_name)
        };
        const lengths = {};
        rows.forEach(r => { if (r.Sub_part) lengths[r.Column_name] = r.Sub_part; });
        if (Object.keys(lengths).length > 0) key.lengths = lengths;
        keys.push(key);
    }
    return keys;
}

function buildCreateTableSQL(table, def) {
    const cols = Object.entries(def.columns).map(([name, col]) => columnDDL(def, name, col));

    const clauses = [];
    const pk = primaryColumns(def);
    if (pk.length > 0) clauses.push(`PRIMARY KEY (${pk.map(q).join(",")})`);
    for (const key of (def.keys || [])) {
        if (key.primary || key.name === "PRIMARY") continue;
        clauses.push(indexClause(key));
    }

    return `CREATE TABLE IF NOT EXISTS ${q(table)} (${cols.concat(clauses).join(",")});`;
}

// Splits an index name into existing column names ("guid_rulecode_is_published_blocked" ->
// guid, rulecode, is_published, blocked), also trying it without an idx_/uq_ style prefix. Null when it cannot.
function inferKeyColumns(name, columnNames) {
    // index names are usually lower case while columns can be camelCase (idx_sessid -> sessId)
    const byLower = new Map(columnNames.map(c => [c.toLowerCase(), c]));
    const cols = { has: (c) => byLower.has(c.toLowerCase()), get: (c) => byLower.get(c.toLowerCase()) };

    for (const candidate of [name, name.replace(/^(idx|ix|uq|uniq|key)_/i, "")]) {
        if (cols.has(candidate)) return [cols.get(candidate)];

        const parts = candidate.split("_");
        const walk = (i) => {
            if (i === parts.length) return [];
            for (let j = parts.length; j > i; j--) {
                const col = parts.slice(i, j).join("_");
                if (cols.has(col)) {
                    const rest = walk(j);
                    if (rest) return [cols.get(col), ...rest];
                }
            }
            return null;
        };
        const found = walk(0);
        if (found && found.length > 0) return found;
    }
    return null;
}

// Non-destructive diff: creates tables, adds columns, primary keys, auto-increment and indexes. Changes to an
// existing column's type/nullability/default are only applied when CONFIG.migration.allow_column_modify is true;
// otherwise they are returned in `skipped` so they are visible instead of silently ignored. Nothing is dropped.
function diffSchemas(oldSchema, newSchema) {
    const sql = [];
    const skipped = [];
    const inferred = [];
    const allowModify = CONFIG?.migration?.allow_column_modify === true;

    for (const [table, def] of Object.entries(newSchema || {})) {
        if (!def || !def.columns) continue;

        const old = oldSchema[table];
        if (!old) {
            sql.push(buildCreateTableSQL(table, def));
            continue;
        }

        // Columns
        let prev = null;
        for (const [name, col] of Object.entries(def.columns)) {
            const oldCol = old.columns[name];

            if (!oldCol) {
                const ai = hasAutoIncrement(def, name, col);
                sql.push(`ALTER TABLE ${q(table)} ADD COLUMN ${columnDDL(def, name, col)}${ai && col.primary ? " PRIMARY KEY" : ""}${prev ? ` AFTER ${q(prev)}` : " FIRST"};`);
                old.columns[name] = col;
                if (ai && col.primary) {
                    // added together with its PRIMARY KEY above; later checks must not add it again
                    old.columns[name] = { ...col, extra: "auto_increment" };
                    old.keys = [{ name: "PRIMARY", primary: true, columns: [name] }];
                }
            } else {
                const stripAI = (e) => String(e || "").replace(/auto_increment/ig, "").trim().toLowerCase();
                const changes = [];
                if (normType(oldCol.type) !== normType(col.type)) changes.push(`type ${oldCol.type} -> ${col.type}`);
                if (!!oldCol.nullable !== !!col.nullable) changes.push(`nullable ${oldCol.nullable} -> ${col.nullable}`);
                if (normDefault(oldCol.default) !== normDefault(col.default)) changes.push(`default ${oldCol.default} -> ${col.default}`);
                if (typeof col.extra === "string" && stripAI(oldCol.extra) !== stripAI(col.extra)) changes.push(`extra "${stripAI(oldCol.extra)}" -> "${stripAI(col.extra)}"`);

                if (changes.length > 0) {
                    if (allowModify) sql.push(`ALTER TABLE ${q(table)} MODIFY COLUMN ${columnDDL(def, name, col)};`);
                    else skipped.push(`${table}.${name}: ${changes.join(", ")} (set migration.allow_column_modify to apply)`);
                }
            }
            prev = name;
        }

        // Primary key and auto-increment. These are what make inserts without an explicit id work, and they are
        // what a table created by an older migrator is missing.
        const newPk = primaryColumns(def);
        const oldPk = primaryColumns(old);
        const needsPk = newPk.length > 0 && oldPk.length === 0;

        if (newPk.length > 0 && oldPk.length > 0 && newPk.join(",") !== oldPk.join(",")) {
            skipped.push(`${table}: primary key (${oldPk.join(",")}) differs from the schema's (${newPk.join(",")}); not changed`);
        }

        const aiName = Object.keys(def.columns).find(n => hasAutoIncrement(def, n, def.columns[n]));
        const needsAI = aiName && !/auto_increment/i.test(String(old.columns[aiName]?.extra || "")) && old.columns[aiName] !== undefined &&
            (newPk.includes(aiName) || oldPk.includes(aiName));

        if (needsPk && needsAI) {
            sql.push(`ALTER TABLE ${q(table)} ADD PRIMARY KEY (${newPk.map(q).join(",")}), MODIFY COLUMN ${columnDDL(def, aiName, def.columns[aiName])};`);
        } else {
            if (needsPk) sql.push(`ALTER TABLE ${q(table)} ADD PRIMARY KEY (${newPk.map(q).join(",")});`);
            if (needsAI) sql.push(`ALTER TABLE ${q(table)} MODIFY COLUMN ${columnDDL(def, aiName, def.columns[aiName])};`);
        }

        // Indexes
        const oldNames = new Set((old.keys || []).map(k => k.name).concat(old.indexes || []));
        for (const key of (def.keys || [])) {
            if (key.primary || key.name === "PRIMARY" || oldNames.has(key.name)) continue;
            sql.push(`ALTER TABLE ${q(table)} ADD ${indexClause(key)};`);
        }
        if (!def.keys) {
            // Older schema files list index names only. Where the name is made of real column names
            // (idx_guid, rowhash, guid_rulecode_blocked) the index is rebuilt from that; otherwise it is reported.
            for (const name of (def.indexes || [])) {
                if (name === "PRIMARY" || oldNames.has(name)) continue;

                const cols = inferKeyColumns(name, Object.keys(def.columns));
                if (cols) {
                    sql.push(`ALTER TABLE ${q(table)} ADD KEY ${q(name)} (${cols.map(q).join(",")});`);
                    inferred.push(`${table}.${name} -> (${cols.join(", ")})`);
                } else {
                    skipped.push(`${table}: index '${name}' is listed by name only in the schema file and its columns cannot be worked out; export the schema again (MIGRATION_MODE=EXPORT) from a database that has it`);
                }
            }
        }
    }

    return { sql, skipped, inferred };
}

// Runs statements one by one and says exactly which one failed. DDL commits implicitly, so earlier statements
// stay applied; the result reports how many that was.
async function runStatements(conn, queries) {
    const warnings = [];

    for (let i = 0; i < queries.length; i++) {
        try {
            await conn.query(queries[i]);
        } catch (err) {
            // Adding a secondary index is an optimisation: a key that is too long, a duplicate name or a unique key
            // over existing duplicates must not stop the rest of the migration from being applied
            if (/^ALTER TABLE `[^`]+` ADD (UNIQUE |FULLTEXT |SPATIAL )?KEY\b/i.test(queries[i])) {
                warnings.push(`Index not created: ${err.message} :: ${queries[i].substring(0, 200)}`);
                continue;
            }
            return { success: false, executed: i, warnings, message: `Statement ${i + 1} of ${queries.length} failed (${i} applied): ${err.message} :: ${queries[i].substring(0, 300)}` };
        }
    }
    return { success: true, executed: queries.length, warnings };
}

//Safe SQL Splitter (Handles --, #, /* */, and ;)
function splitSQLStatements(sql) {
  const statements = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];

    // Line comment (-- or #)
    if (!inSingleQuote && !inDoubleQuote && !inBlockComment) {
      if ((char === "-" && next === "-") || char === "#") {
        inLineComment = true;
      }
    }

    if (inLineComment && char === "\n") {
      inLineComment = false;
    }

    // Block comment (/* */)
    if (!inSingleQuote && !inDoubleQuote && !inLineComment) {
      if (char === "/" && next === "*") {
        inBlockComment = true;
      }
    }

    if (inBlockComment && char === "*" && next === "/") {
      inBlockComment = false;
      i++; // skip /
      continue;
    }

    // Track string literals
    if (!inLineComment && !inBlockComment) {
      if (char === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote;
      if (char === `"` && !inSingleQuote) inDoubleQuote = !inDoubleQuote;
    }

    // Real statement delimiter
    if (
      char === ";" &&
      !inSingleQuote &&
      !inDoubleQuote &&
      !inLineComment &&
      !inBlockComment
    ) {
      if (current.trim()) {
        statements.push(current.trim());
      }
      current = "";
      continue;
    }

    if (!inLineComment && !inBlockComment) {
      current += char;
    }
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

// Pure functions, exposed so the diff/DDL logic can be tested without a database
module.exports.__test = { diffSchemas, buildCreateTableSQL, inferKeyColumns, splitSQLStatements, buildKeys };
