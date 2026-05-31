# 1. Introduction

> For app developers building on Logiks, platform engineers operating it, and architects evaluating it. Later chapters split by role.

---

## 1.1 What is Logiks?

### Framework Overview

**Logiks Microapps AppServer** is a Node.js framework for running many small applications — *microapps* — on one self-orchestrating runtime. Each microapp is developed, packaged, and deployed on its own, but shares a common substrate for authentication, data access, eventing, file handling, and UI rendering.

Underneath sits a clustered service layer, the **MicroApp Runtime**, which handles service discovery, transport, and clustering. On top of it Logiks adds the things an enterprise IT team needs to host dozens of internal apps without running a microservice platform to do it: multi-tenancy, RBAC, federated auth, a rule engine, a webhook gateway, a page renderer, and a singleton coordinator.

### An AI-First Platform

Logiks treats AI as a tier of the architecture rather than a bolt-on. The 4th tier — **AICore** — is where agentic capability lives, and other tiers and microapps depend on it.

```
Microapps (domain solutions — extend AICore with skills + tools)
        │ AICORE.sendMessage / runSkill / memory / registerSkill / …
        ▼
AICore  (api/controllers/aicore.js)   ← Tier 4
        · Skill registry · Context engine · Memory · Vector DB · Agent loops · Tools
        │ engine.sendMessage
        ▼
Engine  (LogiksAI default; Ollama / Claude / OpenAI as adapters)
        │ calls
        ▼
Hosted or local LLM service
```

- **AppServer** runs the classic three tiers — UI rendering (T1), business logic and the broker (T2), data/storage (T3) — and hosts the new T4.
- **AICore** (Tier 4) is the agentic layer: skill registry, context engine, memory, vector DB connections, agent loops, tools, policy controls.
- **AIEngine** ([api/controllers/aicore/aiengine.js](../api/controllers/aicore/aiengine.js)) is the provider contract; concrete engines (LogiksAI today; Ollama/Claude/OpenAI planned) sit beside it.
- **Microapps** consume AICore and add their own skills and tools; they don't rebuild the agentic stack.

What runs today is the spine: a microapp calls `AICORE.sendMessage`, which dispatches to the configured engine. The registry, context engine, memory, vector store, and agent loops described above are the design AICore is being built toward. [§8 AI Layer](08-ai-layer.md) tracks what exists versus what's planned, piece by piece.

### Distributed By Nature

