"use strict";

// DBMIGRATOR diff / DDL generation. These are pure functions over schema objects, so no database is needed.
// The shipped schema files are used as realistic input.

global.printObj = global.printObj || (() => {});
const { diffSchemas, buildCreateTableSQL, inferKeyColumns, splitSQLStatements, buildKeys } = require("../../api/helpers/dbMigrator").__test;

const col = (type, extra = {}) => ({ type, nullable: false, default: null, primary: false, ...extra });

// What an older migrator produced: right columns, but no primary key, no auto-increment, no indexes
const damaged = (schema) => Object.fromEntries(Object.entries(schema).map(([t, def]) => [t, {
	columns: Object.fromEntries(Object.entries(def.columns).map(([c, d]) => [c, { ...d, primary: false, extra: "" }])),
	indexes: [],
	keys: []
}]));

describe("CREATE TABLE generation", () => {
	const legacy = {
		columns: {
			id: col("int", { primary: true }),
			guid: col("varchar(155)", { nullable: true, default: "global" }),
			blocked: col("enum('false','true')", { default: "false" }),
			created_on: col("datetime", { default: "CURRENT_TIMESTAMP" }),
			note: col("text", { nullable: true })
		},
		indexes: ["PRIMARY", "idx_guid"]
	};

	test("emits a primary key and AUTO_INCREMENT for a legacy single `id` key", () => {
		const sql = buildCreateTableSQL("sys_x", legacy);
		expect(sql).toContain("`id` int NOT NULL AUTO_INCREMENT");
		expect(sql).toContain("PRIMARY KEY (`id`)");
	});

	test("defaults: literals are quoted, functions are not, TEXT gets none", () => {
		const sql = buildCreateTableSQL("sys_x", legacy);
		expect(sql).toContain("`guid` varchar(155) NULL DEFAULT 'global'");
		expect(sql).toContain("`created_on` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP");
		expect(sql).toContain("`note` text NULL,");
		expect(sql).not.toMatch(/text NULL DEFAULT/);
	});

	test("a quote in a default value is escaped", () => {
		const sql = buildCreateTableSQL("t", { columns: { a: col("varchar(5)", { default: "it's" }) } });
		expect(sql).toContain("DEFAULT 'it''s'");
	});

	test("recorded `extra` wins over the legacy heuristic", () => {
		const sql = buildCreateTableSQL("t", { columns: { id: col("int", { primary: true, extra: "" }) } });
		expect(sql).not.toContain("AUTO_INCREMENT");
	});

	test("secondary keys from `keys` are written inline, with prefix lengths", () => {
		const sql = buildCreateTableSQL("t", {
			columns: { id: col("int", { primary: true }), a: col("varchar(200)"), b: col("int") },
			keys: [
				{ name: "PRIMARY", primary: true, columns: ["id"] },
				{ name: "idx_a", columns: ["a", "b"], lengths: { a: 20 } },
				{ name: "uq_b", unique: true, columns: ["b"] },
				{ name: "ft_a", type: "FULLTEXT", columns: ["a"] }
			]
		});
		expect(sql).toContain("KEY `idx_a` (`a`(20),`b`)");
		expect(sql).toContain("UNIQUE KEY `uq_b` (`b`)");
		expect(sql).toContain("FULLTEXT KEY `ft_a` (`a`)");
	});

	test("composite primary keys keep their column order", () => {
		const sql = buildCreateTableSQL("t", { columns: { id: col("int", { primary: true }), created_on: col("datetime", { primary: true }) } });
		expect(sql).toContain("PRIMARY KEY (`id`,`created_on`)");
		expect(sql).not.toContain("AUTO_INCREMENT"); // not a single-column key, so the heuristic does not apply
	});
});

