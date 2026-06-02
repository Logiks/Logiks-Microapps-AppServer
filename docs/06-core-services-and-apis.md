# 6. Core Services & APIs

> Audience: **app developers** primarily; **platform engineers** for §6.3.

This chapter documents the service layer (how code is organised), the API system (what's exposed to clients), and the API gateway (how HTTP becomes a service call). It also serves as the **API reference** — authentication, calling conventions, examples, and the live OpenAPI spec and explorer (§6.4).

Base URL in development is `http://localhost:9999`; replace it with your deployment host throughout.

---

## 6.1 Service Layer

### Internal Services

The AppServer ships a set of platform services in [api/services/](../api/services/). They form the backbone every microapp can call.

| Service | Purpose | Notable actions |
|---|---|---|
| `auth` | Login, logout, token issuance, verification | `login`, `logout`, `logout-all`, `refresh`, `tltoken`, `s2stoken`, `verifyAccessToken`, `verifyS2SToken`, `verifyTLToken` |
| `tenant` | Multi-tenant data | `fetch`, `list`, `create`, `update` |
| `application` | App metadata, theme, pages | `fetch`, `settings`, `pages`, `theme` |
| `data` | Generic list management (do_lists) | `listGroups`, `fetch`, `fetchFiltered`, `upsert` |
| `dbops` | Stored parameterized DB queries | `storeDBOpsQuery`, `fetchQuery`, `executeQuery` |
| `query` | Ad-hoc SQL builder/executor | `execute` |
| `files` | File CRUD | `upload`, `download`, `delete`, `list` |
| `logs` | Audit / activity / security logging | events: `logs.audit`, `logs.activity`, `logs.security` |
| `me` | Current user context | `info`, `update`, `devices` |
| `modules` | Core module catalog (forms, reports, dashboards) | `list`, `fetch` |
| `pages` | EJS/HTML page rendering | `render` |
| `public` | Unauthenticated utility endpoints | `ping`, `health` |
| `system` | Cluster metadata | `plugins`, `policyCatalog`, `config` |
| `userstates` | User preference persistence | `set`, `get` |
| `utils` | Validation / transformation helpers | `validate`, `transform` |
| `webhooks` | Inbound webhook execution | `runWebhook` (GET/POST) |
| `test` | Test/demo endpoints | varies |

Admin services under [api/services/admin/](../api/services/admin/) (callable only with admin role):

| Service | Purpose |
|---|---|
| `admin` | Admin gate; verifies admin role |
| `admin.apps` | Front-end application entries in `applications.json` (`list`, `info`, `create`, `update`, `delete`) |
| `admin.controls` | UI control catalogue, runtime settings |
| `admin.nodes` | Cluster node inspection |
| `admin.files` | Admin file management |
| `admin.media` | Media asset management |
| `admin.plugins` | Plugin status |

Developer services under [api/services/developers/](../api/services/developers/):

| Service | Purpose |
|---|---|
| `developers` | API explorer, test console |
| `developers.swagger` | OpenAPI/Swagger spec derived from broker action catalog |

### Shared Services

There is no distinction at the framework level between "shared" and "private" services — every service registered with the broker is reachable from any node. The convention is:

- Services named with no prefix or with a platform-owned prefix (`auth`, `tenant`, `admin.*`, `developers.*`) are platform services.
- Services prefixed with a microapp's `appid` (e.g., `billing.*`) belong to that microapp.

Use this namespaces across microapps.

### Stateless vs Stateful Services

Most services in Logiks are **stateless** — every action reads its inputs and any persistent state from DB or cache, computes, and returns. Stateless services scale linearly: run more instances, the broker round-robins.

**Stateful services** keep in-process state. Examples in this repo include:

- Service classes that hold a long-lived DB pool or queue handle.
- The Singleton-pattern jobs (cron leader).

Stateful services must either:

1. Be deployed as a singleton (use `SINGLETONMANAGER`), or
2. Externalize their state to Redis / DB.

A stateful service that runs on multiple nodes without coordination is a correctness bug.

---

## 6.2 API System

### REST APIs

REST is the primary API style in Logiks. Actions become REST endpoints in two ways:

**1. Auto-aliasing.** Routes with `autoAliases: true` (the default on `/api`, `/api/public`, `/`, `/webhooks`) pick up `rest:` annotations from actions:

```javascript
actions: {
    listInvoices: {
        rest: "GET /invoices",
        meta: { scopes: ["billing:read"] },
        async handler(ctx) { /* … */ }
    }
}
```

Exposes `GET /api/billing/invoices` automatically.

**2. Explicit aliases.** Routes can map URLs to actions directly:

```javascript
aliases: {
    "POST /webhook/:webhookid": "webhooks.runWebhook"
}
```

The five route groups defined in [api/server.js:262-996](../api/server.js#L262-L996) and their auth posture:

| Path | Auth | Whitelist | Notes |
|---|---|---|---|
| `/` | No (auth.* only) | `auth.*` | Login surface; rate-limited 10/min |
| `/webhooks` | No | `webhooks.*` | Inbound webhooks; IP whitelisted per webhook |
| `/pages` | No | `pages.*` | Page rendering for SEO/public pages |
| `/api/public` | No | `CONFIG.noauth` | Public utility actions; rate-limited 10/min |
| `/api` | **Yes** | `**` | Authenticated, RBAC-checked surface |

The URL under a group follows `<group>/<service>/<action-path>` — e.g. the `public.ping` health check is reached at `GET /api/public/public/ping`.

**Plugin endpoints.** A plugin's own routes are exposed under `/api/services/<plugin>/<path>` (each route declared in its `routes.json`; results are wrapped as `{ "status": "okay", "results": … }`). Every plugin also gets two auto-generated endpoints — `source` (its UI definitions/components) and `www` (its static assets) — which are excluded from the OpenAPI spec. See [§4.4](../04-microapps.md#44-how-a-microapp-runtime-service-works).

REST conventions:

- `GET /resource` — list
- `GET /resource/:id` — fetch one
- `POST /resource` — create
- `PUT /resource/:id` — update
- `DELETE /resource/:id` — delete

Express-style routing parameters (`:id`) become `ctx.params.id` inside the action.

### GraphQL

Not implemented in this release. Action contracts are surfaced as OpenAPI; if you need a GraphQL surface, build a GraphQL microapp that introspects the broker and projects a schema.

### RPC

Internal communication between Workers *is* RPC — every `ctx.call("service.action", params)` is an RPC call routed through Shared transporter. There is no separate public RPC endpoint (no JSON-RPC, no gRPC). REST is the public surface.

### WebSockets

A roadmap item; not present today.

### Streaming APIs

A roadmap item; not present today.

File downloads do support streaming via the `files` service.

---

## 6.3 API Gateway

### Routing

All HTTP requests enter through the gateway service created in [api/server.js:194](../api/server.js#L194). The gateway:

1. Applies global middleware (cookie parser, helmet CSP).
2. Matches the request path against route group prefixes.
3. Runs the route's `onBeforeCall` hook for domain resolution, IP whitelist, headers.
4. Authenticates (if `authentication: true`).
5. Authorizes (if `authorization: true`).
6. Applies rate-limiting (on `/api`).
7. Dispatches to the action.
8. Runs `onAfterCall` to emit `system.request_completed`.

### Authentication

The `authenticate` method ([api/server.js:1011-1172](../api/server.js#L1011-L1172)) supports five credentials types, checked in this order:

1. **TL Token** (`?tkn=…`) — Time-Limited token; IP-pinned, scope-limited (typically `/api/tenant:*`). Used for short-lived delegated access.
2. **S2S Token** (`?s2stkn=…`) — Server-to-server; IP-pinned; identifies machine clients. Max 10 active per user.
3. **API Key** (`X-API-Key` header or `?api_key=…`) — Long-lived key from `lgks_apikeys` table. Carries roles and scopes.
4. **JWT Bearer** (`Authorization: Bearer <token>`) — Standard user session token. Verified via `auth.verifyAccessToken`; subject to blacklist check on logout.
5. **None** — only valid on routes with `authentication: false` or `route.opts.authRequired === false`.

A request can carry multiple credentials. Later credentials overlay earlier ones on the `user` object — useful for, e.g., an API key plus a JWT representing the acting user.

Authentication result is attached to `ctx.meta.user`:

```javascript
{
    id, userId, sessionId, username, privilege,
    tenantId, roles: [], scopes: [], secure_hash
}
```

**Getting a token.** Log in through the `auth` service to receive an access token (and a refresh token); `auth` also issues `tltoken` and `s2stoken`. Then present it on `/api`:

```bash
# log in — returns an access token
curl -X POST http://localhost:9999/auth/login -H "Content-Type: application/json" \
  -d '{ "username": "you@example.com", "password": "••••••" }'

# call an authenticated endpoint with it
curl http://localhost:9999/api/me/info -H "Authorization: Bearer <access_token>"
```

### Authorization

The `authorize` method ([api/server.js:1178-1209](../api/server.js#L1178-L1209)) does three checks:

1. **Admin namespace gate** — actions named `admin.*` require role `admin` *or* privilege `root` / `devroot` / `admin`.
2. **Scope match** — every required scope on the action (`meta.scopes`) must match the user's scopes after tenant expansion.
3. **Tenant-aware matching** — the scope `billing:read` declared on an action matches user scopes `<tenantId>:billing:read`, `*:billing:read`, `<tenantId>:billing:read:*`, `*:billing:read:*`, or the bare `billing:read`.

Wildcards work in scopes. `*:billing:*` grants read+write on billing across all tenants — typically reserved for admin service accounts.

### Rate Limiting

Two layers:

1. **Per-route static limits** — set per route (e.g., 10/min on `/` and `/api/public` in [api/server.js:284-287](../api/server.js#L284-L287)). With built-in limiter, in-memory per node.
2. **Distributed limit** — the `applyDistributedRateLimit` method ([api/server.js:1242-1281](../api/server.js#L1242-L1281)) increments a Redis counter keyed by user / API key / IP. Window: `RATE_LIMIT_WINDOW_MS` env (default 60s). Cap: `RATE_LIMIT_MAX` (default 300). Sets `Retry-After` header on 429.

Distributed limiting is enabled on `/api` only — public/login routes use the static per-node limiter.

### Service Discovery

Service discovery from outside the cluster is via `developers.swagger`, which serialises the broker action catalog as OpenAPI 3. AI agents and client SDKs can consume this to learn what's callable.

Inside the cluster, services discover each other through the Central registry. `ctx.call` resolves names; `$node.services` and `$node.actions` enumerate the catalogue programmatically.

### API Versioning

Three patterns are used in practice:

1. **Action namespace versioning** — `billing.v2.createInvoice` vs `billing.createInvoice`. Both are routed via auto-aliasing; clients pick the path that suits them.
2. **Application `vers` field** — `applications.json.vers` advertises the front-end application's version, surfaced in `/api/application/fetch` responses so clients can branch on it. (A plugin's own version lives in its `logiks.json`.)
3. **Cluster `CONFIG.VERSION`** — overall AppServer version, exposed in headers via `X-Powered-By: Logiks Microapps AppServer` and via `system.config`.

There is no automatic Accept-Version header negotiation today. If you need version coexistence, ship both action names from the same microapp and deprecate over time.

### Error Handling

Errors thrown from actions become HTTP responses through central error handler. The framework provides a `LogiksError` class ([api/server.js:56-62](../api/server.js#L56-L62)) for consistent shaping:

```javascript
throw new LogiksError("Insufficient stock", 409, "OUT_OF_STOCK", { sku: ctx.params.sku });
```

Becomes:

```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{ "name": "LogiksError", "message": "Insufficient stock", "code": 409, "type": "OUT_OF_STOCK", "data": { "sku": "…" } }
```

Use stable `type` codes (`OUT_OF_STOCK`, `INVALID_INPUT`) — they are how clients distinguish error classes.

### Security Headers

Every response gets the following headers set in route `onBeforeCall` hooks:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `X-Powered-By: Logiks Microapps AppServer`

Plus Helmet's CSP, HSTS, Referrer-Policy, and Cross-Origin policies applied globally ([api/server.js:201-225](../api/server.js#L201-L225)).

### CORS

CORS is configured per `CONFIG.cors` and applied globally to the gateway. The sample config allows any origin and any header — tighten it for production.

### File Uploads

The `/api` route includes a multer middleware ([api/server.js:840-903](../api/server.js#L840-L903)) that handles three upload modes:

| Path | Mode |
|---|---|
| `POST /api/files/upload` | Single file, field `file` |
| `POST /api/files/uploadbulk` | Array, field `files`, max 50 |
| Other `POST /api/*` | Any files, fields keyed dynamically |

Uploaded paths are exposed on `ctx.meta.file`, `ctx.meta.files`, or `ctx.meta[fieldname]`.

---

## 6.4 API Reference, Examples & Explorer

The endpoint reference is generated, not hand-written, so it never drifts out of date. The `developers.swagger` service ([api/services/developers/swagger.service.js](../api/services/developers/swagger.service.js)) builds an OpenAPI 3 document from the live action catalogue across every node — every `rest:`-annotated action, its params, and its scopes. It includes a plugin's routes as soon as the Worker hosting them joins.

**Live spec** (development/staging — disabled in production):

```
GET /api/developers.swagger/openapi.json
```

Load that JSON into Swagger UI, Postman, or an SDK generator for a browsable, always-current reference.

**Interactive explorer.** Open **[/explorer](/explorer)** — a same-origin tool that loads the spec, lets you paste a Bearer token or API key, and call endpoints with "Try it out". Being same-origin, there are no cross-origin issues. The spec is off in production (`isProd`/`isStaging`); point the explorer at a dev/staging host to use it.

**Examples**

```bash
# Unauthenticated health check
curl http://localhost:9999/api/public/public/ping

# Authenticated call with an API key
curl http://localhost:9999/api/me/info -H "X-API-Key: <your-key>"

# A plugin route
curl "http://localhost:9999/api/services/demo/" -H "Authorization: Bearer <token>"
```

To make your actions read well in the reference, give them a clear `name`, populated `params`, and a short `description`; AICore's tool catalogue draws on the same metadata.

---

> **Next:** [§7 Event System](07-event-system.md) — the platform's eventing model, well-known topics, and distributed messaging patterns.