//Database Helper Functions - dialect-agnostic dispatcher.
//Each dbkey is backed by a driver (api/helpers/db/drivers/*) chosen by
//DBManager based on which CONFIG section (dbmysql/dbpgsql/...) declared it.
//This file owns everything that must behave identically regardless of
//engine: field encryption (via DATAMODELS), hooks, logging and the
//{status,...} response envelope. SQL/driver-specific mechanics live in the
//driver classes themselves.
// SELECT @@global.time_zone, @@session.time_zone, @@system_time_zone;
// If system_time_zone = IST, then in config mysql - add timezone: "-05:30";

const DBMANAGER = require('./db/DBManager');
const mysql = require('mysql2');

module.exports = {

	initialize : function() {
		DBMANAGER.initialize();

		console.log("\x1b[36m%s\x1b[0m", "Database Engine Intialized");

		return true;
	},

	db_connection : function(dbkey) {
		const driver = DBMANAGER.getDriver(dbkey);
		return driver ? driver.getRawConnection() : undefined;
	},

	db_now: function() {
		return moment().format("Y-M-D HH:mm:ss");
	},

	db_nowunix: function() {
		return Math.floor(Date.now() / 1000);
	},

	db_clean: function(value) {
		return clean(value);
	},

	db_clean_key: function(value) {
		return clean(value).replace(/'/g,'');
	},

	//Standard raw-SQL passthrough. The SQL text is written for whichever
	//dialect dbkey's driver runs (MySQL/PGSQL/MSSQL) - it is not translated
	//across engines. Not supported against a MongoDB dbkey.
	db_query : async function(dbkey, sql, params) {
		const driver = DBMANAGER.getDriver(dbkey);
		if(driver==null) {
			console.log("\x1b[31m%s\x1b[0m",`DATABASE Not Connected for ${dbkey}`);
			return false;
		}

		if(CONFIG.log_sql) {
			console.log("SQL", sql, params);
		}
		const queryType = sql.toLowerCase().split(" ")[0];
		var table = false;

		switch(queryType) {
			case "select":case "delete":
				var table = sql.toLowerCase().split("from");
				if(table[1]) table = table[1].trim().split(" ")[0].replace(";","");
				else table = false;
				break;
			case "insert":
				var table = sql.toLowerCase().split("into");
				if(table[1]) table = table[1].trim().split(" ")[0].replace(";","");
				else table = false;
				break;
			case "update":
				var table = sql.toLowerCase().split("update");
				if(table[1]) table = table[1].trim().split(" ")[0].replace(";","");
				else table = false;
				break;
			default:
				break;
		}

		try {
			sql = await DATAMODELS.processQuery(table || "", sql);
		} catch(err) {}

		const IS_SELECT = (sql.toLowerCase().trim().indexOf("select")===0)?true:false;

		const { error, rows } = await driver.rawQuery(sql, params, table);

		if(error) {
			if(CONFIG.log_sql) console.log(error);
			return {
				"status": "error",
				"err_code": error.code,
				"err_message": error.sqlMessage
			};
		}

		if(!rows || rows.length<=0) {
			return {
				"status": "success",
				"results": []
			};
		}

		if(IS_SELECT) {
			const encryptedData = await enum_encrypted(rows[0]);

			if(encryptedData.fields.length>0) {
				for (var k = rows.length - 1; k >= 0; k--) {
					const row = rows[k];
					const cols = Object.keys(row);
					for (var i = cols.length - 1; i >= 0; i--) {
						const col = cols[i];
						const val = row[col];

						if(encryptedData.fields.indexOf(col)>=0) {
							if(col.indexOf(".")>0 || !table)
								rows[k][col] = await field_decrypter(`${col}`, val);
							else
								rows[k][col] = await field_decrypter(`${table}.${col}`, val);
						}
					}
				}
			}
		}

		return {
			"status": "success",
			"results": rows
		};
	},

	db_findOne : async function(dbkey, table, columns, where, orderBy = "id DESC", flatObj = false) {
		const driver = DBMANAGER.getDriver(dbkey);
		if(driver==null) {
			console.log("\x1b[31m%s\x1b[0m",`DATABASE Not Connected for ${dbkey}`);
			return false;
		}

		const { error, rows } = await driver.findOne(table, columns, where, orderBy);

		if(error || !rows || rows.length<=0) {
			const err = error || {"code":"NOT_FOUND","sqlMessage":"No records found"};
			if(CONFIG.log_sql) console.log(err);
			if(flatObj) return false;
			else return {
				"status": "error",
				"err_code": err.code,
				"err_message": err.sqlMessage
			};
		}

		const results = JSON.parse(JSON.stringify(rows));

		const k = 0;
		const row = results[k];
		const cols = Object.keys(row);
		for (var i = cols.length - 1; i >= 0; i--) {
			const col = cols[i];
			const val = row[col];

			if(col.indexOf(".")>0 || !table)
				results[k][col] = await field_decrypter(`${col}`, val);
			else
				results[k][col] = await field_decrypter(`${table}.${col}`, val);
		}

		if(flatObj) return results[0];
		else return {
			"status": "success",
			"results": results[0],
		};
	},

	db_selectQ : async function(dbkey, table, columns, where, whereParams, additionalQueryParams, joins) {
		const driver = DBMANAGER.getDriver(dbkey);
		if(driver==null) {
			console.log("\x1b[31m%s\x1b[0m",`DATABASE Not Connected for ${dbkey}`);
			return false;
		}
		if(!table) return false;

		const { error, rows } = await driver.select(table, columns, where, whereParams?Object.values(whereParams):[], additionalQueryParams, joins);

		if(error) {
			if(CONFIG.log_sql) console.log(error);
			return {
				"status": "error",
				"err_code": error.code,
				"err_message": error.sqlMessage
			};
		}

		const encryptedData = await enum_encrypted(rows[0], (table.indexOf(",")>0 || table.indexOf(" ")>0)?false: table);

		if(encryptedData.fields.length>0) {
			for (var k = rows.length - 1; k >= 0; k--) {
				const row = rows[k];
				const cols = Object.keys(row);
				for (var i = cols.length - 1; i >= 0; i--) {
					const col = cols[i];
					const val = row[col];

					if(encryptedData.fields.indexOf(col)>=0) {
						if(col.indexOf(".")>0 || !table)
							rows[k][col] = await field_decrypter(`${col}`, val);
						else
							rows[k][col] = await field_decrypter(`${table}.${col}`, val);
					}
				}
			}
		}

		return {
			"status": "success",
			"results": rows
		};
	},

	//Takes a single query-descriptor object and dispatches it to db_selectQ -
	//convenient for analytics/dashboard-style queries (derived tables,
	//joins, group by) that would otherwise mean juggling db_selectQ's many
	//positional args. Shape:
	//   {
	//     type: "sql",          // optional, only "sql" is supported today
	//     table: "...",         // required - table name or a derived-table expression, eg. "(SELECT ...) AS months"
	//     cols: "...",          // optional, defaults to "*" (also accepts "columns")
	//     where: {...},         // optional, same where-object contract as db_selectQ
	//     whereParams: {...},   // optional, same as db_selectQ's whereParams
	//     join: [...],          // optional, same join-array contract as db_selectQ's `joins`
	//     groupby / having / orderby: "...",  // optional raw SQL fragments
	//     limit / offset: number             // optional
	//   }
	db_selectObj : async function(dbkey, jsonObj) {
		if(!jsonObj || typeof jsonObj != "object") {
			return {
				"status": "error",
				"err_code": "INVALID_QUERY_OBJECT",
				"err_message": "db_selectObj requires a query descriptor object"
			};
		}

		const type = jsonObj.type || "sql";
		if(type != "sql") {
			return {
				"status": "error",
				"err_code": "UNSUPPORTED_QUERY_TYPE",
				"err_message": `db_selectObj does not support type "${type}" - only "sql" is implemented`
			};
		}

		if(!jsonObj.table) {
			return {
				"status": "error",
				"err_code": "TABLE_NOT_FOUND",
				"err_message": "db_selectObj requires a \"table\" (a table name or a derived-table expression)"
			};
		}

		const columns = jsonObj.cols || jsonObj.columns || "*";

		var tail = [];
		if(jsonObj.groupby) tail.push("GROUP BY " + jsonObj.groupby);
		if(jsonObj.having) tail.push("HAVING " + jsonObj.having);
		if(jsonObj.orderby) tail.push("ORDER BY " + jsonObj.orderby);
		if(jsonObj.limit != null) tail.push("LIMIT " + jsonObj.limit);
		if(jsonObj.offset != null) tail.push("OFFSET " + jsonObj.offset);

		return await this.db_selectQ(dbkey, jsonObj.table, columns, jsonObj.where || {}, jsonObj.whereParams, tail.join(" "), jsonObj.join);
	},

	db_insertQ1 : async function(dbkey, table, data) {
		const driver = DBMANAGER.getDriver(dbkey);
		if(driver==null) {
			console.log("\x1b[31m%s\x1b[0m",`DATABASE Not Connected for ${dbkey}`);
			return false;
		}

		var finalData = {};
		const colKeys = Object.keys(data);
		for(var i=0;i<colKeys.length;i++) {
			var b = colKeys[i];
			var a = data[b];

			if(Array.isArray(a)) a = a.join(",");
			else if(typeof a == "object") a = JSON.stringify(a);

			if(b.indexOf(".")>0)
				a = await field_encrypter(`${b}`, a, data);
			else
				a = await field_encrypter(`${table}.${b}`, a, data);

			finalData[b] = a;
		}

		const { error, insertId } = await driver.insertOne(table, finalData);

		if(error) {
			if(CONFIG.log_sql) console.log(error);
			return {
				"status": "error",
				"err_code": error.code,
				"err_message": error.sqlMessage
			};
		}

		DATAMODELS.checkHook(table, "insert", dbkey, {
			id: insertId
		});

		return {
			"status": "success",
			"insertId": insertId
		};
	},

	db_insert_batchQ : async function(dbkey, table, data) {
		const driver = DBMANAGER.getDriver(dbkey);
		if(driver==null) {
			console.log("\x1b[31m%s\x1b[0m",`DATABASE Not Connected for ${dbkey}`);
			return false;
		}

		if(data[0]==null) {
			return false;
		}

		let cols = Object.keys(data[0]);

		for(var i=0;i<data.length;i++) {
			const obj = data[i];

			for(var j=0;j<cols.length;j++) {
				var key = cols[j];

				if(!obj[key]) continue;

				var a = obj[key];
				if(Array.isArray(a)) a = a.join(",");
				else if(typeof a == "object") a = JSON.stringify(a);

				if(key.indexOf(".")>0)
					a = await field_encrypter(`${key}`, a, obj);
				else
					a = await field_encrypter(`${table}.${key}`, a, obj);

				data[i][key] = a;
			}
		}

		const { error, raw } = await driver.insertBatch(table, data);

		if(error) {
			if(CONFIG.log_sql) console.log(error);
			return {
				"status": "error",
				"err_code": error.code,
				"err_message": error.sqlMessage
			};
		}

		DATAMODELS.checkHook(table, "batchq", dbkey, raw);
		return {
			"status": "success",
			"results": raw
		};
	},

	db_increamentQ : async function(dbkey, table, column, where, userid, increamentBy = 1) {
		var dated = moment().format("Y-M-D HH:mm:ss");
		return await this.db_updateQ(dbkey, table, `${column} = ${column} + ${increamentBy}, edited_on = '${dated}', edited_by = '${userid}'`, where);
	},

	db_decreamentQ : async function(dbkey, table, column, where, userid, decreamentBy = 1) {
		var dated = moment().format("Y-M-D HH:mm:ss");
		return await this.db_updateQ(dbkey, table, `${column} = ${column} - ${decreamentBy}, edited_on = '${dated}', edited_by = '${userid}'`, where);
	},

	db_updateQ : async function(dbkey, table, data, where) {
		const driver = DBMANAGER.getDriver(dbkey);
		if(driver==null) {
			console.log("\x1b[31m%s\x1b[0m",`DATABASE Not Connected for ${dbkey}`);
			return false;
		}

		var finalData;
		if(typeof data == "string") {
			if(data.length<=0) {
				return {
					"status": "error",
					"err_code": "DATA_NOT_FOUND",
					"err_message": "Columns to update not found"
				}
			}
			finalData = data;
		} else {
			finalData = {};
			const colKeys = Object.keys(data);
			for(var i=0;i<colKeys.length;i++) {
				var b = colKeys[i];
				var a = data[b];

				if(Array.isArray(a)) a = a.join(",");
				else if(typeof a == "object") a = JSON.stringify(a);

				if(b.indexOf(".")>0)
					a = await field_encrypter(`${b}`, a);
				else
					a = await field_encrypter(`${table}.${b}`, a);

				finalData[b] = a;
			}

			if(Object.keys(finalData).length<=0) {
				return {
					"status": "error",
					"err_code": "DATA_NOT_FOUND",
					"err_message": "Columns to update not found"
				}
			}
		}

		const { error, raw, where: builtWhere } = await driver.update(table, finalData, where);

		if(error) {
			if(CONFIG.log_sql) console.log(error);
			return {
				"status": "error",
				"err_code": error.code,
				"err_message": error.sqlMessage
			};
		}

		DATAMODELS.checkHook(table, "update", dbkey, builtWhere);

		return {
			"status": "success",
			"results": raw
		};
	},

	db_deleteQ : async function(dbkey, table, where) {
		const driver = DBMANAGER.getDriver(dbkey);
		if(driver==null) {
			console.log("\x1b[31m%s\x1b[0m",`DATABASE Not Connected for ${dbkey}`);
			return false;
		}

		const { error, raw, where: builtWhere } = await driver.delete(table, where);

		if(error) {
			if(CONFIG.log_sql) console.log(error);
			return {
				"status": "error",
				"err_code": error.code,
				"err_message": error.sqlMessage
			};
		}

		DATAMODELS.checkHook(table, "delete", dbkey, builtWhere);

		return {
			"status": "success",
			"results": raw
		};
	}
}

//Find Encryption in given records
async function enum_encrypted(record, table = false) {
	if(!record) {
		return {
			tables: [],
			fields: []
		};
	}

	const cols = Object.keys(record);

	const tables = new Set();

	if(table) {
		tables.add(table);
	} else {
		for (let i = 0; i < cols.length; i++) {
		    const col = cols[i];
		    const idx = col.indexOf(".");

		    if (idx > 0) {
		        tables.add(col.substring(0, idx));
		    }
		}
	}

	const uniqueTables = [...tables];
	var uniqueFields = [];

	for (var i = uniqueTables.length - 1; i >= 0; i--) {
		var fields = await DATAMODELS.getEncryptedFields(uniqueTables[i]);
		var fields1 = fields.map(a=>`${uniqueTables[i]}.${a}`);
		uniqueFields = [...fields, ...fields1];
	}

	return {
		tables: uniqueTables,
		fields: uniqueFields
	};
}

//fieldId = table.column
async function field_encrypter(fieldId, data) {
	var colArr = fieldId.split(".");
	return await DATAMODELS.prepareField(colArr[0], colArr[1], data);
}

//fieldId = table.column
async function field_decrypter(fieldId, data) {
	var colArr = fieldId.split(".");
	const d1 = await DATAMODELS.processField(colArr[0], colArr[1], data);
	return d1;
}

function clean(value) {
  if (Array.isArray(value)) {
    return value.map(v => clean(v));
  }

  if (value === null || value === undefined) {
    return null;
  }

  return mysql.escape(value);
}
