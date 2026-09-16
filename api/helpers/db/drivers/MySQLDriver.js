//MySQL driver - ported as-is from the pre-refactor api/helpers/_db.js.
//Builds/executes dialect SQL only; encryption, hooks and the
//{status,...} envelope are applied by _db.js so behaviour stays identical
//across engines.

const mysql = require("mysql2");

const DBDriver = require("../DBDriver");

//nestTables is only meant for the old "table1,table2" cross-join style -
//a derived-table expression ("(SELECT ...) AS alias") legitimately contains
//commas too, but at parenthesis depth > 0, and enabling nestTables for it
//would wrongly split aliased/computed columns into "alias.col"/".col" keys
//instead of the plain names the query actually asked for.
function hasTopLevelComma(str) {
	let depth = 0;
	for (let i = 0; i < str.length; i++) {
		const ch = str[i];
		if (ch === "(") depth++;
		else if (ch === ")") depth--;
		else if (ch === "," && depth === 0) return true;
	}
	return false;
}

class MySQLDriver extends DBDriver {

	DRIVER_NAME = "MYSQL";

	connect() {
		const conf = this.DBPROPS;

		//conf["nestTables"] = ".";//nestTables: true = for tree
		// conf["timezone"] = "-05:30";
		conf["dateStrings"] = true;

		conf["typeCast"] = function (field, next) {
			if (field.type === 'DATE') {
				const val = field.string();
				return (val === '0000-00-00' || val == null || val == "") ? null : new Date(val);
			}
			return next();
		}

		this.DBCON = mysql.createPool(conf);

		this.DBCON.getConnection((err, connection) => {
			if (err || connection == null) {
				console.log("\x1b[31m%s\x1b[0m", `MYSQL Connection Failed - ${this.DBKEY}: ${err && err.message}`);
				return;
			}
			connection.release();
			console.log("\x1b[36m%s\x1b[0m", "MYSQL Initialized - " + this.DBKEY);
		});

		return true;
	}

	async disconnect() {
		if (!this.DBCON) return true;
		return await new Promise((resolve) => {
			this.DBCON.end(function() { resolve(true); });
		});
	}

	getRawConnection() {
		return this.DBCON;
	}

	async rawQuery(sql, params, table) {
		if (table && table != "lgks_domains") sql = { sql: sql, nestTables: "." };

		return await new Promise((resolve) => {
			this.DBCON.query(sql, params, function(err, results, fields) {
				if (err) {
					resolve({ error: err });
					return;
				}

				const rows = new Array(results.length);
				for (let i = 0; i < results.length; i++) {
					rows[i] = { ...results[i] };
				}

				resolve({ rows: rows, fields: fields });
			});
		});
	}

	async findOne(table, columns, where, orderBy) {
		if (!columns) columns = "*";
		else if (Array.isArray(columns)) columns = columns.join(",");

		var sql = "SELECT " + columns + " FROM " + table + " ";

		var sqlWhere = [];
		if (typeof where == "object" && !Array.isArray(where)) {
			_.each(where, function(a, b) {
				if (a == "RAW") {
					sqlWhere.push(b);
				} else if (Array.isArray(a) && a.length == 2) {
					sqlWhere.push(b + a[1] + "'" + a[0] + "'");
				} else {
					sqlWhere.push(b + "='" + a + "'");
				}
			});
		} else {
			sqlWhere.push(where);
		}

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
			console.log("SQL", sql);
		}

		if (hasTopLevelComma(table) || table.toLowerCase().indexOf("join")>0) {
			sql = { sql: sql, nestTables: "." };
		}

