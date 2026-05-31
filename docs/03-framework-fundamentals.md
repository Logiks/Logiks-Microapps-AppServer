# 3. Framework Fundamentals

> Audience: **platform engineers** primarily; **app developers** should still read §3.1 and §3.2 to understand the runtime they are deploying into.

---

## 3.1 Application Structure

### AppServer (Gateway) Layout

```
Microapps-AppServer/
├── index.js                  Process entry: env validation, globals, main()
├── package.json              Dependencies and npm scripts
├── ecosystem.config.js       PM2 cluster definition
├── config.json               Application config (CONFIG.* keys)
├── config_sample.json        Template for config.json
├── system.json               Core module catalog (forms, reports, dashboards…)
├── .env / env_sample         Process environment
├── api/
│   ├── baseapp.js            Bootstraps helpers, controllers, applications.json
│   ├── server.js             Main broker, API routes, auth/authorize/rate-limit
│   ├── commons.js            Global helpers (DBKEYS, printObj, _dbkeys())
│   ├── cache.js              Redis client and CACHESTORE map
│   ├── logger.js             Winston logger registry
│   ├── helpers/              Loaded as uppercased globals (_DB, MISC, ENCRYPTER…)
│   ├── controllers/          Loaded as uppercased globals (BASEAPP, AUTHKEY…)
│   └── services/             Main services auto-loaded by **/*.service.js
├── misc/
│   ├── applications.json     Front-end application configs (branding, theme, domain)
│   ├── apps/<appid>/         Front-end application UI shell (pages/layouts/components/i18n)
│   ├── automators/           Background job definitions (node-cron)
│   ├── dbschema/             JSON schemas for appdb + logdb
│   ├── themes/               CSS themes
│   └── webhelpers/           Page-side helper code + routes.json
├── public/                   Static assets served at /
├── logs/                     Winston log output (daily rotated)
├── uploads/                  File upload destination
└── temp/                     Temporary file scratch space
```

### Worker Layout

