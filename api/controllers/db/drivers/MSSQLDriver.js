//MSSQL driver. Implements the same method contract as MySQLDriver/PgSQLDriver
//but builds T-SQL (@p0,@p1.. named params, TOP 1 instead of LIMIT 1, OUTPUT
//INSERTED.id instead of insertId/RETURNING). Assumes the standard "id"
//primary key convention already used across this codebase's tables (see
//db_findOne's default orderBy and checkHook()).
//
//NOTE: written and code-reviewed against the `mssql` package's documented
//API, but not exercised against a live SQL Server instance - there was none
//available to test against when this was built. Treat it as unverified
//until it's been run against a real server at least once.

const mssql = require("mssql");

const DBDriver = require("../DBDriver");

class MSSQLDriver extends DBDriver {

	DRIVER_NAME = "MSSQL";

	connect() {
		const conf = this.DBPROPS;

		this.DBCON = new mssql.ConnectionPool({
			server: conf.host,
			port: conf.port,
			user: conf.user,
			password: conf.password,
			database: conf.database,
			pool: {
				max: conf.connectionLimit || conf.max || 10,
			},
			options: {
				trustServerCertificate: conf.trustServerCertificate !== false,
				encrypt: conf.encrypt === true,
			},
		});

		this.DBCON.on("error", (err) => {
			console.log("\x1b[31m%s\x1b[0m", `MSSQL Pool Error - ${this.DBKEY}: ${err.message}`);
		});

		//mssql's pool must finish connect() before request() will work - unlike
		//mysql2/pg it does not queue commands issued before that. Every query
		//method below awaits this same promise first, so callers never have to
		//care about the timing.
		this.readyPromise = this.DBCON.connect()
			.then(() => {
				console.log("\x1b[36m%s\x1b[0m", "MSSQL Initialized - " + this.DBKEY);
				return true;
			})
			.catch((err) => {
				console.log("\x1b[31m%s\x1b[0m", `MSSQL Connection Failed - ${this.DBKEY}: ${err.message}`);
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
		await this.DBCON.close();
		return true;
	}

	getRawConnection() {
		return this.DBCON;
	}

	async rawQuery(sql, params, table) {
		try {
			//db_query's sql text is written the MySQL way ("?" positional
			//placeholders) - translate to @p0.. before binding.
			let i = 0;
			sql = sql.replace(/\?/g, () => `@p${i++}`);

			const pool = await this._ready();
			const request = pool.request();
			bindPositional(request, params);
			const result = await request.query(sql);
			return { rows: result.recordset || [] };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async findOne(table, columns, where, orderBy) {
		if (!columns) columns = "*";
		else if (Array.isArray(columns)) columns = columns.join(",");

		var sql = "SELECT TOP 1 " + columns + " FROM " + table + " ";

		const params = [];
		const sqlWhere = buildWhereClauses(where, params);

		if (sqlWhere.length > 0) {
			sql += " WHERE " + sqlWhere.join(" AND ");
		}

		if (orderBy != null && orderBy.length > 0) {
			sql += " ORDER BY " + orderBy;
		}

		try {
			sql = await DATAMODELS.processQuery(table, sql);
		} catch(err) {}

		if (CONFIG.log_sql) {
			console.log("SQL", sql, params);
		}

		try {
			const pool = await this._ready();
			const request = pool.request();
			bindNamed(request, params);
			const result = await request.query(sql);
			return { rows: result.recordset || [] };
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

		const params = [];
		if (where != null) {
			const sqlWhere = buildWhereClauses(where, params);
			if (sqlWhere.length > 0) {
				sql += " WHERE " + sqlWhere.join(" AND ");
			}
		}

		//additionalQueryParams may still contain "?" placeholders written the
		//MySQL way - translate them into the next named params.
		const positionalStart = params.length;
		if (additionalQueryParams != null && additionalQueryParams.length > 0) {
			let i = positionalStart;
			additionalQueryParams = additionalQueryParams.replace(/\?/g, () => `@p${i++}`);
			sql += " " + additionalQueryParams;
		}

		try {
			sql = await DATAMODELS.processQuery(table, sql);
		} catch(err) {}

		if (CONFIG.log_sql && table.indexOf("lgks_") < 0) {
			console.log("SQL", sql, whereParams);
		}

		try {
			const pool = await this._ready();
			const request = pool.request();
			bindNamed(request, params);
			(whereParams || []).forEach((v, i) => request.input(`p${positionalStart + i}`, v));
			const result = await request.query(sql);
			return { rows: result.recordset || [] };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async insertOne(table, data) {
		const cols = Object.keys(data);
		const vals = Object.values(data);
		const placeholders = cols.map((_, i) => `@p${i}`);

		const sql = "INSERT INTO " + table + " (" + cols.join(",") + ") OUTPUT INSERTED.id VALUES (" + placeholders.join(",") + ")";

		if (CONFIG.log_sql) {
			console.log("SQL", sql, vals);
		}

		try {
			const pool = await this._ready();
			const request = pool.request();
			bindNamed(request, vals);
			const result = await request.query(sql);
			return { insertId: result.recordset && result.recordset[0] ? result.recordset[0].id : null };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async insertBatch(table, dataArr) {
		const cols = Object.keys(dataArr[0]);
		const params = [];
		const rowsSql = dataArr.map((obj) => {
			const placeholders = cols.map((key) => {
				params.push(obj[key]);
				return `@p${params.length - 1}`;
			});
			return "(" + placeholders.join(",") + ")";
		});

		const sql = "INSERT INTO " + table + " (" + cols.join(",") + ") OUTPUT INSERTED.id VALUES " + rowsSql.join(",");

		if (CONFIG.log_sql) {
			console.log("SQL", sql, dataArr);
		}

		try {
			const pool = await this._ready();
			const request = pool.request();
			bindNamed(request, params);
			const result = await request.query(sql);
			const rows = result.recordset || [];
			return {
				raw: {
					affectedRows: rows.length,
					insertId: rows[0] ? rows[0].id : null,
					insertIds: rows.map((r) => r.id),
				},
			};
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async update(table, data, where) {
		const params = [];
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

			const setClauses = colKeys.map((col) => {
				params.push(data[col]);
				return `${col}=@p${params.length - 1}`;
			});
			sql += setClauses.join(",");
		}

		const sqlWhere = buildWhereClauses(where, params);
		sql += " WHERE " + sqlWhere.join(" AND ");

		if (CONFIG.log_sql) {
			console.log("SQL", sql, params);
		}

		try {
			const pool = await this._ready();
			const request = pool.request();
			bindNamed(request, params);
			const result = await request.query(sql);
			return { raw: { affectedRows: result.rowsAffected ? result.rowsAffected[0] : 0 }, where: sqlWhere };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async delete(table, where) {
		const params = [];
		const sqlWhere = buildWhereClauses(where, params);

		const sql = "DELETE FROM " + table + " WHERE " + sqlWhere.join(" AND ");

		if (CONFIG.log_sql) {
			console.log("SQL", sql, params);
		}

		try {
			const pool = await this._ready();
			const request = pool.request();
			bindNamed(request, params);
			const result = await request.query(sql);
			return { raw: { affectedRows: result.rowsAffected ? result.rowsAffected[0] : 0 }, where: sqlWhere };
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

//Builds "col = @pN" / "col OP @pN" / "col OP (...)" / RAW clauses, pushing
//values onto `params` in the same left-to-right order they're referenced -
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
						params.push(v);
						return `@p${params.length - 1}`;
					});
					clauses.push(`${b} ${a[1]} (${placeholders.join(",")})`);
				} else {
					params.push(a[0]);
					clauses.push(`${b} ${a[1]} @p${params.length - 1}`);
				}
			} else {
				params.push(a);
				clauses.push(`${b} = @p${params.length - 1}`);
			}
		});
	} else {
		clauses.push(where);
	}

	return clauses;
}

function bindNamed(request, values) {
	values.forEach((v, i) => request.input(`p${i}`, v));
}

//rawQuery's params are positional (matching db_query's mysql-style ? / driver
//passthrough contract) - bind them the same way findOne/select do.
function bindPositional(request, values) {
	(values || []).forEach((v, i) => request.input(`p${i}`, v));
}

function normalizeError(err) {
	return { code: err.code || err.number, sqlMessage: err.message };
}

module.exports = MSSQLDriver;
