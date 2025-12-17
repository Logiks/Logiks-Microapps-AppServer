//Controller for For database migration

const fs1 = require("fs-extra");
const diff = require("deep-diff").diff;

const SCHEMA_DIR = "misc/dbschema/";//path.join(__dirname, "../schema_versions");
fs1.ensureDirSync(SCHEMA_DIR);

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
                printObj(`DB Difference Found with ${schemaData.statements} changes`, "yellow", 2);

                var result = await DBMIGRATOR.applyMigrationSchema(dbkey, schemaData.schema);

                printObj(`Migration Completed for ${dbkey} with status - ${result.success}`, "yellow", 2);

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
    exportSchema : async function(dbKey, writeFile = true) {
        try {
            const mysqlConnection = _DB.db_connection(dbKey).promise();

            const schema = {};
            const [tables] = await mysqlConnection.query(`SHOW TABLES`);

            for (const t of tables) {
                const table = Object.values(t)[0];
                
                if(["z", "y", "x", "backup", "temp"].indexOf(table.toLowerCase().split("_")[0])>=0) continue;

                const [columns] = await mysqlConnection.query(`DESCRIBE ${table}`);
                const [indexes] = await mysqlConnection.query(`SHOW INDEX FROM ${table}`);

                schema[table] = {
                    columns: {},
                    indexes: [...new Set(indexes.map(i => i.Key_name))]
                };

                columns.forEach(col => {
                    schema[table].columns[col.Field] = {
                        type: col.Type,
                        nullable: col.Null === "YES",
                        default: col.Default,
                        primary: col.Key === "PRI"
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
    generateMigration : async function(dbKey, newSchemaFile, writeFile = false) {//, oldSchemaFile
        try {
            //const mysqlConnection = _DB.db_connection(dbKey).promise();

            //const oldSchema = await fs1.readJson(path.join(SCHEMA_DIR, oldSchemaFile));
            const oldSchema = await DBMIGRATOR.exportSchema("appdb", false);
            const newSchema = await fs1.readJson(path.join(SCHEMA_DIR, newSchemaFile));

            const changes = diff(oldSchema, newSchema);
            if (!changes) return { success: true, message: "No schema changes found.", statements: 0 };

            const sql = [];

            for (const change of changes) {
                const [table, , column] = change.path || [];

                // New table added
                if (change.kind === "N" && change.path.length === 1) {
                    sql.push(buildCreateTableSQL(table, change.rhs));
                }

                // New column added
                if (change.kind === "N" && change.path.includes("columns")) {
                const col = change.rhs;
                sql.push(`ALTER TABLE ${table} ADD COLUMN ${column} ${col.type} ${col.nullable ? "" : "NOT NULL"} ${col.default !== null ? `DEFAULT "${col.default}"` : ""};`);
                }
            }
            if(writeFile) {
                const filename = `migration_${CONFIG.BUILD}.sql`;//${Date.now()}
                const filepath = path.join(SCHEMA_DIR, filename);
                await fs1.writeFile(filepath, sql.join("\n"));

                return { success: true, file: filename, statements: sql.length };
            } else {
                return { success: true, schema: sql.join("\n"), statements: sql.length };
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
            const mysqlConnection = _DB.db_connection(dbKey).promise();

            const sql = await fs1.readFile(path.join(SCHEMA_DIR, filename), "utf8");

            // Safety checks
            if (/DROP|TRUNCATE|DELETE/i.test(sql)) {
                return res.status(400).json({ error: "Destructive SQL detected — aborted" });
            }

            const queries = splitSQLStatements(sql);

            const conn = await mysqlConnection.getConnection();

            //await conn.query(sql);
            for (const query of queries) {
                await conn.query(query);
            }
            
            conn.release();

            return { success: true, file: filename };
        } catch (err) {
            console.error(err);
            return { success: false, message: err.message };
        }
    },

    applyMigrationSchema : async function(dbKey, sql) {
        try {
            const mysqlConnection = _DB.db_connection(dbKey).promise();

            // Safety checks
            if (/DROP|TRUNCATE|DELETE/i.test(sql)) {
                return res.status(400).json({ error: "Destructive SQL detected — aborted" });
            }

            const queries = splitSQLStatements(sql);

            const conn = await mysqlConnection.getConnection();
            
            //await conn.query(sql);
            for (const query of queries) {
                await conn.query(query);
            }

            conn.release();

            return { success: true, statements: sql.split(";\n").length };
        } catch (err) {
            console.error(err);
            printObj("Probably the ", "red");
            return { success: false, message: err.message };
        }
    }
}

/* ------------------------------------------
HELPERS
------------------------------------------ */
function buildCreateTableSQL(table, def) {
    const cols = Object.entries(def.columns).map(([name, d]) => {
        return `${name} ${d.type} ${d.nullable ? "" : "NOT NULL"}`;
    });

    return `CREATE TABLE IF NOT EXISTS ${table} (${cols.join(",")});`;
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