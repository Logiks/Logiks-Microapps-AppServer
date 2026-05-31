# 10. Audit & Logs

> Audience: **app developers** and **platform engineers**. This chapter covers what the framework logs, how it logs it, and how a plugin emits and reads logs.

Logiks logs through **three independent layers**. Knowing which layer to reach for — and which log tables are actually wired versus reserved for future use — is the point of this chapter.

---

## 10.1 The Three Logging Layers

| Layer | Where it writes | Entry point | Use it for |
|---|---|---|---|
| **File logs** | Rotating files on disk + console | `LOGGER` / `_LOGGER` (Winston) | Operational diagnostics, server lifecycle, debugging |
| **Database logs** | `logdb` tables (`log_*`) | `ctx.emit("logs.<kind>", payload)` → the `logs` service | Durable audit/activity trails, queryable history |
| **Frontend logs** | `logdb` tables (allow-listed) | `_DBLOGGER._log(...)` via the log-ingest endpoint | Client-side activity/errors sent up from the browser |

File logs are always on. Database logs are written by an event-driven service. Frontend logs are ingested through a guarded helper. Each is described below.

---

## 10.2 File Logs (Winston)

File logging lives in [api/logger.js](../api/logger.js). It exposes **named loggers** built from `CONFIG.logger` and a fallback `core` logger.

**Levels** (most → least severe): `fatal, error, warn, info, debug, trace`.

**Getting a logger:**

```javascript
LOGGER.get("server").info("Worker registered", payload);
LOGGER.get("server").error("Migration failed", err);
// _LOGGER is the global "core" logger; LOGGER.get(<unknown>) also falls back to "core"
```

