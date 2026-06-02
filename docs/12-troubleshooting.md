# 12. Troubleshooting & FAQ

> For app developers and platform engineers. Symptoms grouped by area, with the cause and the fix.

---

## 12.1 Cluster & Workers

**A Worker starts but never appears in the cluster.**
The usual cause is a mismatch with the Gateway. A Worker only joins when its `TRANSPORTER` URL and `NAMESPACE` match the AppServer's, and registration only succeeds when `CLUSTER_TOKEN` matches. On a token mismatch the AppServer logs `CLUSTER_TOKEN_ERROR` and removes the node (`system.registerWorker` in [api/services/system.service.js](../api/services/system.service.js)). Check those three values on both sides first.

**A Worker was up, then vanished from the registry.**
Heartbeats stopped. A node that misses heartbeats is dropped after `heartbeatTimeout` (30s). Look for a crash, an event-loop block, or a transporter disconnect on that Worker.

**An action call fails with `SERVICE_NOT_AVAILABLE`.**
No node currently exposes that service. Either the Worker hosting it isn't connected, or the plugin that defines it didn't load (see 11.2). Confirm with the cluster's node/service list.

**A global like `_DB` or `RBAC` is `undefined` inside plugin code.**
On a Worker, AppServer helpers/controllers are reachable as proxies once the Worker has connected; before that they aren't available. Make sure you're calling them after the Worker has joined. For a global that only lives on the AppServer node, reach it with `_helper(...)` / `_controller(...)`. A controller is only callable cross-node if its `initialize()` returns `true` ([§3.4](03-framework-fundamentals.md#34-controllers--helpers-reference)).

---

## 12.2 Plugins

**A plugin folder is ignored on Worker start.**
The loader skips a folder when:
- it has no `logiks.json`, or the JSON is malformed — the Worker logs `Plugin not loaded <name> due to missing config` (or `due to corrupt config`);
- its name starts with `.`, `z_`, `x_`, or `temp_` (these prefixes are intentionally skipped).

Add a valid `logiks.json` at the folder root and rename the folder if it uses a skipped prefix.

**A route returns 404 even though the plugin loaded.**
Routes only exist when `routes.json` has `"enabled": true` and the path is listed under `routes`. The public URL is `/api/services/<plugin><path>`, and the path is normalised (slashes become underscores in the action name, `:params` are kept in the REST path). Check you're calling `/api/services/<plugin>/...`, not `/api/<plugin>/...`.

**An `api.js` function isn't reachable from another plugin.**
Every `api.js` export is registered as a non-HTTP action `<plugin>.<fn>`. Call it with `_call("<plugin>.<fn>", params)`. If it's missing, the plugin didn't load (see above) or the function name differs from what you're calling.

**A plugin's npm dependency isn't found.**
Dependency install only runs when `ENABLE_PLUGINS_INSTALL_DEPS=true` on the Worker; otherwise the Worker logs that dependency loading is disabled. Set it, or pre-install into `plugins/package.json`.

---

## 12.3 Requests, Auth & Rate Limits

**Requests to a domain get 401 `INVALID_REQUEST`.**
The Gateway couldn't resolve the host to an application, or the row is blocked. Domains map through the `lgks_domains` table (`BASEAPP.getAppForDomain`); add or unblock the `domain_host` row.

**A valid user gets 403 on an action.**
Authorization checks the action's `meta.scopes` against the user's scopes after tenant expansion: `billing:read` on an action matches `<tenantId>:billing:read`, `*:billing:read`, the wildcard variants, or the bare scope ([api/server.js](../api/server.js)). Confirm the user actually carries a matching scope for their tenant. Anything named `admin.*` additionally needs an admin role or `root`/`devroot`/`admin` privilege.

**429 with a `Retry-After` header.**
Distributed rate limiting on `/api` tripped. The window is `RATE_LIMIT_WINDOW_MS` (default 60s) and the cap is `RATE_LIMIT_MAX` (default 300) per identifier. Raise the limits or spread the calls. Login and `/api/public` use a separate, tighter per-node limiter (10/min).

**Auth works in one Gateway replica but not another.**
Sessions and rate-limit counters live in Redis so any replica can serve any request. If behaviour differs by replica, the replicas aren't pointed at the same Redis.

---

## 12.4 Data & Migrations

**Tables don't exist on first run.**
Schema is applied by the migrator, not at boot by default. On the AppServer, run with `MIGRATION_MODE=IMPORT` once and wait for `Post Initalization Completed`. On a Worker, per-plugin schema runs when `ENABLE_DBMIGRATION=true`, applying each plugin's newest `dbschema/schema_*.json` ([§4.7](04-microapps.md#47-per-plugin-db-migration)).

**A frontend log call “succeeds” but no row appears.**
`_DBLOGGER._log` returns `false` (no error thrown) when the target table doesn't exist or the log id isn't allow-listed. The shipped allowlist also has a prefix quirk worth knowing about. See [§11.5](11-audit-logs.md#115-frontend-logs--the-_dblogger-helper) for the exact conditions and the fix.

**Two MySQL connections — which is which.**
`appdb` holds operational data; `logdb` holds audit/activity/error logs. They're configured separately and can have different retention.

---

## 12.5 Events

**A subscriber never fires.**
Two common causes:
- Delivery mode. `ctx.emit` gives the event to one instance per group; `ctx.broadcast` gives it to every instance on every node. If you scaled the subscriber and expected all copies to react, use `broadcast` ([§8.1](08-event-system.md)).
- The subscriber was down when the event fired. The default transporters don't persist events, so a missed event is gone. For at-least-once delivery, use a durable transporter or persist the payload and replay it.

**An event handler throws and the event disappears.**
There's no dead-letter queue. A throwing handler logs and the event is dropped. Make handlers defensive, and idempotent — the same event can arrive more than once.

---

## 12.6 AI (AICore)

**`AICORE.sendMessage` returns nothing useful.**
The end-to-end path today is `sendMessage` → the configured engine, and the default engine currently returns `false`. The registry, context engine, memory, and agent loops are still being built. [§9 AI Layer](09-ai-layer.md) tracks what's wired versus planned. Point at a working engine, or treat the call as the integration seam it is for now.

**Qdrant isn't reachable in Docker.**
It only starts under the `ai` compose profile: `docker compose --profile ai up -d` ([§2.1](02-getting-started.md#docker-compose)).

---

## 12.7 Docker

**The AppServer container restarts or never reports healthy.**
It depends on MySQL and Redis being healthy first, then runs its own healthcheck against `/api/public/public/ping`. If it loops, check the DB/Redis containers and that `config.json` is present — it's mounted at runtime, not baked into the image ([Dockerfile](../Dockerfile)).

**Config changes don't take effect.**
`config.json`, `.env`, and `system.json` are read at boot; change them and restart the container (or `pm2 reload` on a host). Vendors, rules, and RBAC policies reload at runtime; the rest does not ([§3.2](03-framework-fundamentals.md#32-configuration-system)).

---

## FAQ

**Where do I see what endpoints exist?** The `developers.swagger` service derives a live OpenAPI document from the action catalogue ([§6.4](06-core-services-and-apis.md#64-api-reference-swagger)).

**How do I share logic between plugins?** Call the other plugin's action with `_call("<plugin>.<fn>", params)`. For UI, reuse a component by its `<plugin>.<component>` name ([§4.5](04-microapps.md#45-cluster-wide-reuse)).

**Do I need an `applications.json` entry for a plugin?** No. A plugin is a folder with `logiks.json` in a Worker's `plugins/`. `applications.json` configures front-end applications (branding, theme, domain), which is a separate concern ([§4.1](04-microapps.md#41-what-a-microapp-is)).

**How do I run something on a schedule?** Use `AUTOJOBS` (leader-elected via a Redis lock so it runs once across the cluster).

**How do I add a platform-wide helper?** Drop a file in [api/helpers/](../api/helpers/) (or [api/controllers/](../api/controllers/) for something callable cross-node, returning `true` from `initialize()`), then restart ([§3.4](03-framework-fundamentals.md#34-controllers--helpers-reference)).

---

> Back to the [Documentation Index](00-index.md).
