//DynamoDB driver - a managed key-value/document store, not a SQL engine.
//Several things are necessarily different from the SQL/Mongo drivers:
//
//  - Tables are lazily auto-created on first use (PAY_PER_REQUEST billing,
//    partition key "id") if they don't already exist, so callers don't have
//    to provision schema up front - matching the DX of the other drivers.
//    This needs dynamodb:CreateTable/DescribeTable IAM permission in
//    addition to the usual read/write actions.
//  - Like MongoDBDriver, there's no native auto-increment - a driver-managed
//    "_counters" table (partition key "id" = table name, string) hands out
//    monotonic numeric ids so the existing "id" PK convention keeps working.
//  - Only a where-clause that is exactly {id: value} maps to an efficient
//    GetItem/UpdateItem/DeleteItem by key. Any other where clause runs a
//    full table Scan with a FilterExpression (paginated to completion) -
//    correct, but O(table size) rather than indexed. There is no secondary
//    index support here.
//  - orderBy is not supported (Scan has no generic sort) and is ignored.
//  - db_query (raw SQL), a "RAW" where-fragment, and db_selectQ's
//    additionalQueryParams all have no Dynamo equivalent and fail with a
//    clear error rather than silently doing nothing.
//  - LIKE only translates the two patterns Dynamo can express natively:
//    "prefix%" (begins_with) and "%contains%" (contains). Anything else
//    throws instead of guessing.
//
//NOTE: written and code-reviewed against the documented AWS SDK v3 API and
//exercised against DynamoDB Local, not against a real AWS account/region -
//none was available when this was built. IAM/permissions/throttling
//behaviour on real DynamoDB should be re-checked before production use.

const { DynamoDBClient, CreateTableCommand, DescribeTableCommand, ListTablesCommand, waitUntilTableExists } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand, BatchWriteCommand } = require("@aws-sdk/lib-dynamodb");

const DBDriver = require("../DBDriver");

class DynamoDBDriver extends DBDriver {

	DRIVER_NAME = "DYNAMODB";

	connect() {
		const conf = this.DBPROPS;

		const client = new DynamoDBClient({
			region: conf.region || "us-east-1",
			endpoint: conf.endpoint || undefined,
			credentials: (conf.accessKeyId && conf.secretAccessKey) ? {
				accessKeyId: conf.accessKeyId,
				secretAccessKey: conf.secretAccessKey,
			} : undefined,
		});

		this.rawClient = client;
		this.DBCON = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
		this.tablePrefix = conf.tablePrefix || "";
		this.readyTables = new Set();

		client.send(new ListTablesCommand({}))
			.then(() => console.log("\x1b[36m%s\x1b[0m", "DYNAMODB Initialized - " + this.DBKEY))
			.catch((err) => console.log("\x1b[31m%s\x1b[0m", `DYNAMODB Connection Failed - ${this.DBKEY}: ${err.message}`));

		return true;
	}

	async disconnect() {
		if (this.rawClient) this.rawClient.destroy();
		return true;
	}

	getRawConnection() {
		return this.DBCON;
	}

	_tn(table) {
		return this.tablePrefix + table;
	}

	async _ensureTable(table) {
		if (this.readyTables.has(table)) return;

		const tableName = this._tn(table);
		try {
			await this.rawClient.send(new DescribeTableCommand({ TableName: tableName }));
		} catch (err) {
			if (err.name !== "ResourceNotFoundException") throw err;

			await this.rawClient.send(new CreateTableCommand({
				TableName: tableName,
				KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
				AttributeDefinitions: [{ AttributeName: "id", AttributeType: table === "_counters" ? "S" : "N" }],
				BillingMode: "PAY_PER_REQUEST",
			}));

			await waitUntilTableExists({ client: this.rawClient, maxWaitTime: 60 }, { TableName: tableName });
		}

		this.readyTables.add(table);
	}

	async _nextId(table) {
		await this._ensureTable("_counters");

		const result = await this.DBCON.send(new UpdateCommand({
			TableName: this._tn("_counters"),
			Key: { id: table },
			UpdateExpression: "ADD seq :incr",
			ExpressionAttributeValues: { ":incr": 1 },
			ReturnValues: "UPDATED_NEW",
		}));

		return result.Attributes.seq;
	}

	//Paginates a Scan to completion (Dynamo returns at most ~1MB per page,
	//and applies FilterExpression AFTER that page is read - stopping at the
	//first page would silently miss matches). Stops early once `limit` items
	//have been collected.
	async _scanAll(table, filter, { limit } = {}) {
		const items = [];
		let ExclusiveStartKey;

		do {
			const params = { TableName: this._tn(table), ExclusiveStartKey };
			if (filter) Object.assign(params, filter);

			const result = await this.DBCON.send(new ScanCommand(params));
			items.push(...(result.Items || []));
			ExclusiveStartKey = result.LastEvaluatedKey;

			if (limit && items.length >= limit) break;
		} while (ExclusiveStartKey);

		return limit ? items.slice(0, limit) : items;
	}