`LOGGER.get(key)` returns the named logger or the `core` logger if the key is unknown ([api/logger.js:56-59](../api/logger.js#L56-L59)). Named loggers are declared under `CONFIG.logger` in `config.json`; each key maps to a list of transports:

```json
"logger": {
  "default": [
    { "level": "info",  "path": "./logs/info.log" },
    { "level": "debug", "stream": "stdout" },
    { "level": "error", "path": "./logs/error.log", "period": "1d" }
  ]
}
```

**Transport rules** ([api/logger.js:65-129](../api/logger.js#L65-L129)):

- `stream: "stdout"` → colorized console output.
- `path` without `period` → a plain file transport.
- `path` **with** `period` → a **daily-rotating** file (`<name>-YYYY-MM-DD.log`), gzip-archived, `maxSize: 10m`, `maxFiles: 10d` (10-day retention).

So files land under `./logs/` by default and rotate/expire automatically. There is no DB involvement in this layer.

---

## 10.3 Database Logs — the `logs` Service

Durable logs are written by the [logs service](../api/services/logs.service.js), which is **event-driven**: producers `emit` an event on the cluster bus, and the service's handler writes a row to `logdb`. There are no public actions — only event handlers.

| Event | Target table | Payload shape (key fields) | In-repo producer |
|---|---|---|---|
| `logs.activity` | `log_activities` | `subject, category, subcategory, ref_src, ref_id, message, status, pre_data, post_data, trace_id` | ✅ [dbops.service.js](../api/services/dbops.service.js) emits on create/update/delete |
| `logs.audit` | `log_audit` | `nature, ref_src→entity_type, ref_id→entity_id, pre_data→before_state, data→after_state, trace_id` | ⚠️ handler ready, **no in-repo emitter** |
| `logs.trace` | `log_temp` | `uri, req_body, xtras_1..3` | ⚠️ handler ready, no in-repo emitter |
| `logs.error` | `log_errors` | `error_key, entity_type, error_code, error_message, stack_trace, request_id, severity` | ⚠️ handler ready, no in-repo emitter |

"Handler ready, no in-repo emitter" means the plumbing exists and the table is written the moment anything emits the event — it is available to plugins today, just not yet emitted by core code.

Every row is stamped with `appid`, `guid`, `created_on/by`, `edited_on/by` from the payload or `ctx`.

---

## 10.4 Audit & Activity Integrity

`log_audit` and `log_activities` are designed to be **tamper-evident**. Each captures the state on both sides of a change and stores a SHA-1 hash of each side:

- `log_audit` → `before_state` / `after_state` with `before_hash` / `after_hash`.
- `log_activities` → `pre_data` / `post_data` with `pre_hash` / `post_hash`.

The handler inserts the row, then computes the hashes in the database itself ([logs.service.js:47](../api/services/logs.service.js#L47), [logs.service.js:80](../api/services/logs.service.js#L80)):

```sql
UPDATE log_audit SET before_hash = sha1(before_state), after_hash = sha1(after_state)
WHERE before_hash IS NULL OR length(before_hash) <= 0;
```

Because the hash is derived from the stored JSON, after-the-fact edits to a state column can be detected by recomputing the hash. This is the audit-integrity feature of the platform and the reason audit/activity rows carry both the data and its digest.

---

## 10.5 Frontend Logs & the `_DBLOGGER` Helper

Client-submitted logs to the api endpoint `/api/log/:logId` go through [_dbLogger.js](../api/helpers/_dbLogger.js), exposed as the global `_DBLOGGER`:

```javascript
_DBLOGGER._log(logID, payload, ctx);   // writes to table log_<logID>
```

It is deliberately **guarded** — a write succeeds only if both are true:

1. The table `log_<logID>` physically exists (discovered via `SHOW TABLES` at `initialize`).
2. `logID` is in the `ALLOWED_LOGS` allowlist — seeded with `log_activities_user` and `log_errors_frontend`, plus any `*frontend*` table found at boot.

The browser reaches this through the log-ingest action in [utils.service.js](../api/services/utils.service.js#L95-L110): `type: "db"` routes to `_DBLOGGER._log`, while `type: "local"` routes to the file logger (`LOGGER.log`).

> **Caveat:** `log_activities_user` and `log_errors_frontend` are **not** in the shipped [schema_logdb_100.json](../misc/dbschema/schema_logdb_100.json). Until those tables are created in `logdb`, `_DBLOGGER._log` silently returns `false` (no error). Create them (or ship them in a plugin `dbschema`) before relying on frontend logging.

---

## 10.6 Log Catalogue

`logdb` ships **22** `log_*` tables ([schema_logdb_100.json](../misc/dbschema/schema_logdb_100.json)), but most are reserved table definitions with no writer yet. Honest status:

| Table | Status |
|---|---|
| `log_activities` | **Active** — emitted by `dbops` on data changes; emit `logs.activity` to add your own |
| `log_audit` | **Handler ready** — emit `logs.audit` to write (tamper-evident) |
| `log_errors` | **Handler ready** — emit `logs.error` to write |
| `log_temp` | **Handler ready** — emit `logs.trace` to write |
| `log_frontend_activities_user`, `log_frontend_errors`, `log_frontend_analytics` | **Frontend ingest** via `_DBLOGGER` — *table not in shipped schema; create to enable* |
| `log_apibox`, `log_autojobs`, `log_config_changes`, `log_data_changes`, `log_devices`, `log_rate_limit`, `log_security_roles`, `log_logins`, `log_messages`, `log_notifications`, `log_migration`, `log_integrations`, `log_files`, `log_webhooks` | **Reserved** — schema defined, no writer; intended to be written by the owning module/plugin |
| `log_export`, `log_feedbacks`, `log_system`, `log_tenant` | **Planned** — flagged "Waiting" in [logs.service.js:13-18](../api/services/logs.service.js#L13-L18) |

The "Reserved"/"Planned" rows are real database tables but are **not** populated by the framework today — do not assume data is flowing into them.

---

## 10.7 How a Plugin Logs

**Write an activity log** from any handler (controller `api.js` function or service action):

```javascript
ctx.emit("logs.activity", {
    subject: "invoice_created",
    category: "billing",
    ref_src: "billing@invoices",     // entity/source reference
    ref_id: invoiceId,
    message: `Invoice ${invoiceId} created`,
    pre_data: {},                    // hashed → pre_hash
    post_data: invoice,              // hashed → post_hash
    appid: ctx.meta.appInfo.appid,
    guid: ctx.meta.user.guid,
    userId: ctx.meta.user.userId
});
```

**Write an audit log** (state-change with tamper-evident hashing):

```javascript
ctx.emit("logs.audit", {
    nature: "update",
    ref_src: "billing.invoice",      // → entity_type
    ref_id: invoiceId,               // → entity_id
    pre_data: before,                // → before_state / before_hash
    data: after,                     // → after_state  / after_hash
    appid: ctx.meta.appInfo.appid,
    guid: ctx.meta.user.guid,
    userId: ctx.meta.user.userId
});
```

**Write a file log** (operational, not durable):

```javascript
LOGGER.get("server").warn("Slow query", { ms, sql });
```

**Read logs** like any other table, through the `_DB` global against `logdb`:

```javascript
const rows = await _DB.db_selectQ("logdb", "log_activities", "*",
    { appid: ctx.meta.appInfo.appid }, { orderby: "created_on DESC", limit: 50 });
```

Events fan out across the whole cluster (see [§7 Event System](07-event-system.md)), so a plugin on any Worker can emit `logs.*` and the AppServer's `logs` service will persist it.

---

> Logs split cleanly by purpose: **file logs** for diagnostics, **`logs.*` events** for durable audit/activity trails (with SHA-1 integrity), and **`_DBLOGGER`** for guarded frontend ingestion. Treat the reserved/planned tables as roadmap, not features.