describe("diffSchemas", () => {
	const wanted = {
		sys_x: {
			columns: { id: col("int", { primary: true }), guid: col("varchar(155)", { nullable: true }) },
			keys: [{ name: "PRIMARY", primary: true, columns: ["id"] }, { name: "idx_guid", columns: ["guid"] }]
		}
	};

	test("creates tables that do not exist", () => {
		const { sql } = diffSchemas({}, wanted);
		expect(sql).toHaveLength(1);
		expect(sql[0]).toMatch(/^CREATE TABLE IF NOT EXISTS `sys_x`/);
	});

	test("repairs a table created without its primary key and auto-increment", () => {
		const { sql } = diffSchemas(damaged(wanted), wanted);
		expect(sql).toContain("ALTER TABLE `sys_x` ADD PRIMARY KEY (`id`), MODIFY COLUMN `id` int NOT NULL AUTO_INCREMENT;");
	});

	test("adds a missing index from `keys`", () => {
		const { sql } = diffSchemas(damaged(wanted), wanted);
		expect(sql).toContain("ALTER TABLE `sys_x` ADD KEY `idx_guid` (`guid`);");
	});

	test("a healthy database needs no statements", () => {
		const healthy = {
			sys_x: {
				columns: { id: col("int(11)", { primary: true, extra: "auto_increment" }), guid: col("varchar(155)", { nullable: true, extra: "" }) },
				keys: wanted.sys_x.keys,
				indexes: ["PRIMARY", "idx_guid"]
			}
		};
		const result = diffSchemas(healthy, wanted);
		expect(result.sql).toEqual([]);
		expect(result.skipped).toEqual([]); // int(11) vs int is not a difference
	});

	test("adds a missing column in position, and never drops anything", () => {
		const old = { sys_x: { columns: { id: col("int", { primary: true, extra: "auto_increment" }), legacy: col("int") }, keys: [{ name: "PRIMARY", primary: true, columns: ["id"] }], indexes: ["PRIMARY"] } };
		const newer = { sys_x: { columns: { id: col("int", { primary: true }), added: col("varchar(5)", { nullable: true }) }, keys: [{ name: "PRIMARY", primary: true, columns: ["id"] }] } };
		const { sql } = diffSchemas(old, newer);
		expect(sql).toEqual(["ALTER TABLE `sys_x` ADD COLUMN `added` varchar(5) NULL AFTER `id`;"]);
		expect(sql.join(" ")).not.toMatch(/DROP/i);
	});

	test("changes to existing columns are reported, not applied, unless allowed", () => {
		const old = { t: { columns: { a: col("varchar(155)") }, keys: [], indexes: [] } };
		const newer = { t: { columns: { a: col("varchar(200)") } } };

		const reported = diffSchemas(old, newer);
		expect(reported.sql).toEqual([]);
		expect(reported.skipped[0]).toMatch(/t\.a: type varchar\(155\) -> varchar\(200\)/);

		global.CONFIG = { ...(global.CONFIG || {}), migration: { allow_column_modify: true } };
		try {
			expect(diffSchemas(old, newer).sql).toEqual(["ALTER TABLE `t` MODIFY COLUMN `a` varchar(200) NOT NULL;"]);
		} finally {
			delete global.CONFIG.migration;
		}
	});

	test("a different existing primary key is reported, not changed", () => {
		const old = { t: { columns: { a: col("int", { primary: true }), b: col("int") }, keys: [], indexes: [] } };
		const newer = { t: { columns: { a: col("int"), b: col("int", { primary: true }) } } };
		const { sql, skipped } = diffSchemas(old, newer);
		expect(sql.join(" ")).not.toMatch(/PRIMARY KEY/);
		expect(skipped.join(" ")).toMatch(/primary key/);
	});

	test("legacy index names are rebuilt from column names, and the rest are reported", () => {
		const old = { t: { columns: { id: col("int", { primary: true, extra: "auto_increment" }), sessId: col("varchar(9)"), guid: col("varchar(9)") }, keys: [{ name: "PRIMARY", primary: true, columns: ["id"] }], indexes: ["PRIMARY"] } };
		const newer = { t: { columns: old.t.columns, indexes: ["PRIMARY", "idx_sessid", "guid_sessId", "idx_something_else"] } };
		const { sql, inferred, skipped } = diffSchemas(old, newer);
		expect(sql).toContain("ALTER TABLE `t` ADD KEY `idx_sessid` (`sessId`);");
		expect(sql).toContain("ALTER TABLE `t` ADD KEY `guid_sessId` (`guid`,`sessId`);");
		expect(inferred).toHaveLength(2);
		expect(skipped).toHaveLength(1);
		expect(skipped[0]).toMatch(/idx_something_else/);
	});

	test("compares against what is passed in, not a fixed database", () => {
		// the second argument is the file; the first is the *target's* live schema - a table present there is not recreated
		const live = { sys_x: wanted.sys_x };
		expect(diffSchemas(live, wanted).sql.filter(s => s.startsWith("CREATE"))).toEqual([]);
	});
});