	async _matchingIds(table, where) {
		const filter = buildFilterExpression(where);
		const items = await this._scanAll(table, filter);
		return items.map((item) => item.id);
	}

	async rawQuery(sql, params, table) {
		return { error: { code: "UNSUPPORTED", sqlMessage: "db_query (raw SQL) is not supported for DynamoDB dbkeys - use db_findOne/db_selectQ/db_insertQ1/etc. instead" } };
	}

	async findOne(table, columns, where, orderBy) {
		try {
			await this._ensureTable(table);

			if (isSimpleIdEquality(where)) {
				const result = await this.DBCON.send(new GetCommand({ TableName: this._tn(table), Key: { id: where.id } }));
				return { rows: result.Item ? [projectColumns(result.Item, columns)] : [] };
			}

			const filter = buildFilterExpression(where);
			const items = await this._scanAll(table, filter, { limit: 1 });
			return { rows: items.map((item) => projectColumns(item, columns)) };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async select(table, columns, where, whereParams, additionalQueryParams, joins) {
		try {
			if (additionalQueryParams != null && String(additionalQueryParams).trim().length > 0) {
				throw new Error(`additionalQueryParams ("${additionalQueryParams}") is a raw SQL fragment and is not supported for DynamoDB dbkeys`);
			}

			if (Array.isArray(joins) && joins.length > 0) {
				throw new Error(`joins are not supported for DynamoDB dbkeys - there is no SQL JOIN equivalent here`);
			}

			await this._ensureTable(table);
			const filter = where != null ? buildFilterExpression(where) : null;
			const items = await this._scanAll(table, filter);
			return { rows: items.map((item) => projectColumns(item, columns)) };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async insertOne(table, data) {
		try {
			await this._ensureTable(table);
			const id = await this._nextId(table);
			const item = Object.assign({}, data, { id });

			await this.DBCON.send(new PutCommand({ TableName: this._tn(table), Item: item }));
			return { insertId: id };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async insertBatch(table, dataArr) {
		try {
			await this._ensureTable(table);

			const ids = [];
			const items = [];
			for (const obj of dataArr) {
				const id = await this._nextId(table);
				ids.push(id);
				items.push(Object.assign({}, obj, { id }));
			}

			for (let i = 0; i < items.length; i += 25) {
				const chunk = items.slice(i, i + 25);
				await this.DBCON.send(new BatchWriteCommand({
					RequestItems: {
						[this._tn(table)]: chunk.map((item) => ({ PutRequest: { Item: item } })),
					},
				}));
			}

			return { raw: { affectedRows: items.length, insertId: ids[0], insertIds: ids } };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async update(table, data, where) {
		try {
			await this._ensureTable(table);

			var updateExpr;
			if (typeof data == "string") {
				if (data.length <= 0) {
					return { error: { code: "DATA_NOT_FOUND", sqlMessage: "Columns to update not found" } };
				}
				updateExpr = parseSetStringToDynamo(data);
			} else {
				if (Object.keys(data).length <= 0) {
					return { error: { code: "DATA_NOT_FOUND", sqlMessage: "Columns to update not found" } };
				}
				updateExpr = buildSetExpression(data);
			}

			const ids = isSimpleIdEquality(where) ? [where.id] : await this._matchingIds(table, where);

			for (const id of ids) {
				await this.DBCON.send(new UpdateCommand(Object.assign({ TableName: this._tn(table), Key: { id } }, updateExpr)));
			}

			return { raw: { affectedRows: ids.length }, where };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	async delete(table, where) {
		try {
			await this._ensureTable(table);

			const ids = isSimpleIdEquality(where) ? [where.id] : await this._matchingIds(table, where);

			for (const id of ids) {
				await this.DBCON.send(new DeleteCommand({ TableName: this._tn(table), Key: { id } }));
			}

			return { raw: { affectedRows: ids.length }, where };
		} catch (err) {
			return { error: normalizeError(err) };
		}
	}

	//DynamoDBDriver never builds SQL/filter text by string concatenation, so
	//there's nothing to literal-escape - kept only to satisfy the abstract
	//DBDriver contract.
	escape(value) {
		return value;
	}
}

function isSimpleIdEquality(where) {
	if (where == null || typeof where != "object" || Array.isArray(where)) return false;
	const keys = Object.keys(where);
	return keys.length == 1 && keys[0] == "id" && !Array.isArray(where.id);
}

function projectColumns(item, columns) {
	if (!columns || columns == "*") return item;

	const list = Array.isArray(columns) ? columns : String(columns).split(",").map((c) => c.trim());
	const out = {};
	list.forEach((c) => { if (item[c] !== undefined) out[c] = item[c]; });
	return out;
}

//Builds a Scan FilterExpression from the same where-object contract the
//other drivers use: {col: value}, {col: [value, operator]}. "RAW" has no
//Dynamo equivalent and is rejected rather than silently ignored.
function buildFilterExpression(where) {
	if (where == null) return null;

	if (typeof where != "object" || Array.isArray(where)) {
		throw new Error(`raw/array where clauses ("${where}") are not supported for DynamoDB dbkeys - pass a plain {column: value} object`);
	}

	const names = {};
	const values = {};
	const clauses = [];
	let vi = 0;

	_.each(where, function(a, b) {
		const nameKey = `#c${Object.keys(names).length}`;
		names[nameKey] = b;

		if (a == "RAW") {
			throw new Error(`RAW where clauses ("${b}") are not supported for DynamoDB dbkeys - there is no SQL text to pass through`);
		} else if (Array.isArray(a) && a.length == 2) {
			const val = a[0];
			const op = String(a[1]).toUpperCase();

			switch (op) {
				case "=": {
					const vk = `:v${vi++}`; values[vk] = val;
					clauses.push(`${nameKey} = ${vk}`);
					break;
				}
				case "!=": case "<>": {
					const vk = `:v${vi++}`; values[vk] = val;
					clauses.push(`${nameKey} <> ${vk}`);
					break;
				}
				case ">": {
					const vk = `:v${vi++}`; values[vk] = val;
					clauses.push(`${nameKey} > ${vk}`);
					break;
				}
				case ">=": {
					const vk = `:v${vi++}`; values[vk] = val;
					clauses.push(`${nameKey} >= ${vk}`);
					break;
				}
				case "<": {
					const vk = `:v${vi++}`; values[vk] = val;
					clauses.push(`${nameKey} < ${vk}`);
					break;
				}
				case "<=": {
					const vk = `:v${vi++}`; values[vk] = val;
					clauses.push(`${nameKey} <= ${vk}`);
					break;
				}
				case "IN": {
					const arr = Array.isArray(val) ? val : [val];
					const keys = arr.map((v) => { const vk = `:v${vi++}`; values[vk] = v; return vk; });
					clauses.push(`${nameKey} IN (${keys.join(",")})`);
					break;
				}
				case "NOT IN": {
					const arr = Array.isArray(val) ? val : [val];
					const keys = arr.map((v) => { const vk = `:v${vi++}`; values[vk] = v; return vk; });
					clauses.push(`NOT (${nameKey} IN (${keys.join(",")}))`);
					break;
				}
				case "LIKE": {
					const pattern = String(val);
					const vk = `:v${vi++}`;
					if (/^[^%_]*%$/.test(pattern)) {
						values[vk] = pattern.slice(0, -1);
						clauses.push(`begins_with(${nameKey}, ${vk})`);
					} else if (/^%[^%_]*%$/.test(pattern)) {
						values[vk] = pattern.slice(1, -1);
						clauses.push(`contains(${nameKey}, ${vk})`);
					} else {
						throw new Error(`LIKE pattern "${pattern}" is not supported for DynamoDB dbkeys - only "prefix%" and "%contains%" translate`);
					}
					break;
				}
				default:
					throw new Error(`unsupported where operator "${a[1]}" for column "${b}" on a DynamoDB dbkey`);
			}
		} else {
			const vk = `:v${vi++}`;
			values[vk] = a;
			clauses.push(`${nameKey} = ${vk}`);
		}
	});

	return { FilterExpression: clauses.join(" AND "), ExpressionAttributeNames: names, ExpressionAttributeValues: values };
}

function buildSetExpression(data) {
	const names = {};
	const values = {};
	const sets = Object.keys(data).map((col, i) => {
		names[`#c${i}`] = col;
		values[`:v${i}`] = data[col];
		return `#c${i} = :v${i}`;
	});
	return { UpdateExpression: "SET " + sets.join(", "), ExpressionAttributeNames: names, ExpressionAttributeValues: values };
}

//Parses the one raw SET-fragment shape this codebase actually generates
//(db_increamentQ/db_decreamentQ): "col = col + N, edited_on = '...', edited_by = '...'"
//into a combined ADD/SET UpdateExpression. Anything it can't recognize
//throws, rather than silently updating nothing.
function parseSetStringToDynamo(dataStr) {
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

		throw new Error(`cannot translate raw SET fragment "${clause}" for a DynamoDB dbkey - use an object data argument instead`);
	}

	const names = {};
	const values = {};
	const parts = [];

	const incKeys = Object.keys(inc);
	if (incKeys.length > 0) {
		const addParts = incKeys.map((col, i) => {
			const nk = `#i${i}`; const vk = `:i${i}`;
			names[nk] = col; values[vk] = inc[col];
			return `${nk} ${vk}`;
		});
		parts.push(`ADD ${addParts.join(", ")}`);
	}

	const setKeys = Object.keys(set);
	if (setKeys.length > 0) {
		const setParts = setKeys.map((col, i) => {
			const nk = `#s${i}`; const vk = `:s${i}`;
			names[nk] = col; values[vk] = set[col];
			return `${nk} = ${vk}`;
		});
		parts.push(`SET ${setParts.join(", ")}`);
	}

	return { UpdateExpression: parts.join(" "), ExpressionAttributeNames: names, ExpressionAttributeValues: values };
}

function normalizeError(err) {
	return { code: err.name || err.code || "DYNAMODB_ERROR", sqlMessage: err.message };
}

module.exports = DynamoDBDriver;
