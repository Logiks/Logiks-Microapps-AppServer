//MongoDB driver. Same method contract as the SQL drivers, but MongoDB is a
//document store, not a SQL engine - a few things are necessarily different:
//
//  - Documents get a monotonic numeric "id" field (kept in a `_counters`
//    collection, one doc per table) so that the existing "id" PK convention
//    (db_findOne's default orderBy, checkHook({id}), etc.) keeps working
//    unchanged. Mongo's own `_id` (ObjectId) is generated too but stripped
//    from every result.
//  - db_query (raw SQL text) is not supported - there is no SQL to run.
//  - A "RAW" where-clause fragment is not supported - there's no SQL text to
//    pass through into a filter object.
//  - db_selectQ's additionalQueryParams (a raw SQL fragment appended after
//    WHERE) is not supported for the same reason.
//  - db_updateQ's raw string SET fragment IS supported for the one shape the
//    codebase actually generates it in - db_increamentQ/db_decreamentQ's
//    "col = col + N, edited_on = '...', edited_by = '...'" - parsed into
//    $inc/$set. Anything else in that shape throws a clear error rather than
//    silently doing nothing.

const { MongoClient } = require("mongodb");

const DBDriver = require("../DBDriver");

class MongoDBDriver extends DBDriver {

	DRIVER_NAME = "MONGODB";

	connect() {
		const conf = this.DBPROPS;
		const uri = conf.uri || buildUri(conf);

		this.client = new MongoClient(uri);
		this.dbName = conf.database || null;

		//MongoClient must finish connect() before use - like MSSQLDriver, every
		//query method below awaits this same promise first.
		this.readyPromise = this.client.connect()
			.then(() => {
				this.DBCON = this.dbName ? this.client.db(this.dbName) : this.client.db();
				console.log("\x1b[36m%s\x1b[0m", "MONGODB Initialized - " + this.DBKEY);
				return true;
			})
			.catch((err) => {
				console.log("\x1b[31m%s\x1b[0m", `MONGODB Connection Failed - ${this.DBKEY}: ${err.message}`);
				return false;
			});

		return true;
	}

	async _ready() {
		if (this.readyPromise) await this.readyPromise;
		return this.DBCON;
	}

	async disconnect() {
		if (!this.client) return true;
		await this.client.close();
		return true;
	}

	getRawConnection() {
		return this.client;
	}

	async _nextId(table) {
		const db = await this._ready();
		const doc = await db.collection("_counters").findOneAndUpdate(
			{ _id: table },
			{ $inc: { seq: 1 } },
			{ upsert: true, returnDocument: "after" }
		);
		//driver v6+ returns the document directly; older versions wrap it as {value}
		return (doc && doc.value !== undefined) ? doc.value.seq : doc.seq;
	}

	async rawQuery(sql, params, table) {
		return { error: { code: "UNSUPPORTED", sqlMessage: "db_query (raw SQL) is not supported for MongoDB dbkeys - use db_findOne/db_selectQ/db_insertQ1/etc. instead" } };
	}

