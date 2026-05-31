# 4. MicroApp / Plugin

> Audience: **app developers** — this is the main chapter for the people building on Logiks.

---

## 4.1 What a MicroApp Is

A **MicroApp** (used interchangeably with **plugin** in this codebase) is a self-contained folder that holds everything one unit of business capability needs — its server logic, its routes, its UI source, its DB schema, and its manifest. A MicroApp is *not* a database row, a tenant, or an entry in a central registry. It is a directory on disk.

The single thing that makes a folder a plugin is a **`logiks.json`** file at its root. That file is the manifest and the registration. If `logiks.json` is missing or unparseable, the folder is skipped at load time and never becomes a plugin.

```
plugins/
  demo/                ← the folder name "demo" is the plugin's identity (its pluginID)
    logiks.json        ← REQUIRED — without this the folder is ignored
    api.js
    routes.json
    dbschema/
    www/
    pages/  forms/  component/  dashboards/  reports/  menu/
```

Plugins live under the `plugins/` directory of a **Worker Node** (the [Logiks-Microapps-Worker-NodeJS](https://github.com/Logiks/Logiks-Microapps-Worker-NodeJS) runtime). When a Worker starts, it discovers and loads every plugin in `plugins/`, turns each one into a live **MicroApp Runtime service** on the shared cluster bus, and then any other plugin or the AppServer can call it. That is the whole model: drop a folder in, restart (or hot-add) the Worker, and the capability is available cluster-wide.

The pluginID (the folder name) is also a namespace. Folders whose names start with `.`, `z_`, `x_`, or `temp_` are deliberately skipped by the loader — use those prefixes to park a plugin without deleting it.

---

## 4.2 Anatomy of a Plugin Folder

Everything below is grounded in the shipped `demo` plugin at [plugins/demo/](../../Microapps-Worker-NodeJS/plugins/demo).

### `logiks.json` — the manifest

The manifest both registers the plugin and describes it. From [plugins/demo/logiks.json](../../Microapps-Worker-NodeJS/plugins/demo/logiks.json):

```json
{
    "name": "Demo",
    "version": "1.0",
    "status": "stable",
    "type": "modules",
    "package": "com.smartinfologiks.demo",
    "description": "Plugin for Demo",
    "keywords": "logiks,demo",
    "license": "SILK",
    "marketid": "com.smartinfologiks.demo",
    "private": true,
    "dependencies": {
        "core": "+4.0.0"
    },
    "policies": {
        "demo.allow.access": "true",
        "demo.tab.access": "false",
        "demo.create.access": "false"
    },
    "authors": [ { "name": "...", "email": "...", "authorid": "..." } ],
    "navigation": [
        {
            "title": "Demo",
            "link": "modules/demo",
            "iconpath": "fa fa-address-book",
            "tips": "",
            "to_check": "policy#demo.allow.access"
        }
    ]
}
```

Fields that the runtime actually consumes:

| Field | What the runtime does with it |
|---|---|
| `dependencies` | npm packages the plugin needs. During `checkDependencies` these are aggregated across all plugins and installed into `plugins/package.json`. The pseudo-dependency `core` is dropped (it means "the platform core", not a real npm package). |
| `policies` | A flat map of `policy.key → "true"/"false"`. Collected into the Worker's policy catalog and reported to the AppServer at registration. RBAC and navigation gating read these. |
| `navigation` | Menu entries this plugin contributes. Each entry's `to_check` (`policy#<key>`) ties visibility to a policy. |

The remaining fields (`name`, `version`, `package`, `marketid`, `authors`, `repository`, `homepage`, etc.) are descriptive metadata for cataloguing and the marketplace.

### `api.js` — the controller

`api.js` exports a plain object of async functions. Each function receives `(params, ctx)`. From [plugins/demo/api.js](../../Microapps-Worker-NodeJS/plugins/demo/api.js):

```javascript
module.exports = {
  test1: async function(params, ctx) {
    return { status: "ok", data: "Demo Test1 - Demo", params: params };
  },
  test2: async function(params, ctx) {
    return { status: "ok", data: "Demo Test2 - Demo", params: params };
  }
};
```

At activation the whole module is `require`d and exposed two ways:

1. As an **UPPERCASE global** named after the pluginID — `DEMO` here — so other plugins' route definitions can target `DEMO.test1` (see §4.4).
2. As **non-REST service actions** on the plugin's service — `demo.test1`, `demo.test2` — callable across the cluster but **not** exposed over HTTP.

Note that `test2` is callable as a service action even though it has no HTTP route. `api.js` defines *what the plugin can do*; `routes.json` decides *what is reachable over HTTP*.

### `routes.json` — HTTP routes and event subscriptions

From [plugins/demo/routes.json](../../Microapps-Worker-NodeJS/plugins/demo/routes.json):

```json
{
    "enabled": true,
    "descs": "Action manager",
    "routes": {
        "/": {
            "method": "POST",
            "data": "DEMO.test1",
            "format": "json"
        }
    },
    "events": {
        "event1.test1": {
            "data": "DEMO.test1"
        }
    }
}
```

- `enabled` — if `false`, no HTTP routes are generated for the plugin (it can still be called as a service and via events).
- `routes` — a map of `path → { method, data, ... }`. `data` is the controller reference (`CONTROLLER.method`) or a static value. See §4.4 for exactly how each route becomes an action.
- `events` — a map of `eventTopic → { data }`. Each entry subscribes the plugin to a cluster event topic and runs the referenced controller when it fires. `demo` listens for `event1.test1`.

A plugin with **no** `routes.json` still loads — the loader registers it with an empty, enabled route set, so its `api.js` actions, `source`, and `www` endpoints still exist.

### `dbschema/` — per-plugin database schema

`dbschema/schema_<build>.json` holds the plugin's table definitions, split by DB key (`appdb`, `logdb`). The shipped demo schema is empty:

```json
{ "appdb": {}, "logdb": {} }
```

When `ENABLE_DBMIGRATION=true`, the Worker runs each plugin's newest `schema_*.json` through `DBMIGRATOR.pluginMigration(pluginID, schema)` at startup. See §4.7.

### `www/` and the UI folders

- `www/` holds static assets (`index.html`, `assets/script.js`, …) served verbatim through the plugin's `www` action.
- `pages/`, `forms/`, `component/`, `dashboards/`, `reports/`, `menu/` hold UI source (JSON definitions, `.jsx`, raw files). These are fetched on demand through the plugin's `source` action, which JIT-compiles `.jsx` and can inline a sibling `.js` script for JSON definitions.
- `component/` (or `components/`) specifically holds **custom React components** (`.jsx`). They are compiled on the fly and can be embedded **across plugins** — see §4.5 and the full authoring guide in [training §6.7](training/6-building-blocks.md#67-custom-react-components).

Both `source` and `www` are generated automatically for every plugin (§4.4) — you do not wire them up.

---

## 4.3 How a Worker Loads Plugins

Plugin loading is driven by [helpers/plugins.js](../../Microapps-Worker-NodeJS/helpers/plugins.js) and orchestrated from the Worker's [index.js](../../Microapps-Worker-NodeJS/index.js):

```javascript
async function main() {
    const broker = await BOOSTRAP.start();      // build the MicroApp Runtime broker, load ./services
    await PLUGINS.loadPlugins(broker);          // 1. discover + catalog
    await PLUGINS.checkDependencies(broker);    // 2. install npm deps
    await PLUGINS.activatePlugins(broker);      // 3. turn each plugin into a live service
    BOOSTRAP.connect(broker, async (connected) => { /* 4. join the cluster */ });
}
```

Before `main()` runs, the Worker autoloads everything in `helpers/` and `controllers/` as UPPERCASE globals (`PLUGINS`, `BOOSTRAP`, `BASEAPP`, …) — the same global-autoload pattern the AppServer uses. The four phases:

### Phase 1 — `loadPlugins` (discover + catalog)

1. Reads `plugins/`, filtering out hidden entries and `z_*` / `x_*` / `temp_*` folders.
2. For each remaining folder, looks for `logiks.json`. **No manifest → the plugin is skipped** with `Plugin not loaded <name> due to missing config - logiks.json`. A corrupt manifest is skipped the same way.
3. Records `logiks.json.policies` into the Worker's policy catalog.
4. Walks the folder one level deep (`catalogPlugins`, capped at depth 1) to build a file/folder catalog, and stores `{ CONFIG, CATALOG }` per plugin.

At this point the platform *knows* about the plugins but has not run any of their code.

### Phase 2 — `checkDependencies` (npm install)

Gated behind `ENABLE_PLUGINS_INSTALL_DEPS=true` (otherwise skipped with a notice). It merges every plugin's `logiks.json.dependencies` (minus `core`), writes a single `plugins/package.json`, runs `npm install --only=prod` in `plugins/`, and builds a plugin-scoped `require` exposed as the global `_require(pkgId)` / `PLUGINS.getPluginRequire(pkgId)`. This is a *secondary* `package.json` for plugin deps — it does not touch the Worker's own.

### Phase 3 — `activatePlugins` (build the services)

For each plugin:

1. If `api.js` exists, `require` it, store it as `APPINDEX.CONTROLLERS[<PLUGINID>]`, and also expose it as the global `<PLUGINID>`.
2. Read `routes.json` (or default to `{ enabled: true, routes: {} }`) and call `loadPluginRoutes(broker, pluginID, config)` — this is where the MicroApp Runtime service is actually constructed (§4.4).

### Phase 4 — `connect` (join the cluster)

[helpers/boostrap.js](../../Microapps-Worker-NodeJS/helpers/boostrap.js) starts the broker and registers the Worker with the AppServer by calling `system.registerWorker` with the payload:

```javascript
{
    nodeID, token: process.env.CLUSTER_TOKEN, role: "worker",
    host, pid, pwd, color,
    services: getLocalServiceNames(broker),   // every service this Worker hosts
    menus:    await PLUGINS.getMenus(),        // navigation contributed by plugins
    plugins:  PLUGINS.listPlugins(),           // plugin IDs
    policies: PLUGINS.listPluginPolicies()     // merged policy catalog
}
```

The AppServer validates `CLUSTER_TOKEN` (mismatch → the node is rejected and removed) and stores the worker record. The Worker then heartbeats every 10s via `system.workerHeartbeat`, re-registers automatically on transporter reconnect, and drains gracefully on `SIGINT`/`SIGTERM` by calling `system.drainWorker`. Finally `BASEAPP.connect` wires up the cross-cluster call globals described in §4.5.

---

## 4.4 How a MicroApp Runtime Service Works

This is the heart of the system. `loadPluginRoutes` (in [helpers/plugins.js](../../Microapps-Worker-NodeJS/helpers/plugins.js)) turns one plugin into one runtime service schema:

```javascript
const serviceSchema = { name: pluginName, actions: {}, methods: {}, events: {} };
```

It then populates `actions` and `events` from four sources and registers the service on the broker. **Two copies are registered** — the schema as-is and a lowercase-named clone — so the service resolves regardless of case.

### 1. HTTP routes → REST actions

For each entry in `routes.json.routes` (when `enabled`), an action is generated. The route path is normalised into an action name, and the public REST path is fixed under `/api/services/<plugin>`:

```
plugin "demo", route "/:actionid"
  → action name : demo_actionid     (slashes → "_", ":" stripped, leading/trailing "_" trimmed)
  → REST method : conf.method (defaults to GET)
  → REST path   : /api/services/demo/:actionid
```

The generated handler runs the route's `data` reference through `runAction` and wraps the result:

```javascript
async handler(ctx) {
    return { status: "okay", results: await runAction(ctx, conf, path, rPath) };
}
```

`conf.params`, `conf.meta`, `conf.cache`, and `conf.description` are copied onto the action when present — so a route can declare parameter validation, metadata, caching, and docs.

### 2. `api.js` functions → non-REST actions

Every function exported from `api.js` is added as an action with `rest: false`, so it is callable across the cluster by name (`demo.test1`) but never exposed over HTTP:

```javascript
serviceSchema.actions[fnName] = {
    rest: false,
    async handler(ctx) {
        return APPINDEX.CONTROLLERS[<PLUGINID>][fnName](ctx.params, ctx);
    }
};
```

### 3. Built-in `source` and `www` actions

Every plugin automatically gets two GET actions:

| Action | REST path | Purpose |
|---|---|---|
| `source` | `/api/services/<plugin>/source?folder=&file=` | Serves UI source from the plugin folder. `.jsx` is JIT-compiled (`JITCOMPILER.compileJSX`); JSON definitions can carry a base64-inlined sibling `.js`; everything else is returned raw. Missing files raise `INVALID_SOURCE_FILE` unless `silent=true`. |
| `www` | `/api/services/<plugin>/www?folder=&file=` | Serves static assets from the plugin's `www/` folder verbatim. |

### 4. `routes.json` events → event handlers

Each `events` entry subscribes the service to a cluster topic; when the event fires, the referenced `data` controller runs through the same `runAction` path:

```javascript
serviceSchema.events["event1.test1"] = {
    async handler(ctx) { return await runAction(ctx, eventConf, "event1.test1", "event1.test1"); }
};
```

### `runAction` — resolving `data`

`runAction` is the dispatcher shared by routes and events. It inspects `conf.data`:

- **String like `"DEMO.test1"`** → treated as a **controller call**. The first segment is upper-cased and looked up in `APPINDEX.CONTROLLERS`, the second is the method. The method is invoked as `fn(mergedParams, ctx, config, path, rPath)`, where `mergedParams` is `ctx.params` + `ctx.query`. Because `APPINDEX.CONTROLLERS` is keyed by pluginID globally, **one plugin's route can target another plugin's `api.js` function** — that is the cross-plugin reuse primitive. An optional `conf.processor` (`PROC.method`) post-processes the controller's return value.
- **Anything non-string (object/array/scalar)** → treated as **static DATA** and returned as-is. This lets a route serve a fixed payload with no code.
- **Unresolved controller/method** → an `ERROR` string is returned and the failure is logged (the route still responds rather than crashing).

So the full set of callable surfaces a single plugin exposes is: its HTTP routes (`/api/services/<plugin>/…`), its `api.js` actions (`<plugin>.<fn>`, non-HTTP), `source`, `www`, and any subscribed events.

---

## 4.5 Cluster-Wide Reuse

Once a Worker has joined the cluster, its plugin services are addressable from anywhere on the shared transporter (the cluster bus). The Worker exposes a set of globals (defined in [helpers/baseapp.js](../../Microapps-Worker-NodeJS/helpers/baseapp.js)) so plugin code can reach the rest of the platform without caring where a target physically runs:

| Global | Reaches | Notes |
|---|---|---|
| `_call(serviceString, params)` | Any service action anywhere in the cluster | Thin wrapper over `broker.call`. Use it to invoke another plugin's actions. |
| `_helper("_DB.db_selectQ", …)` | AppServer **helpers** | Proxied over the bus via `system.helpers`. |
| `_controller("RBAC.check", …)` | AppServer **controllers** | Proxied over the bus via `system.controllers`. |
| `_require(pkgId)` | Plugin-scoped npm modules | Resolves against `plugins/package.json`. |

On connect, the Worker also mirrors every AppServer helper and controller as a **local global proxy**. That is why plugin code can simply write `_DB.db_selectQ(...)` or `RBAC.check(...)` — those globals are `UniversalAPI` proxies that transparently forward the call across the bus to the AppServer and return the result. The plugin author writes ordinary-looking calls; the runtime handles the remoting.

On the AppServer side, the [system service](../api/services/system.service.js) keeps a registry of every connected Worker (`registerWorker` / `workerHeartbeat` / `drainWorker`) and aggregates their plugins, services, menus, and policies. `system.plugins` returns the merged or per-node view, and the admin endpoint [admin.plugins.listNodes](../api/services/admin/plugins.service.js) (`GET /` under the admin route) surfaces it to operators.

### UI reuse — components across plugins

Reuse has a **UI counterpart**: just as server logic is shared via `_call`, custom UI is shared via React components. A plugin authors a `.jsx` component in its `component/` folder; the `source` action JIT-compiles it (`JITCOMPILER.compileJSX`) and serves it. Any other plugin can then embed it by its `<plugin>.<component>` name — through a dashboard card's `comps`, or a form/InfoView `widget`/`module` field's `src` (with props passed via `config`). Real shipped examples include `accounts.ledger`, `docman.docs`, and `bizlogger.logs` — each owned by one plugin and rendered by others. Full authoring guide: [training §6.7 Custom React Components](training/6-building-blocks.md#67-custom-react-components).

---

## 4.6 Creating a MicroApp

There is no scaffolding command and no build step required by the framework. A minimal plugin is three files.

```bash
# 1. Pick a pluginID (lowercase, no spaces) and create the folder in a Worker
cd Microapps-Worker-NodeJS/plugins
mkdir -p billing/{dbschema,www}

# 2. Write the manifest — this is what registers the plugin
cat > billing/logiks.json <<'JSON'
{
  "name": "Billing",
  "version": "1.0",
  "status": "stable",
  "type": "modules",
  "package": "com.example.billing",
  "private": true,
  "dependencies": { "core": "+4.0.0" },
  "policies": { "billing.allow.access": "true" },
  "navigation": [
    { "title": "Billing", "link": "modules/billing", "iconpath": "fa fa-file-invoice",
      "to_check": "policy#billing.allow.access" }
  ]
}
JSON

# 3. Write the controller
cat > billing/api.js <<'JS'
module.exports = {
  listInvoices: async function(params, ctx) {
    const res = await _DB.db_selectQ("appdb", "billing_invoices", "*", {}, {});
    return { status: "ok", results: res.results };
  }
};
JS

# 4. Expose it over HTTP
cat > billing/routes.json <<'JSON'
{
  "enabled": true,
  "routes": {
    "/invoices": { "method": "GET", "data": "BILLING.listInvoices", "format": "json" }
  }
}
JSON
```

Restart the Worker (or hot-add it — see §4.8). The plugin is now live:

- HTTP: `GET /api/services/billing/invoices`
- Cross-cluster: `_call("billing.listInvoices", {...})` from any other plugin.

### Conventions worth following

1. **Namespace your tables by pluginID** — `billing_invoices`, `billing_settings` — so plugins never collide in shared databases.
2. **Use the platform globals** (`_DB`, `_call`, `_helper`, `_controller`, plus mirrored AppServer controllers like `RBAC`) instead of pulling your own DB/HTTP clients — they integrate with logging, the bus, and RBAC.
3. **Gate features with `policies`** in `logiks.json` and reference them from `navigation[].to_check` (`policy#<key>`).
4. **Keep `api.js` the single source of behaviour.** `routes.json` only decides what is exposed and how it is addressed.
5. **Point `data` at controller methods**, not inline logic — a route's `data: "BILLING.listInvoices"` keeps the route declarative and the logic testable.

---

## 4.7 Per-Plugin DB Migration

When the Worker boots with `ENABLE_DBMIGRATION=true`, `BASEAPP.runPluginMigration` ([helpers/baseapp.js](../../Microapps-Worker-NodeJS/helpers/baseapp.js)) iterates every loaded plugin and:

1. Ensures the plugin's `dbschema/` directory exists.
2. Picks the **newest** `schema_*.json` (by file mtime) as the active schema.
3. Calls `DBMIGRATOR.pluginMigration(pluginID, schema)` — which compares the declared schema against the live DB.
4. In **EXPORT** mode, writes the live schema back to `dbschema/schema_<BUILD>.json`; in **IMPORT** mode, applies the migration.

Schemas are keyed by DB (`appdb`, `logdb`) → table → column/index definitions, mirroring the AppServer's own schema files. Ship your tables in `dbschema/` and the plugin migrates itself on deploy.

---

## 4.8 Hot-Plugging

Because a plugin is just a folder loaded into a Worker, plugins can be added or removed without restarting the whole cluster — the Worker re-catalogs `plugins/`, registers/derigsters the affected services, and re-announces itself to the AppServer (which updates its worker registry on the next `registerWorker`). Heartbeats keep the AppServer's view current, and a draining Worker (`SIGINT`/`SIGTERM`) tells the AppServer to stop routing to it before it exits. This is what lets you ship and retire capabilities live, without a full stack restart.

---

## 4.9 Contributing to the AI Layer

A plugin participates in the agentic (4th-tier) layer the same way it does everything else: by exposing `api.js` functions as cluster-callable actions. AICore can invoke any plugin action by name (`<plugin>.<fn>`) just like another plugin would, forwarding `ctx` so RBAC and audit are preserved. The vector store, embeddings, memory scoping, and agent control flow are **AICore's** responsibility, not the plugin's — a plugin contributes *tools and skills*, it does not reimplement the agentic stack.

The full AI design and its current build status live in [§8 AI Layer](08-ai-layer.md).

---

> **Next:** [§5 Workers](05-workers.md) — the runtime substrate that hosts plugins.