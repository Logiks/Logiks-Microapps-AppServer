//DuckDB driver - embedded, in-process analytical SQL engine (no network
//connection; a local file path or ":memory:"). Builds Postgres-flavoured SQL
//using named $p0,$p1.. parameters (DuckDB's positional "?" placeholders
//aren't exposed by the current promise API - named params with
//automatic type inference are).
//
//IMPORTANT - DuckDB is single-writer, in-process: it is not a shared
//network server like the other drivers. Two processes (eg. two instances of
//a clustered deployment) must not point the same dbkey at the same file
//path for concurrent writes - that's a DuckDB file-locking conflict, not
//something this driver can paper over. Good fits here: a process-local
//analytics/cache/scratch database, or a single-writer service.
//
//DuckDB has no built-in auto-increment we rely on - like MongoDBDriver, ids
//come from a driver-managed `_counters` table (one row per logical table),
//incremented atomically via INSERT..ON CONFLICT DO UPDATE..RETURNING, so the
//existing "id" PK convention (db_findOne's default orderBy, checkHook({id}))
//keeps working unchanged.

const { DuckDBInstance } = require("@duckdb/node-api");

const DBDriver = require("../DBDriver");

class DuckDBDriver extends DBDriver {

	DRIVER_NAME = "DUCKDB";

	connect() {
		const conf = this.DBPROPS;
		const path = conf.path || conf.database || ":memory:";

		this.readyPromise = DuckDBInstance.create(path)
			.then((instance) => instance.connect())
			.then(async (connection) => {
				this.DBCON = connection;
				await connection.run("CREATE TABLE IF NOT EXISTS _counters (table_name VARCHAR PRIMARY KEY, seq INTEGER)");
				console.log("\x1b[36m%s\x1b[0m", "DUCKDB Initialized - " + this.DBKEY);
				return true;
			})
			.catch((err) => {
				console.log("\x1b[31m%s\x1b[0m", `DUCKDB Connection Failed - ${this.DBKEY}: ${err.message}`);
				return false;
			});

		return true;
	}

	async _ready() {
		if (this.readyPromise) await this.readyPromise;
		return this.DBCON;
	}

	async disconnect() {
		if (!this.DBCON) return true;
		this.DBCON.closeSync();
		return true;
	}

	getRawConnection() {
		return this.DBCON;
	}

	async _nextId(table) {
		const con = await this._ready();
		const reader = await con.runAndReadAll(
			`INSERT INTO _counters (table_name, seq) VALUES ($p0, 1)
			 ON CONFLICT (table_name) DO UPDATE SET seq = _counters.seq + 1
			 RETURNING seq`,
			{ p0: table }
		);
		return reader.getRowObjects()[0].seq;
	}

