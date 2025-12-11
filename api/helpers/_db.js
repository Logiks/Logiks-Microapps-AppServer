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
	
	//Standard MySQL
	db_query : async function(dbkey, sql, params) {
		if(_MYSQL[dbkey]==null) {
			console.log("\x1b[31m%s\x1b[0m",`DATABASE Not Connected for ${dbkey}`);
			return false;
		}
		if(CONFIG.log_sql) {
			console.log("SQL", sql, params);
		}
		const dbResponse = await new Promise((resolve, reject) => {
			_MYSQL[dbkey].query(sql, params, function(err, results, fields) {
					if(err) {
						//// console.log(err, err.code, err.sqlMessage);
						// console.log(err);
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
		
		const dbResponse = await new Promise((resolve, reject) => {
			_MYSQL[dbkey].query(sql, whereParams, function(err, results, fields) {
					if(err) {
						// console.log(err);
						// reject(false, err.code, err.sqlMessage);
						resolve({
							"status": "error", 
							"err_code": err.code,
							"err_message": err.sqlMessage
						});
					} else {
						results = JSON.parse(JSON.stringify(results));
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
		_.each(data, function(a,b) {
			cols.push(b);
			vals.push(a);
			quest.push("?");
		});

		var sql = "INSERT INTO "+table+" ("+cols.join(",")+") VALUES ("+quest.join(",")+")";

		if(CONFIG.log_sql) {
			console.log("SQL", sql, vals);
		}

		const results = await new Promise((resolve, reject) => {
			_MYSQL[dbkey].query(sql, vals, function(err, results, fields) {
					if(err) {
						resolve({
							"status": "error", 
							"err_code": err.code,
							"err_message": err.sqlMessage
						});
					} else {
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
		let values = data.map( obj => cols.map( key => obj[key]));

		var sql = "INSERT INTO "+table+" ("+cols.join(",")+") VALUES ?";

		if(CONFIG.log_sql) {
			console.log("SQL", sql, data);
		}

		const results = await new Promise((resolve, reject) => {
			_MYSQL[dbkey].query(sql, [values], function(err, results, fields) {
					if(err) {
						resolve({
							"status": "error", 
							"err_code": err.code,
							"err_message": err.sqlMessage
						});
					} else {
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
						resolve({
							"status": "error", 
							"err_code": err.code,
							"err_message": err.sqlMessage
						});
					} else {
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
		var fData = [];
		var vals = [];
		_.each(data, function(a,b) {
			fData.push(b+"=?");
			vals.push(a);
		});

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

		var sql = "UPDATE "+table+" SET "+fData.join(",")+" WHERE "+sqlWhere.join(" AND ");

		// console.log(sql);
		if(CONFIG.log_sql) {
			console.log("SQL", sql, vals);
		}

		const results = await new Promise((resolve, reject) => {
			_MYSQL[dbkey].query(sql, vals, function(err, results, fields) {
					if(err) {
						resolve({
							"status": "error", 
							"err_code": err.code,
							"err_message": err.sqlMessage
						});
					} else {
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