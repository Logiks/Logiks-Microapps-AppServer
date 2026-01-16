//MySQL Database Helper Functions

const mysql = require('mysql2');

var _MYSQL = {};

module.exports = {

	initialize : function() {
		if(CONFIG.dbmysql==null) return;
		
		_.each(CONFIG.dbmysql, function(conf, keyid) {
			if(conf.enable) {
				delete conf.enable;
				delete conf.keyid;

				//conf["nestTables"] = ".";//nestTables: true = for tree

				//.filter(a=>["host","port","user","password","database","insecureAuth","connectionLimit","debug"].indexOf(a)>=0)
				_MYSQL[keyid] = mysql.createPool(conf);

				_MYSQL[keyid].getConnection(function(err,connection){
						if (err || connection==null) {
							throw err;
							return;
						}
						
						console.log("\x1b[36m%s\x1b[0m","MYSQL Initialized - "+keyid);
					});
			}
		});

		// this.db_query("appdb", "SHOW TABLES", {}, function (authInfo) {
		// 	if(!authInfo) {
		// 		console.error("❌ DB Connetion not found");
		// 	}
		// });
	},

	db_connection : function(dbkey) {
		return _MYSQL[dbkey];
	},

	db_now: function() {
		return moment().format("Y-M-D HH:mm:ss");
	},

	db_nowunix: function() {
		return Math.floor(Date.now() / 1000);
	},
	
	//Standard MySQL
	db_query : async function(dbkey, sql, params) {
		if(_MYSQL[dbkey]==null) {
			console.log("\x1b[31m%s\x1b[0m",`DATABASE Not Connected for ${dbkey}`);
			return false;
		}
		if(CONFIG.log_sql) {
			console.log("SQL", sql, params);
		}
		var table = sql.toLowerCase().split("from");
		if(table[1]) table = table[1].trim().split(" ")[0];
		else table = false;

		if(table && table!="lgks_domains") sql = {sql: sql, nestTables: "."};
		
		const dbResponse = await new Promise((resolve, reject) => {
			_MYSQL[dbkey].query(sql, params, function(err, results, fields) {
					if(err) {
						if(CONFIG.log_sql) console.log(err);
						// console.log(err, err.code, err.sqlMessage);
						resolve({
							"status": "error", 
							"err_code": err.code,
							"err_message": err.sqlMessage
						});
					} else if(results.length<=0) {
						resolve({
							"status": "success", 
							"results": []
						});
					} else {
						results = JSON.parse(JSON.stringify(results));

						_.each(results, async function(row, k) {
							_.each(row, async function(val, col) {
								if(col.indexOf(".")>0 || !table)
									results[k][col] = await field_decrypter(`${col}`, val);
								else
									results[k][col] = await field_decrypter(`${table}.${col}`, val);
							});
						})

						resolve({
							"status": "success", 
							"results": results
						});
					}
				});
		});
		
		//console.log("results", dbResponse);
		// results = JSON.parse(JSON.stringify(results));

		return dbResponse;
	},

	db_findOne : async function(dbkey, table, columns, where, orderBy = "id DESC") {
		if(_MYSQL[dbkey]==null) {
			console.log("\x1b[31m%s\x1b[0m",`DATABASE Not Connected for ${dbkey}`);
			return false;
		}
		if(!columns) columns = "*";
		else if(Array.isArray(columns)) columns = columns.join(",");

		var sql = "SELECT "+columns+" FROM "+table+" ";

		var sqlWhere = [];
		if(typeof where == "object" && !Array.isArray(where)) {
			_.each(where, function(a, b) {
				if(a == "RAW") {
					sqlWhere.push(b);
				} else if(Array.isArray(a) && a.length==2) {
					sqlWhere.push(b+a[1]+"'"+a[0]+"'");
				} else {
					sqlWhere.push(b+"='"+a+"'");
				}
			});
		} else {
			sqlWhere.push(where);
		}

		if(sqlWhere.length>0) {
			sql += " WHERE "+sqlWhere.join(" AND ");
		}

		if(orderBy!=null && orderBy.length>0) {
			sql += " ORDER BY "+ orderBy;
		}

		sql += " LIMIT 1 ";

		if(CONFIG.log_sql) {
			console.log("SQL", sql);
		}

		if(table.indexOf(",")>0) {
			sql = {sql: sql, nestTables: "."};
		}
		
		const dbResponse = await new Promise((resolve, reject) => {
			_MYSQL[dbkey].query(sql, function(err, results, fields) {
					if(err || results.length<=0) {
						if(!err) err = {"code":"NOT_FOUND","sqlMessage":"No records found"};
						if(CONFIG.log_sql) console.log(err);
						// reject(false, err.code, err.sqlMessage);
						resolve({
							"status": "error", 
							"err_code": err.code,
							"err_message": err.sqlMessage
						});
					} else {
						results = JSON.parse(JSON.stringify(results));
						_.each(results[0], async function(val, col) {
							if(col.indexOf(".")>0)
								results[0][col] = await field_decrypter(`${col}`, val);
							else
								results[0][col] = await field_decrypter(`${table}.${col}`, val);
						});
						resolve({
							"status": "success", 
							"results": results[0],//results.length>0?results[0]:null
						});
					}
				});
		});

		// results = JSON.parse(JSON.stringify(results));

		return dbResponse;
	},

	db_selectQ : async function(dbkey, table, columns, where, whereParams, additionalQueryParams) {
		if(_MYSQL[dbkey]==null) {
			console.log("\x1b[31m%s\x1b[0m",`DATABASE Not Connected for ${dbkey}`);
			return false;
		}

		if(Array.isArray(columns)) columnsStr = columns.join(",");
		else columnsStr = columns;

		var sql = "SELECT "+columnsStr+" FROM "+table+" ";

		if(where!=null) {
			var sqlWhere = [];
			if(typeof where == "object" && !Array.isArray(where)) {
				_.each(where, function(a, b) {
					if(a == "RAW") {
						sqlWhere.push(b);
					} else if(Array.isArray(a) && a.length==2) {
						if(Array.isArray(a[0])) {
							sqlWhere.push(`${b} ${a[1]} (${a[0].map(a=>`'${a}'`).join(",")})`);
						} else {
							sqlWhere.push(`${b} ${a[1]} '${a[0]}'`);
						}
					} else {
						sqlWhere.push(b+"='"+a+"'");
					}
				});
			} else {
				sqlWhere.push(where);
			}

			if(sqlWhere.length>0) {
				sql += " WHERE "+sqlWhere.join(" AND ");
			}
		}

		if(additionalQueryParams!=null && additionalQueryParams.length>0) {
			sql += " "+ additionalQueryParams;
		}

		if(CONFIG.log_sql) {
			console.log("SQL", sql, whereParams);
		}

		if(table.indexOf(",")>0) {
			sql = {sql: sql, nestTables: "."};
		}
		
		const dbResponse = await new Promise((resolve, reject) => {
			_MYSQL[dbkey].query(sql, whereParams?Object.values(whereParams):[], function(err, results, fields) {
					if(err) {
						if(CONFIG.log_sql) console.log(err);
						// reject(false, err.code, err.sqlMessage);
						resolve({
							"status": "error", 
							"err_code": err.code,
							"err_message": err.sqlMessage
						});
					} else {
						results = JSON.parse(JSON.stringify(results));
						
						_.each(results, async function(row, k) {
							_.each(row, async function(val, col) {
								if(col.indexOf(".")>0)
									results[k][col] = await field_decrypter(`${col}`, val);
								else
									results[k][col] = await field_decrypter(`${table}.${col}`, val);
							});
						})

						resolve({
							"status": "success", 
							"results": results
						});
					}
				});
		});

		// results = JSON.parse(JSON.stringify(results));

		return dbResponse;
	},

	db_insertQ1 : async function(dbkey, table, data) {
		if(_MYSQL[dbkey]==null) {
			console.log("\x1b[31m%s\x1b[0m",`DATABASE Not Connected for ${dbkey}`);
			return false;
		}

		var cols = [];
		var quest = [];
		var vals = [];
		const colKeys = Object.keys(data);
		for(i=0;i<colKeys.length;i++) {
			var b = colKeys[i];
			var a = data[b];

			if(Array.isArray(a)) a = a.join(",");
			else if(typeof a == "object") a = JSON.stringify(a);

			if(b.indexOf(".")>0)
				a = await field_encrypter(`${b}`, a, data);
			else
				a = await field_encrypter(`${table}.${b}`, a, data);

			cols.push(b);
			vals.push(a);
			quest.push("?");
		}
		// _.each(data, async function(a,b) {
		// 	if(Array.isArray(a)) a = a.join(",");
		// 	else if(typeof a == "object") a = JSON.stringify(a);

		// 	if(b.indexOf(".")>0)
		// 		a = await field_encrypter(`${b}`, a, data);
		// 	else
		// 		a = await field_encrypter(`${table}.${b}`, a, data);

		// 	cols.push(b);
		// 	vals.push(a);
		// 	quest.push("?");
		// });

		var sql = "INSERT INTO "+table+" ("+cols.join(",")+") VALUES ("+quest.join(",")+")";

		if(CONFIG.log_sql) {
			console.log("SQL", sql, vals);
		}

		const results = await new Promise((resolve, reject) => {
			_MYSQL[dbkey].query(sql, vals, function(err, results, fields) {
					if(err) {
						if(CONFIG.log_sql) console.log(err);
						resolve({
							"status": "error", 
							"err_code": err.code,
							"err_message": err.sqlMessage
						});
					} else {
						DATAMODELS.checkHook(table, "insert", dbkey, results.insertId);
						resolve({
							"status": "success", 
							"insertId": results.insertId
						});
					}
				});
		});

		return results;
		
	},

	db_insert_batchQ : async function(dbkey, table, data) {
		if(_MYSQL[dbkey]==null) {
			console.log("\x1b[31m%s\x1b[0m",`DATABASE Not Connected for ${dbkey}`);
			return false;
		}

		if(data[0]==null) {
			return false;
		}

		let cols = Object.keys(data[0]);

		for(i=0;i<data.length;i++) {
			const obj = data[i];

			for(j=0;j<cols.length;j++) {
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

		// let values = data.map( obj => cols.map( async (key) => {
		// 	var a = obj[key];
		// 	if(Array.isArray(a)) a = a.join(",");
		// 	else if(typeof a == "object") a = JSON.stringify(a);

		// 	if(key.indexOf(".")>0)
		// 		a = await field_encrypter(`${key}`, a, obj);
		// 	else
		// 		a = await field_encrypter(`${table}.${key}`, a, obj);
			
		// 	return a;
		// }));

		var sql = "INSERT INTO "+table+" ("+cols.join(",")+") VALUES ?";

		if(CONFIG.log_sql) {
			console.log("SQL", sql, data);
		}

		const results = await new Promise((resolve, reject) => {
			_MYSQL[dbkey].query(sql, [values], function(err, results, fields) {
					if(err) {
						if(CONFIG.log_sql) console.log(err);
						resolve({
							"status": "error", 
							"err_code": err.code,
							"err_message": err.sqlMessage
						});
					} else {
						DATAMODELS.checkHook(table, "insert", dbkey, results);
						resolve({
							"status": "success", 
							"results": results
						});
					}
				});
		});

		return results;

		
	},

	db_updateQ : async function(dbkey, table, data, where) {
		if(_MYSQL[dbkey]==null) {
			console.log("\x1b[31m%s\x1b[0m",`DATABASE Not Connected for ${dbkey}`);
			return false;
		}

		var sql = "UPDATE ";

		var sqlWhere = [];
		if(typeof where == "object" && !Array.isArray(where)) {
			_.each(where, function(a, b) {
				if(a == "RAW") {
					sqlWhere.push(b);
				} else if(Array.isArray(a) && a.length==2) {
					sqlWhere.push(b+a[1]+"'"+a[0]+"'");
				} else {
					sqlWhere.push(b+"='"+a+"'");
				}
			});
		} else {
			sqlWhere.push(where);
		}

		if(typeof data == "string") {
			if(data.length<=0) {
				return {
					"status": "error", 
					"err_code": "DATA_NOT_FOUND",
					"err_message": "Columns to update not found"
				}
			}
			sql += table+" SET "+data+" WHERE "+sqlWhere.join(" AND ");
		} else {
			var fData = [];
			var vals = [];
			const colKeys = Object.keys(data);
			for(i=0;i<colKeys.length;i++) {
				var b = colKeys[i];
				var a = data[b];

				if(Array.isArray(a)) a = a.join(",");
				else if(typeof a == "object") a = JSON.stringify(a);

				if(b.indexOf(".")>0)
					a = await field_encrypter(`${b}`, a);
				else
					a = await field_encrypter(`${table}.${b}`, a);

				fData.push(b+"=?");
				vals.push(a);
			}
			
			if(!fData || fData.length<=0) {
				return {
					"status": "error", 
					"err_code": "DATA_NOT_FOUND",
					"err_message": "Columns to update not found"
				}
			}
			sql += table+" SET "+fData.join(",")+" WHERE "+sqlWhere.join(" AND ");
		}

		// console.log(sql);
		if(CONFIG.log_sql) {
			console.log("SQL", sql, vals);
		}

		const results = await new Promise((resolve, reject) => {
			_MYSQL[dbkey].query(sql, vals, function(err, results, fields) {
					if(err) {
						if(CONFIG.log_sql) console.log(err);
						resolve({
							"status": "error", 
							"err_code": err.code,
							"err_message": err.sqlMessage
						});
					} else {
						DATAMODELS.checkHook(table, "update", dbkey, sqlWhere);
						resolve({
							"status": "success", 
							"results": results
						});
					}
				});
		});

		return results;
	},

	db_deleteQ : async function(dbkey, table, where) {
		if(_MYSQL[dbkey]==null) {
			console.log("\x1b[31m%s\x1b[0m",`DATABASE Not Connected for ${dbkey}`);
			return false;
		}

		sqlWhere = [];
		if(typeof where == "object" && !Array.isArray(where)) {
			_.each(where, function(a, b) {
				if(a == "RAW") {
					sqlWhere.push(b);
				} else if(Array.isArray(a) && a.length==2) {
					sqlWhere.push(b+a[1]+"'"+a[0]+"'");
				} else {
					sqlWhere.push(b+"='"+a+"'");
				}
			});
		} else {
			sqlWhere.push(where);
		}

		var sql = "DELETE FROM "+table+" WHERE "+sqlWhere.join(" AND ");

		if(CONFIG.log_sql) {
			console.log("SQL", sql, vals);
		}

		const results = await new Promise((resolve, reject) => {
			_MYSQL[dbkey].query(sql, function(err, results, fields) {
					if(err) {
						if(CONFIG.log_sql) console.log(err);
						resolve({
							"status": "error", 
							"err_code": err.code,
							"err_message": err.sqlMessage
						});
					} else {
						DATAMODELS.checkHook(table, "delete", dbkey, sqlWhere);
						resolve({
							"status": "success", 
							"results": results
						});		
					}
				
				});
		});

		return results;
	}
}

//fieldId = table.column
async function field_encrypter(fieldId, data) {
	// console.log("field_encrypter", fieldId, data);
	var colArr = fieldId.split(".");
	return await DATAMODELS.prepareField(colArr[0], colArr[1], data);
}

//fieldId = table.column
async function field_decrypter(fieldId, data) {
	// console.log("field_decrypter", fieldId, data);
	var colArr = fieldId.split(".");
	return await DATAMODELS.processField(colArr[0], colArr[1], data);
}