		return await new Promise((resolve) => {
			this.DBCON.query(sql, function(err, results, fields) {
				if (err) {
					resolve({ error: err });
					return;
				}
				resolve({ rows: JSON.parse(JSON.stringify(results)) });
			});
		});
	}

	async select(table, columns, where, whereParams, additionalQueryParams, joins) {
		if (!columns) columns = "*";

		var columnsStr = columns;
		if (Array.isArray(columnsStr)) columnsStr = columnsStr.join(",");

		var sql = "SELECT " + columnsStr + " FROM " + table + " ";

		sql += this.buildJoinClause(joins);

		if (where != null) {
			var sqlWhere = [];
			if (typeof where == "object" && !Array.isArray(where)) {
				_.each(where, function(a, b) {
					if (a == "RAW") {
						sqlWhere.push(b);
					} else if (Array.isArray(a) && a.length == 2) {
						if (Array.isArray(a[0])) {
							sqlWhere.push(`${b} ${a[1]} (${a[0].map(a => `${this.escape(a)}`).join(",")})`);
						} else {
							a[0] = this.escape(a[0]);
							sqlWhere.push(`${b} ${a[1]} '${a[0]}'`);
						}
					} else {
						a = this.escape(a);
						sqlWhere.push(b + "=" + a + "");
					}
				}.bind(this));
			} else {
				sqlWhere.push(where);
			}

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

		if (hasTopLevelComma(table) || table.toLowerCase().indexOf("join")>0) {
			sql = { sql: sql, nestTables: "." };
		}

		return await new Promise((resolve) => {
			this.DBCON.query(sql, whereParams || [], function(err, results, fields) {
				if (err) {
					resolve({ error: err });
					return;
				}

				const rows = new Array(results.length);
				for (let i = 0; i < results.length; i++) {
					rows[i] = { ...results[i] };
				}

				resolve({ rows: rows });
			});
		});
	}

	async insertOne(table, data) {
		const cols = Object.keys(data);
		const vals = Object.values(data);
		const quest = cols.map(() => "?");

		const sql = "INSERT INTO " + table + " (" + cols.join(",") + ") VALUES (" + quest.join(",") + ")";

		if (CONFIG.log_sql) {
			console.log("SQL", sql, vals);
		}

		return await new Promise((resolve) => {
			this.DBCON.query(sql, vals, function(err, results) {
				if (err) {
					resolve({ error: err });
					return;
				}
				resolve({ insertId: results.insertId });
			});
		});
	}

	async insertBatch(table, dataArr) {
		const cols = Object.keys(dataArr[0]);
		const values = dataArr.map(obj => cols.map((key) => obj[key]));

		const sql = "INSERT INTO " + table + " (" + cols.join(",") + ") VALUES ?";

		if (CONFIG.log_sql) {
			console.log("SQL", sql, dataArr);
		}

		return await new Promise((resolve) => {
			this.DBCON.query(sql, [values], function(err, results) {
				if (err) {
					resolve({ error: err });
					return;
				}
				resolve({ raw: results });
			});
		});
	}

	async update(table, data, where) {
		var sql = "UPDATE ";

		var sqlWhere = [];
		if (typeof where == "object" && !Array.isArray(where)) {
			_.each(where, function(a, b) {
				if (a == "RAW") {
					sqlWhere.push(b);
				} else if (Array.isArray(a) && a.length == 2) {
					if (Array.isArray(a[0])) {
						sqlWhere.push(`${b} ${a[1]} (${a[0].map(a => `${this.escape(a)}`).join(",")})`);
					} else {
						a[0] = this.escape(a[0]);
						sqlWhere.push(`${b} ${a[1]} ${a[0]}`);
					}
				} else {
					a = this.escape(a);
					sqlWhere.push(b + "=" + a + "");
				}
			}.bind(this));
		} else {
			sqlWhere.push(where);
		}

		var vals = [];
		if (typeof data == "string") {
			if (data.length <= 0) {
				return { error: { code: "DATA_NOT_FOUND", sqlMessage: "Columns to update not found" } };
			}
			sql += table + " SET " + data + " WHERE " + sqlWhere.join(" AND ");
		} else {
			var fData = [];
			const colKeys = Object.keys(data);
			for (var i = 0; i < colKeys.length; i++) {
				const b = colKeys[i];
				fData.push(b + "=?");
				vals.push(data[b]);
			}

			if (!fData || fData.length <= 0) {
				return { error: { code: "DATA_NOT_FOUND", sqlMessage: "Columns to update not found" } };
			}
			sql += table + " SET " + fData.join(",") + " WHERE " + sqlWhere.join(" AND ");
		}

		if (CONFIG.log_sql) {
			console.log("SQL", sql, vals);
		}

		return await new Promise((resolve) => {
			this.DBCON.query(sql, vals, function(err, results) {
				if (err) {
					resolve({ error: err });
					return;
				}
				resolve({ raw: results, where: sqlWhere });
			});
		});
	}

	async delete(table, where) {
		var sqlWhere = [];
		if (typeof where == "object" && !Array.isArray(where)) {
			_.each(where, function(a, b) {
				if (a == "RAW") {
					sqlWhere.push(b);
				} else if (Array.isArray(a) && a.length == 2) {
					if (Array.isArray(a[0])) {
						sqlWhere.push(`${b} ${a[1]} (${a[0].map(a => `'${a}'`).join(",")})`);
					} else {
						sqlWhere.push(`${b} ${a[1]} '${a[0]}'`);
					}
				} else {
					sqlWhere.push(b + "='" + a + "'");
				}
			});
		} else {
			sqlWhere.push(where);
		}

		const sql = "DELETE FROM " + table + " WHERE " + sqlWhere.join(" AND ");

		if (CONFIG.log_sql) {
			console.log("SQL", sql);
		}

		return await new Promise((resolve) => {
			this.DBCON.query(sql, function(err, results) {
				if (err) {
					resolve({ error: err });
					return;
				}
				resolve({ raw: results, where: sqlWhere });
			});
		});
	}

	escape(value) {
		return mysql.escape(value);
	}
}

module.exports = MySQLDriver;