describe("against the shipped schema files", () => {
	test.each(["appdb_100", "logdb_100"])("%s: every table can be created and a damaged DB is fully repaired", (name) => {
		const schema = require(`../../misc/dbschema/schema_${name}.json`);

		const created = diffSchemas({}, schema);
		expect(created.sql).toHaveLength(Object.keys(schema).length);
		created.sql.forEach((stmt) => expect(stmt).toMatch(/PRIMARY KEY/));

		const repaired = diffSchemas(damaged(schema), schema);
		expect(repaired.sql.filter(s => /ADD PRIMARY KEY/.test(s))).toHaveLength(Object.keys(schema).length);
		expect(repaired.sql.join("\n")).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bDELETE\b/i);

		// the generated script survives the statement splitter intact
		expect(splitSQLStatements(created.sql.join("\n"))).toHaveLength(created.sql.length);
	});
});

describe("inferKeyColumns / buildKeys / splitSQLStatements", () => {
	test("inferKeyColumns", () => {
		const cols = ["id", "guid", "rulecode", "is_published", "blocked", "sessId"];
		expect(inferKeyColumns("guid", cols)).toEqual(["guid"]);
		expect(inferKeyColumns("idx_guid", cols)).toEqual(["guid"]);
		expect(inferKeyColumns("idx_sessid", cols)).toEqual(["sessId"]);
		expect(inferKeyColumns("guid_rulecode_is_published_blocked", cols)).toEqual(["guid", "rulecode", "is_published", "blocked"]);
		expect(inferKeyColumns("idx_log_job_status", cols)).toBeNull();
	});

	test("buildKeys groups SHOW INDEX rows into ordered keys", () => {
		const keys = buildKeys([
			{ Key_name: "uq", Non_unique: 0, Seq_in_index: 2, Column_name: "b", Index_type: "BTREE" },
			{ Key_name: "uq", Non_unique: 0, Seq_in_index: 1, Column_name: "a", Index_type: "BTREE", Sub_part: 10 },
			{ Key_name: "PRIMARY", Non_unique: 0, Seq_in_index: 1, Column_name: "id", Index_type: "BTREE" },
			{ Key_name: "fn", Non_unique: 1, Seq_in_index: 1, Column_name: null, Index_type: "BTREE" }
		]);
		expect(keys.find(k => k.name === "uq")).toMatchObject({ unique: true, columns: ["a", "b"], lengths: { a: 10 } });
		expect(keys.find(k => k.name === "PRIMARY").primary).toBe(true);
		expect(keys.find(k => k.name === "fn")).toBeUndefined(); // functional indexes cannot be described
	});

	test("splitSQLStatements ignores semicolons inside strings and comments", () => {
		const parts = splitSQLStatements("A 'x;y';\n-- c;d\nB; /* e;f */ C;");
		expect(parts).toEqual(["A 'x;y'", "B", "C"]);
	});
});
