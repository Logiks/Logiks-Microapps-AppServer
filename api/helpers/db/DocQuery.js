//Engine-neutral query normalisation for the document API (api/helpers/_docdb.js).
//
//_docdb validates and normalises caller input here, then hands the result to a driver's doc*()
//methods (see "Document contract" in DBDriver.js). Drivers never see raw caller input.
//
//Canonical forms handed to drivers:
//  filter  - Mongo-style operator syntax, which is the de-facto document query language:
//            { field: value } | { "a.b": { $gt: 1, $in: [..], $regex: "..", $exists: true, ... } }
//            | { $and|$or|$nor: [filter, ..] }. Field names are dot paths into sub objects, datetime
//            strings are already Date objects. A non-Mongo driver translates from this form.
//  update  - { set, unset: [paths], inc, push, addToSet, pull, min, max, setOnInsert } with
//            { "dot.path": value } maps, all values already cleaned
//  sort    - { field: 1 | -1 }
//  columns - array of dot paths, or null for the whole document
//
//Caller filter syntax (all of these are accepted and turned into the canonical filter):
//   { level: "error" }                              flat equality
//   { level: ["error", "warn"] }                    list -> $in
//   { status: ["done", "!="] }                      [value, operator] pair
//   { "meta.user.id": "u1" }                        dot path into a JSON sub object
//   { created_on: { $gte: "2026-10-01", $lt: "2026-11-01" } }   operator object (whitelisted)
//   { created_on: [["2026-10-01", "2026-10-21"], "BETWEEN"] }   date-only end is end of day
//   { $or: [ {level: "error"}, {"meta.retry": {$gt: 3}} ] }
//
//Operators for pairs: = != <> > >= < <= IN NOT IN LIKE NOT LIKE BETWEEN NOT BETWEEN
//                     CONTAINS STARTS ENDS REGEX EXISTS IS NULL IS NOT NULL
//
//Dates: Date objects, moment-like objects (anything with toDate()) and strings in ISO form
//("2026-10-21T10:00:00Z", "2026-10-21 10:00:00") become Date objects in filters and documents.
//A bare "2026-10-21" is converted only for fields listed in options.dateFields or whose name ends
//in _on, _at, date, time or timestamp. Zone-less strings are read in the server's local zone.

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10000;

const FIELD_PATH = /^[A-Za-z_][\w-]*(\.[\w-]+)*$/;
const COLLECTION_NAME = /^[A-Za-z_][\w.-]{0,119}$/;
const DT_FULL = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/;
const DT_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FIELD_HINT = /(_on|_at|date|time|timestamp)$/i;
const BAD_KEYS = ["__proto__", "constructor", "prototype"];

//operators accepted inside a { field: { $op: value } } object
const VALUE_OPS = ["$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$nin", "$exists", "$regex", "$options", "$not", "$size", "$all", "$elemMatch"];
const LOGIC_OPS = ["$and", "$or", "$nor"];

const PAIR_OPS = ["=", "!=", "<>", ">", ">=", "<", "<=", "IN", "NOT IN", "LIKE", "NOT LIKE", "BETWEEN", "NOT BETWEEN",
	"CONTAINS", "STARTS", "ENDS", "REGEX", "EXISTS", "IS NULL", "IS NOT NULL"];

const DATE_UNITS = ["year", "month", "day", "hour", "minute"];
const METRIC_OPS = ["sum", "avg", "min", "max", "first", "last", "push", "addToSet"];
const UPDATE_OPS = ["inc", "push", "addToSet", "pull", "min", "max"];

class DocQueryError extends Error {
	constructor(code, message) {
		super(message);
		this.code = code;
	}
}

function each(obj, fn) {
	Object.keys(obj).forEach((k) => fn(obj[k], k));
}

