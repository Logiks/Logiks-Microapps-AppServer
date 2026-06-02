# 2. Getting Started

> Audience: **platform engineers** for §2.1, **app developers** for §2.2 and §2.3.

---

## 2.1 Installation

### System Requirements

| Component | Minimum | Recommended |
|---|---|---|
| Node.js | 18 LTS | 20 LTS |
| MySQL | 8.0+ | - |
| Redis | 6 | 7 |
| OS | Linux / macOS | Linux (production) |
| RAM | 1 GB per Worker | 2 GB per Worker |
| Disk | 5 GB (logs grow) | SSD, log rotation enabled |

Outbound network access is required only if you use the `REMOTE` config loader (see [§3.2](03-framework-fundamentals.md#32-configuration-system)) or external services (SMTP, federated IdPs).

### Installation Methods

Two supported paths today: **Docker Compose** (the fastest way to a running cluster with its dependencies) and **PM2 on a host**. Running `node` directly works for local development.

| Method | Status |
|---|---|
| Docker Compose | **Supported** (`Dockerfile` + `docker-compose.yml`) |
| Bare metal / VM with PM2 | **Supported** |
| Local development (node directly) | **Supported** |
| Kubernetes Helm chart | Roadmap |
| AWS / GCP / Azure recipes | Roadmap |

### Bare Metal / PM2 Installation

```bash
# 1. Clone the repo
git clone https://github.com/logiks/logiks-microapps-appserver.git
cd logiks-microapps-appserver

# 2. Install dependencies
npm install

# 3. Provision infrastructure
#    - MySQL: create two empty databases, e.g. `appdb` and `logdb`
#    - Redis: a single instance reachable from this host
#    - Optional: NATS / MQTT broker if you prefer them over Redis as transporter

# 4. Configure
cp env_sample .env
cp config_sample.json config.json
# Edit .env and config.json — see §3.2 for the schema

# 5. Run the migration to create tables
MIGRATION_MODE=IMPORT node index.js
# (stop the process once you see "Post Initalization Completed")

# 6. Start under PM2
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup            # then run the command pm2 prints to enable on boot
```

The default `ecosystem.config.js` runs a single instance. To scale the Gateway horizontally, edit it to set `instances: N` (PM2 cluster mode) and ensure each instance has a distinct `SERVER_ID` (e.g., set it from `pm_id` or from per-instance env files).

### Local Development Setup

```bash
git clone https://github.com/logiks/logiks-microapps-appserver.git
cd logiks-microapps-appserver
npm install
cp env_sample .env          # ensure NODE_ENV=development, PORT=9999
cp config_sample.json config.json
npm start                   # equivalent to: clear; node index.js
```

The development server runs in a single process. Logging is verbose (debug level). Sessions live in Redis, so you still need Redis running locally. MySQL is required even in development — there is no in-memory fallback.

### Verifying the Installation

```bash
curl http://localhost:9999/api/ping
# expected: a JSON ping response

bash test-api.sh
# end-to-end auth + RBAC smoke test (see §6.3 and test-api.sh)
```

### Docker Compose

The repo ships a multi-stage [Dockerfile](../Dockerfile) (node:20-alpine, runs as a non-root user under `tini`, listens on 9999) and a [docker-compose.yml](../docker-compose.yml) that brings up MySQL 8, Redis 7, and the AppServer together. Qdrant (for the AI tier) is behind an `ai` profile so it only starts when you ask for it.

```bash
cp .env.docker.sample .env        # set ports, DB creds, CLUSTER_TOKEN, SESSION_SECRET, ENC_SALT
cp config_sample.json config.json # config.json is mounted at runtime, not baked into the image

docker compose up -d              # MySQL + Redis + AppServer
docker compose --profile ai up -d # also start Qdrant for AICore
```

MySQL is seeded from [docker/mysql-init.sql](../docker/mysql-init.sql). The AppServer waits for MySQL and Redis to report healthy, then starts; its own healthcheck hits `/api/public/public/ping`. Once up, the app is on `http://localhost:${APPSERVER_PORT}` (9999 by default).

Kubernetes manifests aren't in this release. The runtime is stateless apart from `logs/`, `uploads/`, and `temp/` — put those on a volume in any container deployment.

---

## 2.2 First Project

This section walks the path from nothing to a running route: start the AppServer, start a Worker, create a plugin inside it, and call it.

### 2.2.1 Create Your First Worker

```bash
git clone https://github.com/Logiks/Logiks-Microapps-Worker-NodeJS.git my-worker
cd my-worker
npm install
cp env_sample .env
```

Open `.env` and set the values that must match the AppServer's cluster:
```env
NODE_ID=worker-01                    # unique within the cluster
TRANSPORTER=redis://127.0.0.1:6379   # same URL as the AppServer
NAMESPACE=default                    # same namespace as the AppServer
CLUSTER_TOKEN=...                    # same shared secret as the AppServer
```

The Worker boots a broker like the AppServer but opens no HTTP port. Once it joins the cluster, the plugins it hosts become reachable through the Gateway.

### 2.2.2 Create Your First MicroApp

A microapp is a folder under the Worker's `plugins/` directory with a `logiks.json` manifest at its root. That manifest is what registers it — there's no `applications.json` and no `appid` to assign. The folder name is the plugin's identity.

```
my-worker/plugins/myapp/
├── logiks.json        # manifest — registers the plugin (required)
├── api.js             # server logic (functions called by routes/events)
├── routes.json        # HTTP routes + event subscriptions
├── dbschema/          # this plugin's tables
├── forms/ reports/ dashboards/ pages/ component/ menu/   # UI definitions
└── www/               # static assets
```

A minimal `logiks.json`:

```json
{
  "name": "My First App",
  "version": "1.0",
  "status": "stable",
  "type": "modules",
  "package": "com.example.myapp",
  "private": true,
  "dependencies": { "core": "+4.0.0" },
  "policies": { "myapp.allow.access": "true" }
}
```

Restart the Worker and it loads the plugin, making it callable across the cluster. The full anatomy is in [§4 MicroApp / Plugin](04-microapps.md); §2.3 below builds this out into a working route, a controller, and UI.

### 2.2.3 Running the Development Server

```bash
# Terminal 1: AppServer
cd logiks-microapps-appserver
npm start

# Terminal 2: Worker (if you have server-side microapp code)
cd my-worker
npm start
```

Both processes will print their `nodeID` and broker readiness. Once both are up, the Gateway's registry will show the Worker's services.

### 2.2.4 Deploying

Deployment is a matter of:
1. Running the AppServer under PM2 on a host (see §2.1).
2. Running each Worker under PM2 on its own host (or the same host with distinct ports/ids).
3. Pointing all processes at the same Redis, MySQL, and transporter.
4. Putting a load balancer (or DNS) in front of the AppServer if you run multiple Gateway replicas.

Zero-downtime deploys: `pm2 reload ecosystem.config.js` rolls the cluster instance-by-instance. The Central Broker drains gracefully on `SIGTERM` ([api/server.js:1316-1334](../api/server.js#L1316-L1334)).

---

## 2.3 Quickstart Tutorials

The flow these tutorials build on is always the same:

1. **Start the AppServer** (the MicroApp Server) — see §2.1 / §2.2.3. This is the cluster hub.
2. **Start a Worker** and point it at the same transporter, namespace, and `CLUSTER_TOKEN` — see §2.2.1.
3. **Create a plugin inside that Worker** — a folder under `plugins/` with a `logiks.json`, as defined in [§4 MicroApp / Plugin](04-microapps.md). The Worker loads it on startup and announces it to the AppServer.
4. **Build out the plugin** (routes, controllers, UI, events) per the MicroApp definition.

Every tutorial below adds one plugin folder inside your Worker's `plugins/` directory.

### Hello World MicroApp

The smallest possible plugin is a folder, a manifest, and one route that returns static data — no code required.

```
plugins/myapp/
├── logiks.json
└── routes.json
```

`plugins/myapp/logiks.json` — the manifest that registers the plugin:
```json
{
    "name": "My First App",
    "version": "1.0",
    "status": "stable",
    "type": "modules",
    "package": "com.example.myapp",
    "private": true,
    "dependencies": { "core": "+4.0.0" },
    "policies": { "myapp.allow.access": "true" }
}
```

`plugins/myapp/routes.json` — a route whose `data` is a static value (recall from §4.4 that a non-string `data` is returned verbatim):
```json
{
    "enabled": true,
    "routes": {
        "/hello": {
            "method": "GET",
            "data": { "message": "Hello from Logiks!" }
        }
    }
}
```

Restart the Worker. The route is now live on the AppServer at `/api/services/<plugin>/<path>`:

```bash
curl http://localhost:9999/api/services/myapp/hello
# {"status":"okay","results":{"message":"Hello from Logiks!"}}
```

> To serve a **static HTML/asset file** instead of JSON, drop it in the plugin's `www/` folder and fetch it through the auto-generated `www` action: `GET /api/services/myapp/www?file=hello.html`. UI definition files (pages, forms, components) are served through the `source` action — see §4.2/§4.4.

### API MicroApp

To run real logic, add an `api.js` controller and point a route's `data` at one of its functions. Behaviour lives in `api.js`; `routes.json` decides what is exposed and how it is addressed.

`plugins/myapp/api.js` — exports async functions receiving `(params, ctx)`:
```javascript
module.exports = {
    greet: async function(params, ctx) {
        const name = params.name || "world";
        return { message: `Hello, ${name}!` };
    }
};
```

`plugins/myapp/routes.json` — `data` is `"<PLUGINID>.<fn>"` (the pluginID upper-cased):
```json
{
    "enabled": true,
    "routes": {
        "/greet": {
            "method": "GET",
            "data": "MYAPP.greet",
            "params": { "name": { "type": "string", "optional": true } }
        }
    }
}
```

When the Worker activates the plugin it builds a MicroApp Runtime service whose action handler routes the call through `runAction`, looks up `MYAPP.greet`, and returns its result wrapped in `{ status, results }`:

```bash
curl "http://localhost:9999/api/services/myapp/greet?name=Alice"
# {"status":"okay","results":{"message":"Hello, Alice!"}}
```

Two more facts from §4.4 worth remembering:

- Every `api.js` function is **also** registered as a non-HTTP action (`myapp.greet`), callable across the cluster even if it has no route.
- Because controllers are keyed by pluginID globally, a route in one plugin can target another plugin's function (`"data": "BILLING.listInvoices"`) — that is the cross-plugin reuse primitive.

### UI MicroApp

A plugin ships its UI inside its own folder. There is no `misc/apps/` and no theme entry in `applications.json` — the UI source lives next to the server code and is served through the plugin's auto-generated `source` and `www` actions.

```
plugins/myapp/
├── logiks.json        # navigation + policies (see below)
├── pages/             # page definitions (JSON / .jsx — .jsx is JIT-compiled)
├── forms/             # form definitions
├── component/         # reusable custom React (.jsx) components — usable across plugins
├── dashboards/        # dashboard definitions
├── reports/           # report definitions
├── menu/              # menu definitions
└── www/               # static assets (html, css, js, images)
```

The minimum for a working UI:

1. **Navigation** — declare entries in `logiks.json`'s `navigation` array. Each entry has `title`, `link`, `iconpath`, and a `to_check` (`policy#<key>`) that ties visibility to a policy:
   ```json
   "navigation": [
     { "title": "My App", "link": "modules/myapp", "iconpath": "fa fa-cube",
       "to_check": "policy#myapp.allow.access" }
   ]
   ```
2. **Policies** — declare the gating policies in `logiks.json`'s `policies` map (`"myapp.allow.access": "true"`). These are reported to the AppServer at registration and drive both menu visibility and RBAC.
3. **UI definitions** — place page/form/component/dashboard files under the matching folders. They are fetched on demand via `GET /api/services/myapp/source?folder=pages&file=<name>` (`.jsx` is compiled on the fly).
4. **Static assets** — place them under `www/` and serve via `GET /api/services/myapp/www?file=<name>`.
5. **Custom React components** — author `.jsx` in `component/` for bespoke UI; they're JIT-compiled by the `source` action and can be embedded across plugins via `comps`/`widget` (`<plugin>.<component>`). See [§4.5](04-microapps.md#45-cluster-wide-reuse) and the [training reference §6.7](training/6-building-blocks.md#67-custom-react-components).

### Event-Based MicroApp

A plugin subscribes to cluster events through the `events` map in `routes.json`. Each entry maps an event topic to a `data` controller reference, which runs through the same `runAction` path as a route when the event fires.

`plugins/myapp/routes.json`:
```json
{
    "enabled": true,
    "events": {
        "system.request_completed": { "data": "MYAPP.onRequest" },
        "logs.activity":            { "data": "MYAPP.onActivity" }
    }
}
```

`plugins/myapp/api.js`:
```javascript
module.exports = {
    onRequest: async function(params, ctx) {
        log_info("Request:", params.method, params.path, params.status, params.duration + "ms");
    },
    onActivity: async function(params, ctx) {
        // react to audit events
    }
};
```

The AppServer emits `system.request_completed` after every routed call. Subscribers receive every event the bus fans out — across all nodes — because events are cluster-wide by default. To **emit** an event from your own code, use the broker on the context: `ctx.emit("myapp.invoice.created", payload)`. See [§8.2](08-event-system.md#82-working-with-events) for filtering and group semantics.

### AI MicroApp — Consuming AICore

A plugin reaches the agentic Tier 4 through the global `AICORE` interface (see [§9 AI Layer](09-ai-layer.md)). On a Worker, `AICORE` is one of the AppServer controllers mirrored as a local global proxy at connect time (§4.5), so calling it from `api.js` transparently forwards to the AppServer — no import needed.

`plugins/support/api.js`:
```javascript
module.exports = {
    ask: async function(params, ctx) {
        const response = await AICORE.sendMessage(
            params.message,
            params.sessId,        // optional — AICore generates one if absent
            "support",            // moduleId — used by AICore for context
            { temperature: 0.3 }, // engine-specific params
            ctx                   // forwards ctx.meta.user
        );
        return response;          // { sessId, status, response, message }
    }
};
```

`plugins/support/routes.json`:
```json
{
    "enabled": true,
    "routes": {
        "/ask": {
            "method": "POST",
            "data": "SUPPORT.ask",
            "params": { "message": { "type": "string", "min": 1 },
                        "sessId":  { "type": "string", "optional": true } }
        }
    }
}
```

AICore generates a session id, forwards the request through its engine, and returns the result.

> **Status:** today AICore exposes `sendMessage` and a stub `oneShot`. The skill registry, context engine, agent loops, memory, vector DB, and tool integration are roadmap items — see [§9 AI Layer](09-ai-layer.md) for the design and current status of each piece. A plugin contributes to AICore the same way it does anything else: by exposing `api.js` functions that AICore can call as tools (`<plugin>.<fn>`). It does **not** reimplement retrieval, memory, or the agent loop — that is AICore's job.

### Multi-Worker Communication

A plugin on one Worker can call a plugin on another Worker by service action name — the cluster bus routes it transparently. Use the global `_call(actionName, params)` from `api.js` (it wraps the broker call); `ctx.call(...)` works too inside a controller that receives `ctx`.

```javascript
// Worker A — plugins/orders/api.js
module.exports = {
    create: async function(params, ctx) {
        // "inventory.reserve" is the api.js function of the `inventory` plugin on Worker B
        const inv = await _call("inventory.reserve", { sku: params.sku });
        return { orderId: "...", reservation: inv };
    }
};
```

```javascript
// Worker B — plugins/inventory/api.js
module.exports = {
    reserve: async function(params, ctx) {
        return { reserved: true, sku: params.sku };
    }
};
```

`_call("inventory.reserve", …)` resolves through the cluster registry; whichever Worker hosts the `inventory` plugin handles it, and the result comes back to Worker A. Because every `api.js` function is registered as a non-HTTP service action (§4.4), no extra wiring is needed — define `reserve` in `inventory`'s `api.js` and it is immediately callable cluster-wide. The same globals reach the AppServer too: `_helper(...)` for AppServer helpers, `_controller(...)` for its controllers (§4.5).

---

> **Next:** [§3 Framework Fundamentals](03-framework-fundamentals.md) — the project layout, the configuration system, and the dependency model.