A Logiks deployment is rarely one process. The AppServer in this repository is one node — the **Gateway** — and additional **Worker** nodes (from the [Logiks-Microapps-Worker-NodeJS](https://github.com/Logiks/Logiks-Microapps-Worker-NodeJS) boilerplate) join the cluster over the transporter to host more microapps. Nodes discover each other automatically, share a Redis cache and a MySQL data tier, and elect singleton leaders for work that must run once, such as background jobs and migrations.

### Design Principles

1. **A microapp is a unit of business capability, not a service.** Packaging happens at the app level — UI, server logic, routes, schema — not the function level.
2. **Convention where it can be, contracts where it must be.** Directory layout and globals are convention; auth tokens, RBAC scopes, and DB schemas are formal contracts.
3. **The framework owns orchestration.** Service discovery, circuit-breaking, bulkheading, rate-limiting, and leader election are the platform's job, not the operator's.
4. **Globals are the public API of the runtime.** Every file in [api/helpers/](../api/helpers/) and [api/controllers/](../api/controllers/) loads as an uppercase global on every node (`MESSAGING`, `_DB`, `AUTHKEY`, `ENCRYPTER`, `AICORE`, …). Microapps call them directly. Helpers are reachable cluster-wide through `system.helpers`; controllers that return `true` from `initialize()` are reachable through `system.controllers`. Full reference: [§3.4](03-framework-fundamentals.md#34-controllers--helpers-reference).
5. **Multi-tenancy is the default.** Every request resolves a tenant via domain → app mapping before authorization runs.

### Why Logiks Exists

Enterprises accumulate applications faster than they can rationalise them. Each one tends to bring its own auth, its own DB conventions, its own deployment story, its own front-end stack. Logiks exists to fold that sprawl into one runtime, one auth surface, one data tier, and one operator playbook, with many microapps on top. The aim is to make the marginal cost of the next app close to zero, while the runtime handles horizontal and vertical scaling, so developers can spend their time on the business problem instead of the production plumbing around it.

### Core Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  AppServer (Gateway) — this repo                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ Main ServiceBroker                                              │ │
│  │  · API Gateway (5 route groups: /, /webhooks, /pages,           │ │
│  │       /api/public, /api)                                        │ │
│  │  · Auth (JWT / API key / S2S / Time-Limited / Federated)        │ │
│  │  · Tenant resolver, RBAC, rate limiter, geofence guard          │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│       │ Transporter (Redis / NATS / MQTT / TCP)                       │
└───────┼──────────────────────────────────────────────────────────────┘
        │
   ┌────┴─────┐    ┌──────────┐    ┌──────────┐
   │ Worker 1 │    │ Worker 2 │ …  │ Worker N │   ← Logiks-Microapps-Worker-NodeJS
   │ plugins/ │    │ plugins/ │    │ plugins/ │     instances
   └──────────┘    └──────────┘    └──────────┘
        │              │               │
        └────────┬─────┴──────┬────────┘
                 ▼            ▼
            ┌────────┐   ┌─────────┐
            │ Redis  │   │  MySQL  │   (appdb + logdb)
            └────────┘   └─────────┘
```

The Gateway terminates HTTP; Workers host microapps. A service published by any node is callable from any other node through the broker, so an HTTP request lands on the Gateway and fans out to Workers without the caller knowing where the code runs.

### Key Features

- **Self-orchestrating cluster** — circuit breakers, bulkheads, retry policies, and heartbeats configured at the broker level ([api/server.js:80-180](../api/server.js#L80-L180)).
- **Distributed rate limiting** — per-identifier Redis counters, configurable per route ([api/server.js:1242-1281](../api/server.js#L1242-L1281)).
- **Multi-strategy authentication** — JWT bearer, API key, server-to-server token, time-limited token, federated SSO.
- **Tenant-aware RBAC** — scopes evaluated against `${tenantId}:${scope}` patterns with wildcards ([api/server.js:1213-1237](../api/server.js#L1213-L1237)).
- **Hot-pluggable microapps** — a microapp is a folder with a `logiks.json` manifest in a Worker's `plugins/`; the Worker loads it on start and announces it to the cluster, no AppServer restart needed ([§4](04-microapps.md)).
- **Two databases by design** — `appdb` for operational data, `logdb` for audit and security logs, with independent retention.
- **Rule engine** — `json-rules-engine` behind the `RULEENGINE` global for declarative business rules.
- **Webhook gateway** — inbound endpoints with logging and IP whitelisting.
- **Page rendering** — file-based EJS/HTML templates under `/pages` with per-app theme overrides.
- **Singleton coordinator** — Redis-backed leader election so cluster-wide tasks (cron, migrations) run exactly once.

### Compared to a Monolith

| | Monolith | Logiks |
|---|---|---|
| Deployment unit | Whole app | One microapp |
| Internal coupling | Code-level imports | Action calls + events |
| Independent scaling | No | Yes (per Worker) |
| Operational complexity | Low | Low — orchestration is built in |
| Failure isolation | App-wide | Microapp-bounded |

You get modularity and independent deployment without standing up a microservice platform to support it.

### Compared to Microservices

| | Microservices (K8s) | Logiks |
|---|---|---|
| Discovery | Service mesh / DNS | MicroApp Runtime registry |
| Scaling | HPA + cluster autoscaler | Per-Worker process model |
| Auth/RBAC | Sidecar / API gateway | Built-in |
| Circuit breaker / retries | Service mesh | Broker config |
| Observability glue | Operator's job | Framework defaults |

The cluster benefits — discovery, isolation, scaling, resilience — come without Kubernetes or a mesh to operate.

### Compared to Plugin Platforms (October CMS, WordPress)

| | Classic plugin platform | Logiks |
|---|---|---|
| Plugin lifetime | Process-local | Cluster-wide |
| Plugin isolation | Shared memory | Process/node boundary |
| Multi-host | Sticky session or replication | Native |
| Inter-plugin calls | In-process function call | Runtime action (local or remote) |
| Hot reload | Usually | Yes |

Plugins in legacy platforms share one process. Logiks microapps spread across nodes and still address each other by service name.

### Compared to Node.js Frameworks (NestJS, Moleculer, Strapi)

The Node.js ecosystem has strong frameworks, but most target *one application*. Logiks targets *many*.

| | NestJS | Moleculer (alone) | Strapi | Logiks |
|---|---|---|---|---|
| Primary unit | One app, many modules | One node, many services | One CMS, many plugins | One cluster, many microapps |
| Multi-tenancy | DIY | DIY | DIY (paid) | First-class (domain → appid → tenant) |
| Auth / RBAC | DIY | DIY | Built-in (content) | Built-in, tenant-aware |
| Service discovery | DIY | Native | N/A (single process) | Native |
| Distributed runtime | DIY (opt-in module) | Native | Vertical scale | Native (any Worker callable from any other) |
| Opinionated stack | Light (DI + decorators) | Light (transport + actions) | Heavy (CMS-first) | Heavy (apps + tenancy + RBAC + rules + pages) |
| Plugin model | Modules | Services | Strapi plugins (process-local) | Microapps (cluster-wide, hot-pluggable) |

NestJS wins for a single well-structured app; Moleculer alone for microservices where you bring your own stack; Strapi for content-first APIs. Logiks pulls a clustered runtime and an enterprise IT stack under one auth / data / eventing / RBAC surface, and adds the multi-microapp deployment model on top.

### Compared to Python Multi-App Frameworks (Django, Frappe, FastAPI)

Django (project + many apps) and Frappe (multi-app, multi-tenant, IT-focused) are the closest analogues; FastAPI is a peer to Express.

| | Django | Frappe | FastAPI | Logiks |
|---|---|---|---|---|
| Apps per process | Many (one project) | Many | One (or composed) | Many (per Worker, replicated) |
| Multi-tenancy | DIY / `django-tenants` | First-class | DIY | First-class |
| Cluster-native | Workers behind LB | Limited | Uvicorn workers | Native (broker + transporter) |
| Data layer | Django ORM | DocType + MariaDB | DIY (SQLAlchemy) | DB layer with JSON |
| Admin UI | Built-in | Built-in (Desk) | None | AdminCP microapp |
| Background jobs | `celery` (external) | Built-in scheduler | DIY | Built-in (`AUTOJOBS` + singleton) |
| Hot reload of apps | No | Limited | No | Yes |
| AI layer | DIY | DIY | DIY | Tier 4 (`AICORE`) |

Django suits content-rich apps with one mature ORM + admin; Frappe suits ERP-style IT where DocType fits. Frappe is the nearest peer; Logiks differs by being distributed and broker-mediated rather than a monolith with a scheduler.

### Compared to Go Microservice Frameworks (Go-Micro, Kratos, Encore)

Go's ecosystem leans toward service toolkits rather than multi-app platforms.

| | Go-Micro | Kratos | Encore | Logiks |
|---|---|---|---|---|
| Primary unit | Services | Services | Services | Microapps (services + UI + data + i18n) |
| Service discovery | etcd / consul / mDNS | etcd / consul | Built-in | Built-in (runtime registry) |
| Transport | gRPC + brokers | gRPC | gRPC / HTTP | Pluggable (Redis / NATS / MQTT / TCP) |
| Multi-tenancy | DIY | DIY | DIY | First-class |
| Auth / RBAC | DIY | DIY | Managed | Built-in |
| UI / pages | None | None | None | Built-in (`/pages`, EJS, themes) |
| Background jobs | DIY | DIY | Built-in | Built-in |
| AI layer | None | None | None | Tier 4 |
| Performance ceiling | Higher (Go) | Higher (Go) | Higher (Go) | Lower (Node.js) |
| Operational maturity | High | High | Managed | Moderate (younger) |

Go frameworks compete on raw service throughput and operability; Logiks competes on app-level cohesion and multi-tenant business semantics. Where you need Go's performance, a specialised Worker can front Go services on the same cluster — the substrate at one layer doesn't lock the others.

### What Logiks Is Not

1. **Not a general-purpose web framework.** For a single Express app, reach for something lighter. Logiks pays off when you have many microapps sharing infrastructure.
2. **Not a Kubernetes replacement.** It orchestrates microapps inside its own runtime; it doesn't aim to replace K8s for container orchestration.
3. **Not a standalone agent toolkit.** AICore is part of the platform (Tier 4), but the deep agent tooling — vector stores, prompt pipelines, multi-agent control — lives behind AICore's interfaces, and much of it is still being built ([§8](08-ai-layer.md)). You consume AICore; you don't assemble an agent runtime yourself.

---

## 1.2 Core Concepts

### MicroApp (Plugin)

A microapp is a folder with a `logiks.json` manifest, placed in a Worker's `plugins/` directory. The folder name is its identity. It holds the server logic (`api.js`), the HTTP routes and event subscriptions (`routes.json`), UI definitions (`forms/`, `reports/`, `dashboards/`, `pages/`, `component/`, `menu/`), and its own DB schema (`dbschema/`). A Worker discovers and loads every such folder on startup, and the microapp becomes callable across the cluster. *Microapp* and *plugin* mean the same thing here. Full anatomy: [§4](04-microapps.md).

This is distinct from the AppServer's *application* config (`misc/applications.json` + the `lgks_domains` table), which describes a front-end app — its branding, theme, login screen, and the domain it answers on. An application config points a domain at a UI shell; a plugin is the capability behind it. The two are configured separately.

### Worker

A long-lived Node.js process that hosts microapps. The AppServer in this repo is a **Gateway** Worker — it terminates HTTP and routes requests to actions, which may run on this node or another. The [Logiks-Microapps-Worker-NodeJS](https://github.com/Logiks/Logiks-Microapps-Worker-NodeJS) boilerplate produces additional Workers that join the cluster purely to run microapp logic.

### MicroApp Server / Gateway

The **MicroApp Server** is the public face of a cluster: a Worker configured as a **Gateway**. It terminates HTTP, applies CORS / Helmet / session middleware, resolves the requesting domain to its application config (via `lgks_domains` and `applications.json`), authenticates the caller (JWT / API key / S2S / TL / federated SSO), authorizes through tenant-aware RBAC, rate-limits, and dispatches to the matching action — locally if the target lives here, or across the transporter to the Worker that hosts it.

The Gateway also hosts the platform services (`auth`, `webhooks`, `pages`, `admin.*`, `developers.*`, `system`, `tenant`) that every microapp leans on. In a clustered deployment, several Gateway replicas can sit behind a load balancer; sessions and rate-limit counters live in Redis, so any replica can serve any request. Implementation: [api/server.js](../api/server.js), where the gateway service is created at [line 194](../api/server.js#L194) and exposes five route groups (`/`, `/webhooks`, `/pages`, `/api/public`, `/api`).

Behind the Gateway sit the other Worker flavours (see [§5 Workers](05-workers.md)):

- **Runtime** — hosts microapp code; no public HTTP.
- **Cluster** — coordination and singleton tasks (jobs, migrations).
- **Specialized** — purpose-built (search index, AI inference, heavy compute).

### Contract

The formal interface a microapp exposes:
- **Formal** — action parameter schemas, DB table schemas under [misc/dbschema/](../misc/dbschema/), JWT/scope shapes, webhook payload definitions.
- **Conventional** — directory layout, naming patterns, event names, and the uppercase-globals API.

Catalogue: [§4.3 MicroApp Contracts](04-microapps.md#43-microapp-contracts).

### Service

A named collection of actions and event handlers on the MicroApp Runtime. Platform services live in [api/services/](../api/services/); microapp services live in each Worker's `services/` and `plugins/*/services/`. Examples: `auth`, `webhooks`, `pages`, `admin.apps`, `admin.plugins`.

### Cluster

The set of Workers in one namespace, connected through a single transporter, sharing Redis (cache, sessions, locks) and a MySQL tier (appdb, logdb). Joining requires matching `TRANSPORTER` and `NAMESPACE` plus the `CLUSTER_TOKEN`.

### AI Layer

**AICore** ([api/controllers/aicore.js](../api/controllers/aicore.js)) is the 4th tier and the central agentic layer. Its intended surface:

- **Skill registry** — registered skills (prompt + tools + memory scope + input schema) callable by id.
- **Context engine** — assembles per-request context (user, tenant, history, retrieval hits, environment) before each LLM call.
- **Memory** — semantic (vector DB) and episodic (key-value), scoped per skill.
- **Vector DB connections** — managed centrally; microapps don't address the store directly.
- **Agent loops** — multi-step LLM interaction with tool calling and termination logic.
- **Tools** — sourced from broker actions (auto-discovered) and AICore helpers.
- **Policy controls** — guardrails on what can be invoked, by whom.

Below AICore is the **engine layer** (`AIEngine`) that adapts to providers — LogiksAI today; Ollama/Claude/OpenAI planned. Today the working path is `AICORE.sendMessage` → engine; the registry, context engine, memory, and agent loops are in progress. Microapps consume AICore's interfaces and extend the registry with their own skills and tools rather than chaining primitives themselves. Design and current state: [§8 AI Layer](08-ai-layer.md).

### Event Bus

The broker doubles as an event bus. Services emit named topics; subscribers on any node consume them. The transporter (Redis / NATS / MQTT / TCP) sets delivery semantics. Built-in topics include `system.request_completed`, `logs.audit`, and `logs.activity`. Emit with `ctx.emit("topic", payload)`. See [§7 Event System](07-event-system.md).

### Runtime

The shared global namespace populated at boot. Uppercase globals (`BASEAPP`, `LOGGER`, `_CACHE`, `_DB`, `AUTHKEY`, `MISC`, `TENANT`, `ENCRYPTER`, `RULEENGINE`, `MESSAGING`, …) are the platform API every microapp uses without imports. They load from [api/helpers/](../api/helpers/) and [api/controllers/](../api/controllers/) in [api/baseapp.js](../api/baseapp.js).

### Plugin

A synonym for *microapp*. A Worker treats the microapps it hosts as plugins in its `plugins/` folder.

---

## 1.3 Architecture Overview

### 4-Tier Architecture (T4)

Logiks extends the classic 3-tier model — UI / business logic / data+storage — with a fourth tier for AI. The `aicore.js` header states it directly: "this layer itself forms the 4th Layer for T4 architecture of Logiks."

```
Tier 1 — UI Layer             pages, layouts, components, menus, i18n, themes;
                              served via /pages; ReactJSX/EJS/HTML/Vue; per-app CSS/JS

Tier 2 — Business Logic       services, controllers, helpers, rule engine, microapp
                              action handlers, RBAC, tenant resolution

Tier 3 — Data & Storage       MySQL appdb + logdb; Redis cache + sessions + locks;
                              local/S3 file storage; vector DB (Qdrant) for AI

Tier 4 — AI Layer             AICore — skill registry, context engine, memory,
                              vector DB connections, agent loops, tools, policy
```

The AppServer supplies the infrastructure for all four: the page renderer for T1, the broker + platform services + globals for T2, the data/storage abstractions (`_DB`, `_CACHE`, `FILES`) for T3, and `AICORE` for T4. A microapp is a thin slice across the tiers that delivers one capability. Workers host T1/T2 microapp code and reach T3/T4 through the cluster.

### Distributed Runtime Model

Every Worker is a self-contained Node.js process running a ServiceBroker. Brokers connect over a transporter and exchange registries on heartbeat. An action call resolves through the registry — local if the action lives here, transparently remote otherwise. The application code is identical either way.

### Hot-Pluggable Modules

Three things are hot-pluggable:

1. **Microapps** — a `plugins/<id>/` folder with a `logiks.json`; the Worker loads it on start (and can reload its plugin tree), no AppServer restart needed ([§4.3](04-microapps.md#43-how-a-worker-loads-plugins)).
2. **Vendor integrations** — connectors (SMTP, payment, storage) in the `sys_vendors` table, picked up by [api/controllers/vendors.js](../api/controllers/vendors.js).
3. **Rules** — `sys_logiksrules` rows loaded by `RULEENGINE` at runtime.

Core services in `api/services/*.service.js`, and a plugin's own `api.js`, change with a process restart.

### Multi-Node Deployment

Run N Workers with the same `TRANSPORTER` and `NAMESPACE`, each with a unique `SERVER_ID`. They auto-discover and share load. The Gateway can be replicated behind an L4/L7 load balancer; Workers don't need one, since the broker distributes calls.

### Runtime Discovery

The runtime registry is the source of truth. The broker tracks every known service across every node and updates it on each heartbeat (`heartbeatInterval: 10s`, [api/server.js:124](../api/server.js#L124)). A new Worker is callable within about one heartbeat; a dead one is dropped within `heartbeatTimeout` (30s).

### Dependency Injection Model

There's no classical DI container. Dependencies arrive three ways:
1. **Globals** — uppercase modules attached to `global` at boot (see [Runtime](#runtime)).
2. **`ctx.meta`** — request-scoped data set by route `onBeforeCall` hooks: `appInfo`, `user`, `tenantInfo`, `remoteIP`, etc.
3. **`ctx.call()`** — services invoke each other by name; the broker resolves the node.

### Event-Driven Architecture

Action calls handle request/response; events handle fan-out. The framework emits structured events for request completion, auth, errors, and webhook reception. Microapps subscribe by declaring `events: { "topic.name"(payload) { … } }` in a service. See [§7 Event System](07-event-system.md).

### AI Orchestration Layer

Orchestration is meant to happen inside AICore: a microapp sends a message or invokes a skill, and AICore assembles context, renders the skill, calls the LLM, runs tool calls, updates memory, and emits audit — one loop, one call from the microapp's side. Today that loop is partly built; the working path is the message → engine round-trip. The platform already contributes the pieces AICore weaves in:

1. The typed action catalogue becomes the broker side of the tool registry.
2. RBAC scopes and audit apply when AICore runs tool calls on a microapp's behalf.
3. Event topics let AICore track platform activity as context.

[§8 AI Layer](08-ai-layer.md) has the loop's intended shape and the current state of each piece.

---

> **Next:** [§2 Getting Started](02-getting-started.md) — installing, running, and building your first microapp.