function isPlain(v) {
	return v !== null && typeof v == "object" && !Array.isArray(v) && !(v instanceof Date)
		&& (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
}

function makeCtx(options) {
	return { dateFields: Array.isArray(options && options.dateFields) ? options.dateFields : [] };
}

function assertPath(field) {
	if (typeof field != "string" || !FIELD_PATH.test(field) || field.split(".").some((p) => BAD_KEYS.indexOf(p) >= 0)) {
		throw new DocQueryError("INVALID_FIELD", `invalid field name "${field}"`);
	}
}

function assertCollection(name) {
	if (typeof name != "string" || !COLLECTION_NAME.test(name) || name.startsWith("system.")) {
		throw new DocQueryError("INVALID_COLLECTION", `invalid collection name "${name}"`);
	}
}

function assertScoped(filter, options) {
	if (Object.keys(filter).length <= 0 && !options.allowAll) {
		throw new DocQueryError("FILTER_REQUIRED", "an empty filter would affect every document - pass options.allowAll to confirm");
	}
}

function clampLimit(limit) {
	const n = parseInt(limit);
	if (!(n > 0)) return DEFAULT_LIMIT;
	return Math.min(n, MAX_LIMIT);
}

// ---------------------------------------------------------------- dates

function isDateField(key, ctx) {
	return ctx.dateFields.indexOf(key) >= 0 || DATE_FIELD_HINT.test(String(key));
}

//Returns a Date for Date objects, moment-like objects (anything with toDate()) and datetime
//strings, or null when value is not a date. A bare YYYY-MM-DD is only read when allowDateOnly;
//endOfDay makes it 23:59:59.999 instead of midnight. Zone-less strings are local time.
function toDate(value, endOfDay = false, allowDateOnly = false) {
	if (value instanceof Date) return isNaN(value) ? null : value;
	if (value && typeof value == "object" && typeof value.toDate == "function") {
		const d = value.toDate();
		return d instanceof Date && !isNaN(d) ? d : null;
	}
	if (typeof value != "string") return null;

	if (DT_FULL.test(value)) {
		//"+0530" -> "+05:30" and a space separator -> "T", the forms Date parses consistently
		const iso = value.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
		const d = new Date(iso);
		return isNaN(d) ? null : d;
	}
	if (allowDateOnly && DT_DATE.test(value)) {
		const [y, mo, day] = value.split("-").map(Number);
		const d = endOfDay ? new Date(y, mo - 1, day, 23, 59, 59, 999) : new Date(y, mo - 1, day);
		//reject overflow such as 2026-02-31
		return d.getFullYear() === y && d.getMonth() === mo - 1 && d.getDate() === day ? d : null;
	}
	return null;
}

//Date conversion for one value (recursing into arrays); other values pass through
function convertValue(value, key, ctx, endOfDay = false) {
	if (Array.isArray(value)) return value.map((v) => convertValue(v, key, ctx, endOfDay));
	const d = toDate(value, endOfDay, isDateField(key, ctx));
	return d || value;
}

// ---------------------------------------------------------------- documents

//Deep-copy a document for insert: dates converted, "$"/dotted/prototype keys rejected
function cleanDoc(doc, ctx) {
	const out = {};
	each(doc, (value, key) => {
		if (key.startsWith("$") || key.indexOf(".") >= 0 || key.indexOf("\0") >= 0 || BAD_KEYS.indexOf(key) >= 0) {
			throw new DocQueryError("INVALID_FIELD", `invalid field name "${key}" in document`);
		}
		out[key] = cleanValue(value, key, ctx);
	});
	return out;
}

function cleanValue(value, key, ctx) {
	if (isPlain(value)) return cleanDoc(value, ctx);
	if (Array.isArray(value)) return value.map((v) => cleanValue(v, key, ctx));
	return convertValue(value, key, ctx);
}

//Prepares one document for insert, adding audit fields unless options.timestamps === false
function buildDocument(doc, options, ctx, now) {
	if (!isPlain(doc)) throw new DocQueryError("INVALID_DATA", "document must be a plain object");
	const out = cleanDoc(doc, ctx);
	if (options.timestamps !== false) {
		const user = options.user || "system";
		if (out.created_on === undefined) out.created_on = now;
		if (out.created_by === undefined) out.created_by = user;
		if (out.edited_on === undefined) out.edited_on = now;
		if (out.edited_by === undefined) out.edited_by = user;
	}
	return out;
}

function flatten(obj, prefix, out) {
	each(obj, (value, key) => {
		const p = prefix ? prefix + "." + key : key;
		if (isPlain(value) && Object.keys(value).length > 0) flatten(value, p, out);
		else out[p] = value;
	});
	return out;
}

// ---------------------------------------------------------------- filters

function buildFilter(where, ctx) {
	if (where == null) return {};
	if (!isPlain(where)) throw new DocQueryError("INVALID_FILTER", "filter must be a plain object");

	const filter = {};
	each(where, (value, key) => {
		if (LOGIC_OPS.indexOf(key) >= 0) {
			if (!Array.isArray(value) || value.length <= 0) throw new DocQueryError("INVALID_FILTER", `${key} needs a non-empty array of filters`);
			filter[key] = value.map((f) => buildFilter(f, ctx));
			return;
		}
		if (String(key).startsWith("$")) throw new DocQueryError("INVALID_FILTER", `operator "${key}" is not allowed at the top level`);

		assertPath(key);
		Object.assign(filter, fieldCondition(key, value, ctx));
	});
	return filter;
}

function fieldCondition(key, value, ctx) {
	if (value === null) return { [key]: null };

	if (Array.isArray(value)) {
		if (value.length == 2 && typeof value[1] == "string" && PAIR_OPS.indexOf(normOp(value[1])) >= 0) {
			return pairCondition(key, value[0], normOp(value[1]), ctx);
		}
		return { [key]: { $in: convertValue(value, key, ctx) } };
	}

	if (isPlain(value)) return { [key]: operatorObject(key, value, ctx) };

	return { [key]: convertValue(value, key, ctx) };
}

function operatorObject(key, obj, ctx) {
	const out = {};
	each(obj, (v, op) => {
		if (VALUE_OPS.indexOf(op) < 0) throw new DocQueryError("INVALID_FILTER", `operator "${op}" is not allowed on "${key}"`);

		switch (op) {
			case "$regex":
				out.$regex = safeRegex(v);
				break;
			case "$options":
				if (!/^[imsx]*$/.test(String(v))) throw new DocQueryError("INVALID_FILTER", "invalid $regex options");
				out.$options = String(v);
				break;
			case "$not":
				if (!isPlain(v)) throw new DocQueryError("INVALID_FILTER", "$not needs an operator object");
				out.$not = operatorObject(key, v, ctx);
				break;
			case "$elemMatch":
				if (!isPlain(v)) throw new DocQueryError("INVALID_FILTER", "$elemMatch needs an object");
				out.$elemMatch = buildFilter(v, ctx);
				break;
			case "$exists":
				out.$exists = !!v;
				break;
			case "$size":
				out.$size = parseInt(v);
				break;
			case "$in": case "$nin": case "$all":
				if (!Array.isArray(v)) throw new DocQueryError("INVALID_FILTER", `${op} needs an array`);
				out[op] = convertValue(v, key, ctx);
				break;
			default:
				if (isPlain(v)) throw new DocQueryError("INVALID_FILTER", `${op} on "${key}" needs a plain value`);
				out[op] = convertValue(v, key, ctx);
		}
	});
	return out;
}

function normOp(op) {
	return String(op).trim().replace(/\s+/g, " ").toUpperCase();
}

function pairCondition(key, val, op, ctx) {
	const conv = (v, eod) => convertValue(v, key, ctx, eod);
	const list = () => Array.isArray(val) ? val : [val];

	switch (op) {
		case "=": return { [key]: conv(val) };
		case "!=": case "<>": return { [key]: { $ne: conv(val) } };
		case ">": return { [key]: { $gt: conv(val) } };
		case ">=": return { [key]: { $gte: conv(val) } };
		case "<": return { [key]: { $lt: conv(val) } };
		case "<=": return { [key]: { $lte: conv(val) } };
		case "IN": return { [key]: { $in: conv(list()) } };
		case "NOT IN": return { [key]: { $nin: conv(list()) } };
		case "LIKE": return { [key]: { $regex: likeToRegex(val) } };
		case "NOT LIKE": return { [key]: { $not: { $regex: likeToRegex(val) } } };
		case "CONTAINS": return { [key]: { $regex: escapeRegex(val), $options: "i" } };
		case "STARTS": return { [key]: { $regex: "^" + escapeRegex(val), $options: "i" } };
		case "ENDS": return { [key]: { $regex: escapeRegex(val) + "$", $options: "i" } };
		case "REGEX": return { [key]: { $regex: safeRegex(val) } };
		case "EXISTS": return { [key]: { $exists: !!val } };
		case "IS NULL": return { [key]: null };
		case "IS NOT NULL": return { [key]: { $ne: null } };
		case "BETWEEN": case "NOT BETWEEN": {
			if (!Array.isArray(val) || val.length != 2) throw new DocQueryError("INVALID_FILTER", `${op} on "${key}" needs [from, to]`);
			const range = { $gte: conv(val[0], false), $lte: conv(val[1], true) };
			return { [key]: op == "BETWEEN" ? range : { $not: range } };
		}
	}
}

function escapeRegex(s) {
	return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function likeToRegex(pattern) {
	return "^" + escapeRegex(pattern).replace(/%/g, ".*").replace(/_/g, ".") + "$";
}

//Free-form regex comes from callers; cap size and refuse nested quantifier shapes like (a+)+
function safeRegex(src) {
	if (typeof src != "string" || src.length > 200) throw new DocQueryError("INVALID_FILTER", "regex must be a string of at most 200 characters");
	if (/\([^)]*[+*][^)]*\)[+*{]/.test(src)) throw new DocQueryError("INVALID_FILTER", "regex with nested quantifiers is not allowed");
	return src;
}

// ---------------------------------------------------------------- updates

//data: fields to set. Nested objects replace the whole sub object, unless options.merge is true,
//which flattens them to dot paths so sibling keys survive.
function buildUpdate(data, options, ctx) {
	const update = {};
	const set = {};

	if (data != null) {
		if (!isPlain(data)) throw new DocQueryError("INVALID_DATA", "update data must be a plain object");
		const source = options.merge ? flatten(data, "", {}) : data;
		each(source, (value, key) => {
			assertPath(key);
			set[key] = cleanValue(value, key.split(".").pop(), ctx);
		});
	}

	if (options.timestamps !== false) {
		if (set.edited_on === undefined) set.edited_on = new Date();
		if (set.edited_by === undefined) set.edited_by = options.user || "system";
	}
	if (Object.keys(set).length > 0) update.set = set;

	UPDATE_OPS.forEach((opt) => {
		if (!options[opt]) return;
		if (!isPlain(options[opt])) throw new DocQueryError("INVALID_DATA", `options.${opt} must be an object of {path: value}`);
		update[opt] = {};
		each(options[opt], (v, path) => {
			assertPath(path);
			update[opt][path] = cleanValue(v, path.split(".").pop(), ctx);
		});
	});

	if (options.unset) {
		const paths = Array.isArray(options.unset) ? options.unset : [options.unset];
		paths.forEach(assertPath);
		update.unset = paths;
	}

	if (options.upsert && options.timestamps !== false) {
		update.setOnInsert = { created_on: new Date(), created_by: options.user || "system" };
	}

	if (Object.keys(update).length <= 0) throw new DocQueryError("DATA_NOT_FOUND", "nothing to update");
	return update;
}

// ---------------------------------------------------------------- grouping

//Normalises an aggregateBy spec. Spec shape:
//  where:   filter
//  groupBy: ["level", "meta.service"]                      dot paths allowed
//  date:    { field: "created_on", unit: "day", as: "day", timezone: "Asia/Kolkata" }
//  metrics: { total: "count", amount: "sum:amount", slowest: "max:meta.ms" }
//           or { avgMs: { op: "avg", field: "meta.ms" } }. Default: { count: "count" }
//  sort:    "count DESC" | { count: -1 },  limit
//Returns { filter, groupBy: [{ field, key }], date, metrics: [{ alias, op, field }], sort, limit }.
//Result rows are flat: group keys use the dotted field with "." replaced by "_".
function buildGroupSpec(spec, ctx) {
	const groupBy = (spec.groupBy || []).map((field) => {
		assertPath(field);
		return { field, key: field.replace(/\./g, "_") };
	});

	let date = null;
	if (spec.date) {
		assertPath(spec.date.field);
		const unit = spec.date.unit || "day";
		if (DATE_UNITS.indexOf(unit) < 0) throw new DocQueryError("INVALID_DATE_UNIT", `date unit must be one of ${DATE_UNITS.join(", ")}`);
		date = { field: spec.date.field, unit, as: spec.date.as || "period", timezone: spec.date.timezone ? String(spec.date.timezone) : null };
		assertPath(date.as);
	}

	const metrics = [];
	const defs = spec.metrics && Object.keys(spec.metrics).length > 0 ? spec.metrics : { count: "count" };
	each(defs, (def, alias) => {
		assertPath(alias);
		if (alias.indexOf(".") >= 0) throw new DocQueryError("INVALID_FIELD", `metric alias "${alias}" cannot contain a dot`);
		let op, field;
		if (typeof def == "string") [op, field] = def.split(":");
		else { op = def.op; field = def.field; }

		if (op != "count") {
			if (METRIC_OPS.indexOf(op) < 0) throw new DocQueryError("INVALID_METRIC", `unsupported metric "${op}"`);
			assertPath(field);
		}
		metrics.push({ alias, op, field: op == "count" ? null : field });
	});

	const keys = groupBy.map((g) => g.key).concat(date ? [date.as] : []);
	return {
		filter: buildFilter(spec.where || {}, ctx),
		groupBy,
		date,
		metrics,
		sort: parseSort(spec.sort) || (keys.length > 0 ? { [keys[keys.length - 1]]: 1 } : null),
		limit: clampLimit(spec.limit)
	};
}

// ---------------------------------------------------------------- columns / sort / output

function buildColumns(columns) {
	if (!columns || columns == "*") return null;

	let list;
	if (isPlain(columns)) list = Object.keys(columns).filter((k) => columns[k]);
	else list = Array.isArray(columns) ? columns : String(columns).split(",").map((c) => c.trim()).filter(Boolean);

	list.forEach(assertPath);
	return list.length > 0 ? list : null;
}

//"created_on DESC, level" | { created_on: -1 } -> { created_on: -1, level: 1 }
function parseSort(sort) {
	if (!sort) return null;

	if (isPlain(sort)) {
		const out = {};
		each(sort, (dir, field) => {
			assertPath(field);
			out[field] = (dir === -1 || String(dir).toUpperCase() === "DESC") ? -1 : 1;
		});
		return out;
	}

	const out = {};
	String(sort).split(",").forEach((part) => {
		const tokens = part.trim().split(/\s+/);
		if (!tokens[0]) return;
		assertPath(tokens[0]);
		out[tokens[0]] = (tokens[1] || "ASC").toUpperCase() == "DESC" ? -1 : 1;
	});
	return Object.keys(out).length > 0 ? out : null;
}

//Dates -> ISO string (options.dateFormat: a function(date) or "epoch" to override). Id objects
//(ObjectId and the like) -> string. A row with no "id" of its own gets id = String(_id), and a
//scalar _id is then dropped; an object _id (an aggregation group key) is kept.
function serialize(value, options) {
	if (options && options.raw) return value;
	return convertOut(value, options && options.dateFormat, true);
}

function convertOut(value, dateFormat, topLevel) {
	if (value instanceof Date) {
		return typeof dateFormat == "function" ? dateFormat(value) : dateFormat === "epoch" ? value.getTime() : value.toISOString();
	}
	if (Array.isArray(value)) return value.map((v) => convertOut(v, dateFormat, topLevel));
	if (value && typeof value == "object") {
		if (value._bsontype === "ObjectId" || value._bsontype === "ObjectID") return String(value);
		const out = {};
		each(value, (v, k) => { out[k] = convertOut(v, dateFormat, false); });
		if (topLevel && out._id !== undefined && typeof out._id != "object") {
			if (out.id === undefined) out.id = String(out._id);
			delete out._id;
		}
		return out;
	}
	return value;
}

module.exports = {
	DocQueryError,
	isPlain,
	makeCtx,
	assertPath,
	assertCollection,
	assertScoped,
	clampLimit,
	toDate,
	buildDocument,
	buildFilter,
	buildUpdate,
	buildGroupSpec,
	buildColumns,
	parseSort,
	serialize
};
