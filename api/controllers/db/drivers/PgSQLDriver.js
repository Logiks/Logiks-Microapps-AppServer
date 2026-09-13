//PostgreSQL driver. Implements the same method contract as MySQLDriver but
//builds Postgres-flavoured SQL ($1,$2.. placeholders, RETURNING id instead
//of insertId). Assumes the standard "id" primary key convention already
//used across this codebase's tables (see db_findOne's default orderBy and
//checkHook()).
//
//Also used as-is for CockroachDB (driver: "cockroachdb"/"crdb" in
//DBManager's DRIVER_MAP) - CockroachDB speaks the Postgres wire protocol and
//accepts the same SQL this driver generates (parameterized $N, multi-row
//INSERT, RETURNING id). Set conf.ssl:true for a secure cluster (eg. Cockroach
//Cloud); omit it for an insecure local/dev node.

const pg = require("pg");

const DBDriver = require("../DBDriver");

class PgSQLDriver extends DBDriver {

	DRIVER_NAME = "PGSQL";

	connect() {
		const conf = this.DBPROPS;

		this.DBCON = new pg.Pool({
			host: conf.host,
			port: conf.port,
			user: conf.user,
			password: conf.password,
			database: conf.database,
			max: conf.connectionLimit || conf.max || 10,
			ssl: conf.ssl === true ? { rejectUnauthorized: false } : (conf.ssl || undefined),
		});

		//Surface pool-level errors (eg. an idle client dropped by the server)
		//instead of letting them crash the process as an uncaughtException.
		this.DBCON.on("error", (err) => {
			console.log("\x1b[31m%s\x1b[0m", `PGSQL Pool Error - ${this.DBKEY}: ${err.message}`);
		});

		this.DBCON.connect((err, client, release) => {
			if (err) {
				console.log("\x1b[31m%s\x1b[0m", `PGSQL Connection Failed - ${this.DBKEY}: ${err.message}`);
				return;
			}
			release();
			console.log("\x1b[36m%s\x1b[0m", "PGSQL Initialized - " + this.DBKEY);
		});

		return true;
	}

	async disconnect() {
		if (!this.DBCON) return true;
		await this.DBCON.end();
		return true;
	}

	getRawConnection() {
		return this.DBCON;
	}

	async rawQuery(sql, params, table) {
		try {
			const result = await this.DBCON.query(sql, params && params.length > 0 ? params : undefined);
			return { rows: result.rows, fields: result.fields };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async findOne(table, columns, where, orderBy) {
		if (!columns) columns = "*";
		else if (Array.isArray(columns)) columns = columns.join(",");

		var sql = "SELECT " + columns + " FROM " + table + " ";

		const params = [];
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
			const result = await this.DBCON.query(sql, params);
			return { rows: result.rows };
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

		if (additionalQueryParams != null && additionalQueryParams.length > 0) {
			sql += " " + additionalQueryParams;
		}

		try {
			sql = await DATAMODELS.processQuery(table, sql);
		} catch(err) {}

		if (CONFIG.log_sql && table.indexOf("lgks_") < 0) {
			console.log("SQL", sql, whereParams);
		}

		try {
			//whereParams mirrors db_selectQ's caller-supplied positional params for
			//placeholders embedded in additionalQueryParams - append after the
			//where-clause params built above, matching the same left-to-right order.
			const finalParams = params.concat(whereParams || []);
			const result = await this.DBCON.query(reindexPlaceholders(sql, params.length), finalParams);
			return { rows: result.rows };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async insertOne(table, data) {
		const cols = Object.keys(data);
		const vals = Object.values(data);
		const placeholders = cols.map((_, i) => `$${i + 1}`);

		const sql = "INSERT INTO " + table + " (" + cols.join(",") + ") VALUES (" + placeholders.join(",") + ") RETURNING id";

		if (CONFIG.log_sql) {
			console.log("SQL", sql, vals);
		}

		try {
			const result = await this.DBCON.query(sql, vals);
			return { insertId: result.rows[0] ? result.rows[0].id : null };
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
				return `$${params.length}`;
			});
			return "(" + placeholders.join(",") + ")";
		});

		const sql = "INSERT INTO " + table + " (" + cols.join(",") + ") VALUES " + rowsSql.join(",") + " RETURNING id";

		if (CONFIG.log_sql) {
			console.log("SQL", sql, dataArr);
		}

		try {
			const result = await this.DBCON.query(sql, params);
			return {
				raw: {
					affectedRows: result.rowCount,
					insertId: result.rows[0] ? result.rows[0].id : null,
					insertIds: result.rows.map((r) => r.id),
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
				return `${col}=$${params.length}`;
			});
			sql += setClauses.join(",");
		}

		const sqlWhere = buildWhereClauses(where, params);
		sql += " WHERE " + sqlWhere.join(" AND ");

		if (CONFIG.log_sql) {
			console.log("SQL", sql, params);
		}

		try {
			const result = await this.DBCON.query(sql, params);
			return { raw: { affectedRows: result.rowCount }, where: sqlWhere };
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
			const result = await this.DBCON.query(sql, params);
			return { raw: { affectedRows: result.rowCount }, where: sqlWhere };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	escape(value) {
		if (value === null || value === undefined) return "NULL";
		if (typeof value === "number" || typeof value === "boolean") return String(value);
		return pg.escapeLiteral(String(value));
	}
}

//Builds "col = $n" / "col OP $n" / "col OP (...)" / RAW clauses, pushing
//values onto `params` in the same left-to-right order they're referenced -
//mirrors the where-object contract MySQLDriver/_db.js already use.
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
						return `$${params.length}`;
					});
					clauses.push(`${b} ${a[1]} (${placeholders.join(",")})`);
				} else {
					params.push(a[0]);
					clauses.push(`${b} ${a[1]} $${params.length}`);
				}
			} else {
				params.push(a);
				clauses.push(`${b} = $${params.length}`);
			}
		});
	} else {
		clauses.push(where);
	}

	return clauses;
}

//additionalQueryParams (caller-supplied SQL fragments) may still contain "?"
//placeholders written the MySQL way - translate them into the next $n slots
//after the where-clause params already assigned.
function reindexPlaceholders(sql, startCount) {
	let i = startCount;
	return sql.replace(/\?/g, () => `$${++i}`);
}

function normalizeError(err) {
	return { code: err.code, sqlMessage: err.message };
}

module.exports = PgSQLDriver;