	async rawQuery(sql, params, table) {
		try {
			//db_query's sql text is written the MySQL way ("?" positional
			//placeholders) - translate to named $p0.. before binding.
			let i = 0;
			sql = sql.replace(/\?/g, () => `$p${i++}`);
			const paramsObj = toParamsObject(params);

			const con = await this._ready();
			const reader = await con.runAndReadAll(sql, paramsObj);
			return { rows: reader.getRowObjects() };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async findOne(table, columns, where, orderBy) {
		if (!columns) columns = "*";
		else if (Array.isArray(columns)) columns = columns.join(",");

		var sql = "SELECT " + columns + " FROM " + table + " ";

		const params = {};
		const sqlWhere = buildWhereClauses(where, params);

		if (sqlWhere.length > 0) {
			sql += " WHERE " + sqlWhere.join(" AND ");
		}

		if (orderBy != null && orderBy.length > 0) {
			sql += " ORDER BY " + orderBy;
		}

		sql += " LIMIT 1 ";

		try {
			sql = await DATAMODELS.processQuery(table, sql);
		} catch(err) {}

		if (CONFIG.log_sql) {
			console.log("SQL", sql, params);
		}

		try {
			const con = await this._ready();
			const reader = await con.runAndReadAll(sql, params);
			return { rows: reader.getRowObjects() };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async select(table, columns, where, whereParams, additionalQueryParams, joins) {
		if (!columns) columns = "*";

		var columnsStr = columns;
		if (Array.isArray(columnsStr)) columnsStr = columnsStr.join(",");

		var sql = "SELECT " + columnsStr + " FROM " + table + " ";

		sql += this.buildJoinClause(joins);

		const params = {};
		if (where != null) {
			const sqlWhere = buildWhereClauses(where, params);
			if (sqlWhere.length > 0) {
				sql += " WHERE " + sqlWhere.join(" AND ");
			}
		}

		if (additionalQueryParams != null && additionalQueryParams.length > 0) {
			//additionalQueryParams may still contain "?" placeholders written the
			//MySQL way - translate them into the next named params.
			let i = Object.keys(params).length;
			additionalQueryParams = additionalQueryParams.replace(/\?/g, () => `$p${i++}`);
			sql += " " + additionalQueryParams;
		}

		try {
			sql = await DATAMODELS.processQuery(table, sql);
		} catch(err) {}

		if (CONFIG.log_sql && table.indexOf("lgks_") < 0) {
			console.log("SQL", sql, whereParams);
		}

		try {
			const startIdx = Object.keys(params).length;
			(whereParams || []).forEach((v, i) => { params[`p${startIdx + i}`] = v; });

			const con = await this._ready();
			const reader = await con.runAndReadAll(sql, params);
			return { rows: reader.getRowObjects() };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async insertOne(table, data) {
		try {
			const id = await this._nextId(table);
			const finalData = Object.assign({}, data, { id });

			const cols = Object.keys(finalData);
			const params = {};
			const placeholders = cols.map((col, i) => {
				params[`p${i}`] = finalData[col];
				return `$p${i}`;
			});

			const sql = "INSERT INTO " + table + " (" + cols.join(",") + ") VALUES (" + placeholders.join(",") + ")";

			if (CONFIG.log_sql) {
				console.log("SQL", sql, params);
			}

			const con = await this._ready();
			await con.runAndReadAll(sql, params);
			return { insertId: id };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async insertBatch(table, dataArr) {
		try {
			const cols = Object.keys(dataArr[0]);
			const ids = [];
			const params = {};
			let i = 0;

			const rowsSql = [];
			for (const obj of dataArr) {
				const id = await this._nextId(table);
				ids.push(id);

				const placeholders = cols.map((col) => {
					params[`p${i}`] = obj[col];
					return `$p${i++}`;
				});
				params[`p${i}`] = id;
				placeholders.push(`$p${i}`);
				i++;

				rowsSql.push("(" + placeholders.join(",") + ")");
			}

			const sql = "INSERT INTO " + table + " (" + cols.concat(["id"]).join(",") + ") VALUES " + rowsSql.join(",");

			if (CONFIG.log_sql) {
				console.log("SQL", sql, params);
			}

			const con = await this._ready();
			await con.runAndReadAll(sql, params);

			return {
				raw: {
					affectedRows: dataArr.length,
					insertId: ids[0],
					insertIds: ids,
				},
			};
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async update(table, data, where) {
		const params = {};
		var sql = "UPDATE " + table + " SET ";

		if (typeof data == "string") {
			if (data.length <= 0) {
				return { error: { code: "DATA_NOT_FOUND", sqlMessage: "Columns to update not found" } };
			}
			sql += data;
		} else {
			const colKeys = Object.keys(data);
			if (colKeys.length <= 0) {
				return { error: { code: "DATA_NOT_FOUND", sqlMessage: "Columns to update not found" } };
			}

			const setClauses = colKeys.map((col, i) => {
				params[`p${i}`] = data[col];
				return `${col}=$p${i}`;
			});
			sql += setClauses.join(",");
		}

		const sqlWhere = buildWhereClauses(where, params);
		sql += " WHERE " + sqlWhere.join(" AND ");

		if (CONFIG.log_sql) {
			console.log("SQL", sql, params);
		}

		try {
			const con = await this._ready();
			const reader = await con.runAndReadAll(sql, params);
			return { raw: { affectedRows: rowsChanged(reader) }, where: sqlWhere };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async delete(table, where) {
		const params = {};
		const sqlWhere = buildWhereClauses(where, params);

		const sql = "DELETE FROM " + table + " WHERE " + sqlWhere.join(" AND ");

		if (CONFIG.log_sql) {
			console.log("SQL", sql, params);
		}

		try {
			const con = await this._ready();
			const reader = await con.runAndReadAll(sql, params);
			return { raw: { affectedRows: rowsChanged(reader) }, where: sqlWhere };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	escape(value) {
		if (value === null || value === undefined) return "NULL";
		if (typeof value === "number" || typeof value === "boolean") return String(value);
		return "'" + String(value).replace(/'/g, "''") + "'";
	}
}

//Builds "col = $pN" / "col OP $pN" / "col OP (...)" / RAW clauses, keying
//values into `params` by the same $pN name referenced in the clause -
//mirrors the where-object contract the other drivers already use.
function buildWhereClauses(where, params) {
	const clauses = [];

	if (where == null) return clauses;

	if (typeof where == "object" && !Array.isArray(where)) {
		_.each(where, function(a, b) {
			if (a == "RAW") {
				clauses.push(b);
			} else if (Array.isArray(a) && a.length == 2) {
				if (Array.isArray(a[0])) {
					const placeholders = a[0].map((v) => {
						const key = `p${Object.keys(params).length}`;
						params[key] = v;
						return `$${key}`;
					});
					clauses.push(`${b} ${a[1]} (${placeholders.join(",")})`);
				} else {
					const key = `p${Object.keys(params).length}`;
					params[key] = a[0];
					clauses.push(`${b} ${a[1]} $${key}`);
				}
			} else {
				const key = `p${Object.keys(params).length}`;
				params[key] = a;
				clauses.push(`${b} = $${key}`);
			}
		});
	} else {
		clauses.push(where);
	}

	return clauses;
}

function toParamsObject(paramsArr) {
	const obj = {};
	(paramsArr || []).forEach((v, i) => { obj[`p${i}`] = v; });
	return obj;
}

//run() doesn't surface an affected-row count directly - re-derive it from
//the reader's row count via runAndReadAll for callers that need it.
function rowsChanged(result) {
	try {
		const rows = result.getRowObjects ? result.getRowObjects() : [];
		if (rows[0] && rows[0]["Count"] !== undefined) return Number(rows[0]["Count"]);
	} catch (e) {}
	return 0;
}

function normalizeError(err) {
	return { code: err.code || "DUCKDB_ERROR", sqlMessage: err.message };
}

module.exports = DuckDBDriver;
