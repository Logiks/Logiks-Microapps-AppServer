# Logiks API Reference

How to authenticate against the AppServer and call its endpoints — platform services and plugin routes alike. For the **exact, always-current** list of endpoints, use the live OpenAPI spec and the interactive explorer described in [§7](#7-live-spec--interactive-explorer); this page explains the model around it.

> This document and the explorer are served by the AppServer itself (under `/docs/private/`), so you can read and try the API from the same origin.

---

## 1. Base URL & Route Groups

All HTTP traffic enters through the gateway, which exposes five route groups ([api/server.js](../../api/server.js)):

| Group | Auth | Used for |
|---|---|---|
| `/` | none (login surface) | `auth.*` — login, token issuance; rate-limited |
| `/webhooks` | none (IP-whitelisted per webhook) | inbound webhooks |
| `/pages` | none | server-rendered pages |
| `/api/public` | none | unauthenticated utilities (ping, health) |
| `/api` | **required** | the authenticated, RBAC-checked surface |

The URL pattern under a group is `<group>/<service>/<action-path>`. For example the health check is:

```
GET /api/public/public/ping        →  route group /api/public + service "public" + action "ping"
```

Plugin endpoints follow the same shape under `/api/services` (see [§5](#5-plugin-endpoints)).

Base URL in development is `http://localhost:9999`. Replace it with your deployment host.

---

## 2. Authentication

The gateway accepts four credential types ([§6.3](../06-core-services-and-apis.md#63-api-gateway)). It checks them in this order; later credentials overlay earlier ones on the user object.

| Type | How to send | Notes |
|---|---|---|
| **JWT Bearer** | `Authorization: Bearer <token>` | Standard user session; obtained from the login flow |
| **API Key** | `X-API-Key: <key>` or `?api_key=<key>` | Long-lived key from `lgks_apikeys`; carries roles/scopes |
| **S2S token** | `?s2stkn=<token>` | Server-to-server; IP-pinned; for machine clients |
| **TL token** | `?tkn=<token>` | Time-limited, IP-pinned, scope-limited; for short-lived delegated access |

### Getting a JWT

Log in through the `auth` service to receive an access token (and a refresh token). The auth actions include `login`, `refresh`, `logout`, `logout-all`, `tltoken`, `s2stoken`, and the `verify*` checks. Use the explorer to confirm the exact request body for your build, then:

```bash
# 1. Log in (returns an access token)
curl -X POST http://localhost:9999/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "username": "you@example.com", "password": "••••••" }'

# 2. Call an authenticated endpoint with the token
curl http://localhost:9999/api/me/info \
  -H "Authorization: Bearer <access_token>"
```

Authorization is scope-based and tenant-aware: an action that requires `billing:read` is satisfied by a user scope of `<tenantId>:billing:read`, `*:billing:read`, the wildcard variants, or the bare `billing:read`. Actions under `admin.*` also require an admin role or `root`/`devroot`/`admin` privilege.

---

## 3. Request & Response Conventions

- **Verbs:** `GET` list / fetch, `POST` create, `PUT` update, `DELETE` remove.
- **Path params:** `:id` in a route becomes `ctx.params.id`.
- **Body:** JSON (`Content-Type: application/json`). Where an action declares `params`, the gateway validates the body before the handler runs and rejects mismatches.
- **Success:** JSON payload (plugin routes wrap results as `{ "status": "okay", "results": … }`).

### Errors

Errors use a consistent shape (`LogiksError`):

```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{ "name": "LogiksError", "message": "Insufficient stock", "code": 409, "type": "OUT_OF_STOCK", "data": { "sku": "…" } }
```

Branch on the stable `type` code, not the message.

### Rate limiting

`/api` is rate-limited per identifier (user / API key / IP). On breach you get `429` with a `Retry-After` header. Window and cap are `RATE_LIMIT_WINDOW_MS` (default 60s) and `RATE_LIMIT_MAX` (default 300). Login and `/api/public` use a tighter per-node limiter.

---

## 4. Core Platform Endpoints

A representative map of the platform services ([§6.1](../06-core-services-and-apis.md#61-service-layer)). The explorer lists the exact methods, paths, and parameters.

| Service | Purpose | Example actions |
|---|---|---|
| `auth` | Login, tokens, verification | `login`, `logout`, `refresh`, `tltoken`, `s2stoken`, `verifyAccessToken` |
| `public` | Unauthenticated utilities | `ping`, `health` |
| `me` | Current user context | `info`, `update`, `devices` |
| `application` | App metadata, theme, pages | `fetch`, `settings`, `pages`, `theme` |
| `data` | Master lists (`do_lists`) | `listGroups`, `fetch`, `fetchFiltered`, `upsert` |
| `dbops` | Stored parameterised queries | `storeDBOpsQuery`, `fetchQuery`, `executeQuery` |
| `query` | Ad-hoc SQL builder | `execute` |
| `files` | File CRUD / upload | `upload`, `download`, `delete`, `list` |
| `modules` | Core module catalogue | `list`, `fetch` |
| `system` | Cluster metadata | `plugins`, `policyCatalog`, `config` |
| `webhooks` | Inbound webhook execution | `runWebhook` |
| `admin.*` | Admin-only operations (require admin role) | `admin.apps`, `admin.plugins`, `admin.nodes`, `admin.controls` |
| `developers.swagger` | OpenAPI spec (dev/staging only) | `spec` → `GET .../openapi.json` |

---

## 5. Plugin Endpoints

A plugin's routes are exposed under `/api/services/<plugin>`:

```
GET  /api/services/<plugin>/<path>     # a route declared in the plugin's routes.json
```

Every plugin also gets two helper endpoints automatically (excluded from the OpenAPI spec): `source` (serves the plugin's UI definitions/components) and `www` (serves its static assets). See [§4.4](../04-microapps.md#44-how-a-microapp-runtime-service-works).

---

## 6. Examples

```bash
# Unauthenticated health check
curl http://localhost:9999/api/public/public/ping

# Authenticated call with an API key
curl http://localhost:9999/api/me/info -H "X-API-Key: <your-key>"

# Call a plugin route
curl "http://localhost:9999/api/services/demo/" -H "Authorization: Bearer <token>"
```

---

## 7. Live Spec & Interactive Explorer

The server generates an OpenAPI 3 document from its live action catalogue ([swagger.service.js](../../api/services/developers/swagger.service.js)). It reflects every `rest:`-annotated action across every connected node, so it is always current — including plugin routes as soon as their Worker joins.

- **Spec endpoint** (development/staging — disabled in production):
  ```
  GET /api/developers.swagger/openapi.json
  ```
- **Interactive explorer:** open **[/explorer](/explorer)** (served alongside this page). Paste a Bearer token or API key, load the spec, and call endpoints directly with "Try it out". It defaults to this origin's spec URL and lets you override it.

Because the explorer is served from the same origin as the API, there are no cross-origin issues when trying endpoints.

> The spec is intentionally off in production (`isProd`/`isStaging`). To explore against a production-like host, point the explorer at a development or staging instance, or temporarily enable the service there.