Workers built from the [Logiks-Microapps-Worker-NodeJS](https://github.com/Logiks/Logiks-Microapps-Worker-NodeJS) boilerplate use a similar but pared-down layout:

```
my-worker/
├── index.js                  Broker bootstrap (no HTTP)
├── logiks.json               Manifest: declares what the worker hosts
├── package.json
├── services/                 Worker-owned services (.service.js files)
├── controllers/              Worker-local helpers as globals
├── helpers/                  Worker-local utilities as globals
├── plugins/                  Microapps the worker hosts
│   └── demo/                 Each subfolder is a microapp
├── www/                      Static assets (if the worker serves any)
└── .env
```

A Worker that hosts no microapps directly — i.e. just exposes services — only needs `services/` and `index.js`.

### Module Structure

A microapp (plugin) is a folder under a Worker's `plugins/` with a `logiks.json` manifest. Its layout:

| File / folder | Contents |
|---|---|
| `logiks.json` | Manifest — registers the plugin; declares dependencies, policies, navigation |
| `api.js` | Server logic (functions invoked by routes and events) |
| `routes.json` | HTTP routes and event subscriptions |
| `dbschema/` | The plugin's own table schemas (applied by `DBMIGRATOR`) |
| `forms/` `reports/` `dashboards/` `pages/` `menu/` | UI definitions served via the `source` action |
| `component/` | Custom React (`.jsx`) components |
| `www/` | Static assets served via the `www` action |

Full anatomy and the definition syntax are in [§4 MicroApp / Plugin](04-microapps.md) and [training §6](training/6-building-blocks.md).

Note the separate AppServer concept: `misc/apps/<appid>/` holds the UI shell for a *front-end application* (a branded, domain-bound entry surface configured in `misc/applications.json`). That is not where plugin code lives — plugins live in a Worker's `plugins/`.

### Shared Libraries

There is no separate "shared library" package today. Code reuse across microapps is achieved through:

1. **Platform globals** — every file in [api/helpers/](../api/helpers/) and [api/controllers/](../api/controllers/) is autoloaded by [api/baseapp.js:9-47](../api/baseapp.js#L9-L47) as a global with its filename uppercased. `messaging.js` → `MESSAGING`; `_db.js` → `_DB`; `aicore.js` → `AICORE`. Microapps consume them directly — `MESSAGING.sendMessage(...)`, `_DB.db_selectQ(...)` — without `require`. This is the central code-reuse mechanism. The full reference is in [§3.4 Controllers & Helpers Reference](#34-controllers--helpers-reference).
2. **action calls** — one microapp invoking another via `ctx.call("other.action", …)`.
3. **Cluster-wide global invocation** — even globals loaded on *another* node are callable from your node via the `system.helpers` and `system.controllers` actions (covered in §3.4).
4. **The vendors registry** — third-party integrations registered in `sys_vendors` and surfaced through [api/controllers/vendors.js](../api/controllers/vendors.js).

> Roadmap: an npm-registry-backed "shared modules" mechanism is referenced in the documentation outline but not implemented.

### Config Files

| File | Purpose | Loaded by |
|---|---|---|
| `.env` | Process-level vars (ports, secrets, transporter) | dotenv in [index.js:8](../index.js#L8) |
| `config.json` | Application config — CORS, auth, DB, cache, mail, storage | [index.js:60-83](../index.js#L60-L83) |
| `system.json` | Core module catalog | [index.js:77](../index.js#L77) |
| `package.json` | Dependency tree (name, version mixed into CONFIG) | [index.js:78](../index.js#L78) |

At boot, the three JSON sources plus the env are merged into the global `CONFIG` object using lodash `_.extend`. Env wins on `SERVER_ID`, `ROOT_PATH`, `VERSION`, `BUILD`.

### Environment

`.env` is loaded by `dotenv` and validated against a required list in [index.js:13-19](../index.js#L13-L19): `SERVER_ID`, `TRANSPORTER`, `NODE_ENV` are mandatory. Missing keys abort startup. The full env vocabulary is documented in §3.2 below.

### Control Layer

The "Control Layer" mentioned in the master outline refers to the *admin services* under [api/services/admin/](../api/services/admin/) — `admin.service.js`, `apps.service.js`, `controls.service.js`, `nodes.service.js`, `files.service.js`, `media.service.js`, `plugins.service.js`. These expose admin-scoped actions to the cluster operator: list/install/remove microapps, inspect node health, manage uploaded media, etc.

There is no separate Control Center UI shipped in this repo. The admin services are the API surface; a AdminCP microapp is there to be user as Control Layer.

### Key Manager

[api/controllers/keyManager.js](../api/controllers/keyManager.js) provides a minimal symmetric-secret derivation surface — `getKey(name)` returns `sha1(name + CONFIG.SALT_KEY)`. It is intentionally minimal and currently serves as the integration point for future HSM/vault adapters. For production secret management today, use environment variables (`.env`) or the `ENC_SALT` mechanism in [api/helpers/encrypter.js](../api/helpers/encrypter.js).

---

## 3.2 Configuration System

Logiks separates *process configuration* (`.env`) from *application configuration* (`config.json`) from *core module catalogue* (`system.json`).

### Global Configuration — `config.json`

The application config is the largest knob set. The shipped [config_sample.json](../config_sample.json) is annotated below:

| Key | Purpose |
|---|---|
| `debug`, `remoteDebug`, `audit` | Diagnostic toggles |
| `log_requests`, `log_sql`, `intercept_axios_request/response` | Logging verbosity |
| `default_lang` | Default i18n locale |
| `base_url` | Canonical app URL (used in email templates, redirects) |
| `mfa.{strategy, mfa_length, mfa_default_type}` | MFA policy (`totp`, `email`, `sms`, `none`) |
| `disable_cache.{application, modules, navigator}` | Per-cache invalidation switches |
| `cors.{origin, methods, credentials, allowedHeaders, exposedHeaders}` | Applied by the gateway service |
| `noauth` | Action whitelist for the `/api/public` route group |
| `ipwhitelisting` | Per-route IP allow lists |
| `authjwt.{algorithm, secret, access_token_ttl, refresh_token_ttl}` | JWT issuance |
| `mail.{host, port, secure, auth, default_from}` | SMTP for `MESSAGING.sendEmail` |
| `storage.{driver, base_path}` | File storage (`local` is the only built-in driver) |
| `dbmysql.appdb`, `dbmysql.logdb` | Two MySQL connections (each `{enable, host, port, user, password, database, insecureAuth, multipleStatements}`) |
| `dbmongo.{enable, uri}` | Optional MongoDB connection (off by default) |
| `cache.{host, port, family, db, enableOfflineQueue}` | Redis client config |
| `queue.{enable, host}` | Optional AMQP queue (off by default) |
| `logger.<name>` | Winston transports keyed by logger name (`default`, `core`, …) |

### Worker Configuration

A Worker built from the boilerplate uses the same layout but consumes a smaller subset — typically `cache`, `dbmysql`, and `logger`. Workers do not own the gateway, so `cors`, `noauth`, `ipwhitelisting`, `authjwt`, `mfa`, and `mail` are usually not set on Workers (they read these from the cluster through service calls when needed).

### Runtime Configuration — `system.json`

`system.json` lists core modules the runtime should pre-register: forms, reports, dashboards, query builder definitions, the JSON modules consumed by the [`MODULES`](../api/services/modules.service.js) service. Treat it as a static catalogue, not a tunable knob.

### Environment Variables

The full vocabulary from [env_sample](../env_sample):

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | yes | `production` | Standard Node env |
| `SERVER_ID` | yes | — | Unique node id within the cluster |
| `RUN_MODE` | no | `server` | Reserved for future Worker/CLI modes |
| `PORT` | no | `3000` | HTTP port |
| `HOST` | no | `0.0.0.0` | Bind interface |
| `ENC_SALT` | no | — | Master salt for `ENCRYPTER` (set in production) |
| `CLUSTER_TOKEN` | no | — | Shared secret in broker metadata for cluster joining |
| `CLUSTER_CACHE` | no | `false` | If `true`, enable Redis cacher |
| `CLUSTER_CACHE_TTL` | no | `60` | Cacher TTL in seconds |
| `CORE_LOGGER_LEVEL` | no | `error` | Pre-init logger level |
| `SERVER_CONSOLE_LOG_LEVEL` | no | `debug` (dev) / `error` (prod) | Broker console log level |
| `TRANSPORTER` | yes | — | Main transporter URL (`redis://`, `nats://`, `mqtt://`, `tcp://`) |
| `NAMESPACE` | no | `default` | Main namespace (cluster isolation) |
| `CONFIG_TYPE` | no | — | `LOCAL` or `REMOTE` |
| `CONFIG_FILE` | yes (if CONFIG_TYPE set) | — | Path or URL to `config.json` |
| `RATE_LIMIT_WINDOW_MS` | no | `60000` | Distributed rate-limit window |
| `RATE_LIMIT_MAX` | no | `300` | Max requests per identifier per window |
| `SESSION_SECRET` | no | — | Express session signing key |
| `MIGRATION_MODE` | no | — | `IMPORT` to apply schema, `EXPORT` to dump current DB |

### Secrets / Keys Management

Three layers, in priority order:

1. **Process env** — for high-impact secrets (`ENC_SALT`, `CLUSTER_TOKEN`, `SESSION_SECRET`, DB passwords if you templated them into `config.json` via env interpolation).
2. **`config.json`** — for less-sensitive shared config. Treat the file as a secret in your secrets manager; do not commit a populated `config.json` to git.
3. **`ENCRYPTER`** (AES-256-GCM, [api/helpers/encrypter.js](../api/helpers/encrypter.js)) — for encrypting payload-level data at rest. Uses `ENC_SALT` as master secret.

The `KEYMANAGER` global is a thin SHA-1-based derivation helper; do not use it as a vault — see §3.1.

### Dynamic Config Reloading

Three categories of dynamic config:

1. **Vendors** ([api/controllers/vendors.js](../api/controllers/vendors.js)) — reloaded from `sys_vendors` table.
2. **Rules** ([api/helpers/ruleEngine.js](../api/helpers/ruleEngine.js)) — fetched on each `processRule` call (cached in-process); use `RULEENGINE.reload(ruleID)` to invalidate.
3. **RBAC policies** ([api/controllers/rbac.js](../api/controllers/rbac.js)) — `reloadPolicies(ctx)` re-reads the policy set.

Reloading of `.env`, `config.json`, or `system.json` requires a process restart. PM2 `pm2 reload` performs zero-downtime restarts when run against a cluster-mode app.

### Control Center Variables

The admin services (`admin.controls`, `admin.controls.set`, etc.) expose a key-value store for runtime-tunable variables backed by the `sys_settings` MySQL table. Microapps read these through [api/controllers/settings.js](../api/controllers/settings.js). Changes propagate via the broker cache (invalidate on write).

---

## 3.3 Dependency Management

### Packages

Server-side dependencies are managed through plain npm. The top-level [package.json](../package.json) pins:

- **HTTP & security** — `express-session`, `helmet`, `cookie-parser`, `cors`, `multer`
- **Data** — `mysql`, `mysql2`, `ioredis`, `connect-redis`
- **Crypto/Auth** — `jsonwebtoken`, `bcrypt`, `js-sha512`, `sha1`, `totp-generator`
- **Templating** — `ejs`
- **Utilities** — `lodash`, `moment`, `uuid`, `validatorjs`, `json-rules-engine`, `xml2js`
- **Logging** — `winston`, `winston-daily-rotate-file`
- **Mail** — `nodemailer`
- **Misc** — `axios`, `node-cron`, `systeminformation`, `node-fetch`, `qs`, `semver`, `fs-extra`, `mime-types`

### Shared Modules

Code reuse across microapps happens through globals (see §3.1 → Shared Libraries). To share code between *Workers*, package the code as a private npm module and `npm install` it on each Worker; or commit the shared code into a folder loaded by `BASEAPP.initializeApplication`-style autoloader on Worker startup.

### Versioning

The AppServer's version is read from `package.json` and exposed as `CONFIG.VERSION` and `CONFIG.BUILD` (dot-stripped). A plugin declares its own version in `logiks.json` (`"version": "1.0"`). The front-end application config carries a separate `vers` integer in `applications.json`. The runtime does not enforce inter-plugin version compatibility.

### Runtime Resolution

When a service action is called via `ctx.call("name.action", …)`:

1. Broker registry resolves `name` to one or more nodes.
2. If multiple nodes host the same service, the strategy (`RoundRobin` by default) picks one.
3. If `name` is local, the call short-circuits to in-process invocation.
4. If `name` is remote, the call is serialised through the transporter and deserialised on the target.

Circuit breaker, retry, and bulkhead policies apply uniformly (see [api/server.js:103-120](../api/server.js#L103-L120)).

### Remote Packages

Installing a plugin from a remote registry (npm or custom) without staging files first is a roadmap item. Today installation is file-based: drop the plugin folder into a Worker's `plugins/` and (re)start the Worker, which loads it and announces it to the cluster ([§4.3](04-microapps.md#43-how-a-worker-loads-plugins)).

---

## 3.4 Controllers & Helpers Reference

The autoloaded globals are the platform's public API for microapps. This section documents the loading mechanism, the cluster-public protocol, and the catalogue of what's available today.

### Autoload Mechanism

Two folders are scanned at boot by [api/baseapp.js:9-47](../api/baseapp.js#L9-L47):

| Folder | Becomes | Convention |
|---|---|---|
| [api/helpers/](../api/helpers/) | `global.<UPPER_NAME>` | Filename uppercased; underscores preserved. `messaging.js` → `MESSAGING`; `_db.js` → `_DB`. |
| [api/controllers/](../api/controllers/) | `global.<UPPER_NAME>` | Same. `aicore.js` → `AICORE`; `singletonmanager.js` → `SINGLETONMANAGER`. |

Adding a new helper or controller is a single-file operation: drop a `.js` file in the right folder, restart the process, and the global is available everywhere.

Each module's `initialize()` is called once at boot, in load order. Helpers' return value is ignored. **Controllers may return `true` from `initialize()`** to mark themselves as cluster-public — the name lands in `_ENV.CONTROLLERS_PUBLIC`.

### Direct Use (Same Process)

Anywhere in framework, controller, helper, service, or microapp code running on the current node — call the method directly on the global. No `require` needed:

```javascript
// send an email
await MESSAGING.sendMessage("you@example.com", "Hello", "<p>Hi!</p>");

// query the appdb
const rows = await _DB.db_selectQ("appdb", "lgks_users", "*", { active: "true" }, {});

// look up an API key
const info = AUTHKEY.getAPIKeyInfo(req.headers["x-api-key"], "api");

// hash a value
const hash = await ENCRYPTER.generateHash(token);

// send to the AI layer
const reply = await AICORE.sendMessage("Summarise this", null, "support", {}, ctx);
```

### Cluster-Wide Use (Cross-Node)

Globals loaded on *another* Worker are reachable via two actions exposed by [api/services/system.service.js:157-236](../api/services/system.service.js#L157-L236):

| Action | What it does |
|---|---|
| `system.helpers` | `{ cmd: "list_helpers" }` returns `_ENV.HELPERS`; `{ cmd: "<HELPER>.<method>", params: [arg1, arg2, ...] }` invokes the helper method on the system service's node. |
| `system.controllers` | `{ cmd: "list_controllers" }` returns `_ENV.CONTROLLERS_PUBLIC`; `{ cmd: "<CONTROLLER>.<method>", params: [...] }` invokes a method, **only if** the controller is in `CONTROLLERS_PUBLIC`. |

Example — calling `USERS.getUserInfo` from a Worker that doesn't host `users.js`:

```javascript
const res = await ctx.call("system.controllers", {
    cmd: "USERS.getUserInfo",
    params: ["user-guid-123"]
});
// res = { status: "success", data: { ... } }
```

The system service is part of the AppServer's core services, so every Worker can reach it through the broker. This is what "publicly available across all worker nodes" means in practice.

**Prefer direct in-process calls** when the helper/controller is already loaded on your node (it usually is, since both folders ship with every Worker). Reach for `system.helpers` / `system.controllers` only when you need to invoke a global that's specifically deployed on the system-service node.

### initialize() Protocol

```javascript
// api/helpers/myhelper.js — initialize() optional; return value ignored
module.exports = {
    initialize: function() {
        // boot-time setup if needed
    },
    doThing: function(args) { /* ... */ }
};
```

```javascript
// api/controllers/mycontroller.js — return true from initialize() to be cluster-public
module.exports = {
    initialize: function() {
        // boot-time setup if needed
        return true;        // omit (or return falsy) to stay in-process only
    },
    doThing: function(args) { /* ... */ }
};
```

`initialize()` may be `async` — `BASEAPP` does not await it, but errors are caught and logged.

### Helpers Reference

All helpers in [api/helpers/](../api/helpers/) — cluster-reachable through `system.helpers`:

| Helper global | Purpose | Common methods |
|---|---|---|
| `_DB` | MySQL connection pools and query builders | `db_selectQ`, `db_insertQ1`, `db_updateQ`, `db_query`, `db_connection` |
| `_DBLOGGER` | Routes log events to `logdb` tables | `_log(logID, payload, ctx)` |
| `_HOOKS` | Pre/post hooks for DB operations | `register`, `run` |
| `CACHEMAP` | User-scoped Redis namespace abstraction | `get`, `set`, `clear` |
| `DATAMODELS` | JSON component definition + DB binding | `process`, `validate` |
| `DBHELPERS` | SQL builder utilities | `buildWhere`, `buildJoin`, `buildOrder` |
| `DBMIGRATOR` | Apply / export schemas from `misc/dbschema/` | `startMigration`, `saveMigrationScript`, `pluginMigration` |
| `DBOPS` | Stored parameterised query layer | `storeQuery`, `fetchQuery`, `executeQuery` |
| `DEBUGGER` | Dev-time logging helpers | `dump`, `trace` |
| `ENCRYPTER` | AES-256-GCM + hashing | `encrypt`, `decrypt`, `generateHash` |
| `FILES` | File system + upload root utilities | `read`, `write`, `delete`, `streamFile` |
| `JSONPROCESSOR` | JSON component policy filtering + query binding | `process`, `bindQueries` |
| `MESSAGING` | Outbound email (and registered vendors) | `sendMessage`, `sendEmail`, `loadDrivers` |
| `MISC` | Grab-bag utilities | `getClientIP`, `generateDefaultDBRecord`, `clean` |
| `QUERY` | Dynamic SQL query builder | `build`, `parse` |
| `RULEENGINE` | `json-rules-engine` integration | `processRule(ruleID, facts, addons)` |
| `TEMPLATES` | EJS-based template rendering | `render`, `renderString` |
| `UNIQUEID` | GUID / short id generation | `generate`, `uuid`, `short` |
| `URLSHORTNER` | Generate and resolve short URLs | `shorten`, `resolve` |
| `VALIDATIONS` | Input validation primitives | `validate`, `addRule` |
| `WORKERS` | Worker thread / child process pool | `loadWorker`, `dispatch`, `terminate` |

### Controllers Reference

All controllers in [api/controllers/](../api/controllers/). The **Cluster-public** column reflects whether `initialize()` returns `true` (and thus whether the controller is reachable via `system.controllers`):

| Controller global | Cluster-public | Purpose |
|---|---|---|
| `AICORE` | Conditional* | AI Layer — `sendMessage`, engine dispatch. See [§8](08-ai-layer.md). |
| `APIBOX` | ✅ | API versioning / sandboxing controls |
| `APPLICATION` | ❌ | App metadata loader (consumed by `application.service.js`) |
| `AUTHFEDERATED` | ✅ | Federated SSO engine catalogue + login response processing |
| `AUTHKEY` | ❌ | API key lookups and IP whitelist checks |
| `AUTHLOGIN` | ❌ | Local + federated login flows |
| `AUTOJOBS` | ❌ | `node-cron` job scheduler (singleton-elected) |
| `ENV` | ✅ | Environment variables loader (`loadEnvironment`) |
| `GEOFENCES` | ✅ | Spatial fence checks via MySQL spatial functions |
| `KEYMANAGER` | ❌ | Minimal symmetric-secret derivation (`getKey`) |
| `NAVIGATOR` | ✅ | Builds filtered navigation menus per user / device |
| `RBAC` | ✅ | Role / scope policy evaluation |
| `SETTINGS` | ✅ | Persistent settings store (per-user / per-app / global) |
| `SINGLETONMANAGER` | ✅ | Redis-backed cluster-singleton election |
| `TENANT` | ❌ | Tenant resolution + federated tenant mapping |
| `UPLOADS` | ❌ | Multer upload handlers + file move utilities |
| `USERS` | ✅ | User CRUD, federated user resolution |
| `VENDORS` | ❌ | Third-party integration registry (`sys_vendors`) |
| `WEBHOOKS` | ❌ | Inbound webhook reception + logging |

\* `AICORE.initialize()` returns `true` only when `CONFIG.aicore.enabled` is `true` *and* the configured engine resolves. If AI is disabled, `AICORE` is loaded but stays in-process.

### Discoverability at Runtime

A microapp running on any Worker can introspect the cluster-public surface dynamically:

```javascript
// list all helpers reachable through system.helpers
const helpers = await ctx.call("system.helpers", { cmd: "list_helpers", params: [] });
// helpers.data = ["_DB", "_DBLOGGER", "MESSAGING", "ENCRYPTER", ...]

// list cluster-public controllers
const ctrls = await ctx.call("system.controllers", { cmd: "list_controllers", params: [] });
// ctrls.data = ["APIBOX", "AUTHFEDERATED", "ENV", "GEOFENCES", "NAVIGATOR", ...]
```

This is also useful for AICore's tool catalog when AI agents need to know what platform capabilities they can invoke.

### Adding Your Own Globals

To extend the platform with a custom helper or controller:

1. Drop the file in [api/helpers/](../api/helpers/) (for utilities / data plumbing) or [api/controllers/](../api/controllers/) (for capabilities you may want exposed cluster-wide).
2. Export an object — typically with an `initialize()` plus methods.
3. For a controller, **`return true` from `initialize()` if you want it dispatchable via `system.controllers`** from other nodes.
4. Restart the process. Your global (`MYHELPER`, `MYCONTROLLER`) is now available everywhere.

Keep these globals **stateless or singleton-protected**. Long-lived state in a global is replicated independently per node — if cluster-coherent state is needed, store it in Redis / MySQL, or wrap the long-lived task with `SINGLETONMANAGER.initiateSingleton(...)`.

---

> **Next:** [§4 MicroApp / Plugin](04-microapps.md) — the developer-facing chapter on what a microapp actually is and how to build one.