	async findOne(table, columns, where, orderBy) {
		try {
			const db = await this._ready();
			const filter = buildMongoFilter(where);
			const projection = buildProjection(columns);
			const sort = parseOrderBy(orderBy);

			if (CONFIG.log_sql) {
				console.log("MONGO findOne", table, filter, projection, sort);
			}

			let cursor = db.collection(table).find(filter, { projection }).limit(1);
			if (sort) cursor = cursor.sort(sort);

			const rows = await cursor.toArray();
			return { rows };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async select(table, columns, where, whereParams, additionalQueryParams, joins) {
		try {
			if (additionalQueryParams != null && String(additionalQueryParams).trim().length > 0) {
				throw new Error(`additionalQueryParams ("${additionalQueryParams}") is a raw SQL fragment and is not supported for MongoDB dbkeys`);
			}

			if (Array.isArray(joins) && joins.length > 0) {
				throw new Error(`joins are not supported for MongoDB dbkeys - there is no SQL JOIN equivalent here (consider $lookup via the native driver instead)`);
			}

			const db = await this._ready();
			const filter = where != null ? buildMongoFilter(where) : {};
			const projection = buildProjection(columns);

			if (CONFIG.log_sql && table.indexOf("lgks_") < 0) {
				console.log("MONGO select", table, filter, projection);
			}

			const rows = await db.collection(table).find(filter, { projection }).toArray();
			return { rows };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async insertOne(table, data) {
		try {
			const db = await this._ready();
			const id = await this._nextId(table);
			const doc = Object.assign({}, data, { id });

			if (CONFIG.log_sql) {
				console.log("MONGO insertOne", table, doc);
			}

			await db.collection(table).insertOne(doc);
			return { insertId: id };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async insertBatch(table, dataArr) {
		try {
			const db = await this._ready();

			const ids = [];
			const docs = [];
			//sequential to keep ids monotonic without a multi-document counter
			//transaction - batch sizes going through this path are modest.
			for (const item of dataArr) {
				const id = await this._nextId(table);
				ids.push(id);
				docs.push(Object.assign({}, item, { id }));
			}

			if (CONFIG.log_sql) {
				console.log("MONGO insertBatch", table, docs);
			}

			const result = await db.collection(table).insertMany(docs);
			return {
				raw: {
					affectedRows: result.insertedCount,
					insertId: ids[0],
					insertIds: ids,
				},
			};
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async update(table, data, where) {
		try {
			const db = await this._ready();
			const filter = buildMongoFilter(where);

			var updateDoc;
			if (typeof data == "string") {
				if (data.length <= 0) {
					return { error: { code: "DATA_NOT_FOUND", sqlMessage: "Columns to update not found" } };
				}
				updateDoc = parseSetString(data);
			} else {
				if (Object.keys(data).length <= 0) {
					return { error: { code: "DATA_NOT_FOUND", sqlMessage: "Columns to update not found" } };
				}
				updateDoc = { $set: data };
			}

			if (CONFIG.log_sql) {
				console.log("MONGO update", table, filter, updateDoc);
			}

			const result = await db.collection(table).updateMany(filter, updateDoc);
			return { raw: { affectedRows: result.modifiedCount }, where: filter };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async delete(table, where) {
		try {
			const db = await this._ready();
			const filter = buildMongoFilter(where);

			if (CONFIG.log_sql) {
				console.log("MONGO delete", table, filter);
			}

			const result = await db.collection(table).deleteMany(filter);
			return { raw: { affectedRows: result.deletedCount }, where: filter };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	//MongoDBDriver never builds SQL text, so there's nothing to literal-escape -
	//kept only to satisfy the abstract DBDriver contract.
	escape(value) {
		return value;
	}
}

function buildUri(conf) {
	const auth = conf.user ? `${encodeURIComponent(conf.user)}:${encodeURIComponent(conf.password || "")}@` : "";
	const port = conf.port || 27017;
	return `mongodb://${auth}${conf.host}:${port}/${conf.database || ""}`;
}

//Builds a Mongo filter from the same where-object contract the SQL drivers
//use: {col: value}, {col: [value, operator]}, {"raw fragment": "RAW"}.
//RAW has no Mongo equivalent and is rejected rather than silently ignored.
function buildMongoFilter(where) {
	if (where == null) return {};

	if (typeof where != "object" || Array.isArray(where)) {
		throw new Error(`raw/array where clauses ("${where}") are not supported for MongoDB dbkeys - pass a plain {column: value} object`);
	}

	const filter = {};

	_.each(where, function(a, b) {
		if (a == "RAW") {
			throw new Error(`RAW where clauses ("${b}") are not supported for MongoDB dbkeys - there is no SQL text to pass through`);
		} else if (Array.isArray(a) && a.length == 2) {
			const val = a[0];
			const op = String(a[1]).toUpperCase();

			switch (op) {
				case "=": filter[b] = val; break;
				case "!=": case "<>": filter[b] = { $ne: val }; break;
				case ">": filter[b] = { $gt: val }; break;
				case ">=": filter[b] = { $gte: val }; break;
				case "<": filter[b] = { $lt: val }; break;
				case "<=": filter[b] = { $lte: val }; break;
				case "IN": filter[b] = { $in: Array.isArray(val) ? val : [val] }; break;
				case "NOT IN": filter[b] = { $nin: Array.isArray(val) ? val : [val] }; break;
				case "LIKE": filter[b] = { $regex: likeToRegex(val) }; break;
				case "NOT LIKE": filter[b] = { $not: new RegExp(likeToRegex(val)) }; break;
				default:
					throw new Error(`unsupported where operator "${a[1]}" for column "${b}" on a MongoDB dbkey`);
			}
		} else {
			filter[b] = a;
		}
	});

	return filter;
}

//SQL LIKE ("%"/"_" wildcards) -> anchored regex source string.
function likeToRegex(pattern) {
	const escaped = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return "^" + escaped.replace(/%/g, ".*").replace(/_/g, ".") + "$";
}

function buildProjection(columns) {
	if (!columns || columns == "*") return { _id: 0 };

	const list = Array.isArray(columns) ? columns : String(columns).split(",").map((c) => c.trim());
	const projection = { _id: 0 };
	list.forEach((c) => { projection[c] = 1; });
	return projection;
}

function parseOrderBy(orderBy) {
	if (!orderBy || orderBy.length <= 0) return null;

	const sort = {};
	orderBy.split(",").forEach((part) => {
		const tokens = part.trim().split(/\s+/);
		const dir = (tokens[1] || "ASC").toUpperCase();
		sort[tokens[0]] = dir == "DESC" ? -1 : 1;
	});
	return sort;
}

//Parses the one raw SET-fragment shape this codebase actually generates
//(db_increamentQ/db_decreamentQ): "col = col + N, edited_on = '...', edited_by = '...'".
//Anything it can't recognize throws, rather than silently updating nothing.
function parseSetString(dataStr) {
	const inc = {};
	const set = {};

	const clauses = dataStr.split(",").map((s) => s.trim()).filter(Boolean);

	for (const clause of clauses) {
		const incMatch = clause.match(/^(\w+)\s*=\s*\1\s*([+-])\s*([\d.]+)$/);
		if (incMatch) {
			inc[incMatch[1]] = (incMatch[2] == "-" ? -1 : 1) * Number(incMatch[3]);
			continue;
		}

		const litMatch = clause.match(/^(\w+)\s*=\s*'((?:[^'\\]|\\.)*)'$/);
		if (litMatch) {
			set[litMatch[1]] = litMatch[2];
			continue;
		}

		const numMatch = clause.match(/^(\w+)\s*=\s*(-?[\d.]+)$/);
		if (numMatch) {
			set[numMatch[1]] = Number(numMatch[2]);
			continue;
		}

		throw new Error(`cannot translate raw SET fragment "${clause}" for a MongoDB dbkey - use an object data argument instead`);
	}

	const updateDoc = {};
	if (Object.keys(inc).length > 0) updateDoc.$inc = inc;
	if (Object.keys(set).length > 0) updateDoc.$set = set;
	return updateDoc;
}

function normalizeError(err) {
	return { code: err.code || "MONGO_ERROR", sqlMessage: err.message };
}

module.exports = MongoDBDriver;
