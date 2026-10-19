# Data Flow Diagram

How data moves through the AppServer. Sources: [api/server.js](../api/server.js), [api/baseapp.js](../api/baseapp.js), [api/controllers/aicore/](../api/controllers/aicore/), [docs/05-workers.md](05-workers.md), [docs/09-ai-layer.md](09-ai-layer.md).

Legend: rectangles are external entities, rounded boxes are processes, cylinders are data stores.

## Level 0: context

```mermaid
flowchart LR
    Client["Browser / Mobile / API client"]
    Ext["Third-party systems<br/>(webhook senders, SMTP, vendors)"]
    LLM["LLM providers<br/>(Anthropic, OpenAI, LogiksAI)"]
    Vec["Vector-Gateway<br/>+ Tooling server"]
    Worker["Workers hosting microapps<br/>(plugins)"]

    App(("Logiks<br/>AppServer"))

    Client -- "HTTP requests, uploads,<br/>SSE / fabric streams" --> App
    App -- "JSON responses, files,<br/>events" --> Client
    Ext -- "webhook payloads" --> App
    App -- "email, outbound calls" --> Ext
    App -- "prompts, tool schemas" --> LLM
    LLM -- "messages, tool-call requests" --> App
    App -- "search / extract requests" --> Vec
    Vec -- "documents, extracted text" --> App
    App -- "action calls over transporter" --> Worker
    Worker -- "results, DB access via helpers" --> App
```

## Level 1: request path and platform stores

```mermaid
flowchart TB
    Client["Client"]

    subgraph GW["Gateway (api/server.js, Moleculer API service)"]
        direction TB
        R1("1. Route match<br/>/ (auth) · /api · /api/public<br/>/pages · /webhooks · /mcp<br/>/fabric · /api/events")
        R2("2. Domain to app resolve<br/>BASEAPP.getAppForDomain")
        R3("3. Rate limit<br/>Redis counter")
        R4("4. Authenticate<br/>JWT · API key · S2S · TL token · federated")
        R5("5. Authorize<br/>admin namespace, tenant scopes, RBAC")
        R1 --> R2 --> R3 --> R4 --> R5
    end

    Broker("6. Service broker<br/>Moleculer, transporter, load balancer,<br/>circuit breaker, bulkhead")

    subgraph SVC["Gateway services (api/services)"]
        S1("auth · me · tenant · application")
        S2("data · query · dbops · pages · modules")
        S3("files · webhooks · sse · logs")
        S4("admin.* · developers.*")
        S5("ai: agents · tasks · knowledge")
    end

    subgraph GLOB["Autoloaded globals (api/helpers, api/controllers)"]
        G1("_DB / DBOPS / QUERY<br/>DB helpers")
        G2("RBAC · ABAC · AUTHKEY · AUTHTOKEN")
        G3("QUEUE · MESSAGING · HOOKS")
        G4("AICORE · KNOWLEDGE · TOOLING · MCP")
        G5("FILES · FABRIC · AUTOJOBS")
    end

    Worker("Workers / microapps<br/>plugins with routes.json + api.js")

    AppDB[("appdb<br/>sys_*, lgks_*, do_lists")]
    LogDB[("logdb<br/>log_ai_*, audit")]
    Redis[("Redis<br/>sessions, cache, rate limit,<br/>circuit state")]
    Queue[("Queue<br/>NATS / RabbitMQ")]
    Files[("Local storage<br/>uploads/")]
    Cfg[("Config<br/>.env, config.json, system.json,<br/>misc/applications.json")]

    Client --> R1
    R5 --> Broker
    Broker --> SVC
    Broker -- "action call" --> Worker
    Worker -- "result" --> Broker
    Broker -- "response" --> Client

    SVC --> GLOB
    Worker -. "uses platform globals<br/>via system.helpers / system.controllers" .-> GLOB

    G1 <--> AppDB
    G1 -- "audit, SQL log" --> LogDB
    G2 <--> AppDB
    G2 <--> Redis
    G3 <--> Queue
    G5 <--> Files
    R3 <--> Redis
    R4 <--> Redis
    R2 --> Cfg
    GLOB --> Cfg
```

## Level 1: webhook and event paths

```mermaid
flowchart LR
    Ext["Webhook sender"] --> WH("/webhooks route<br/>verify, resolve app")
    WH --> WS("webhooks.service")
    WS --> Q[("Queue")]
    WS --> AppDB[("appdb")]
    Q --> Sub("Subscribers<br/>gateway + worker microapps")
    Sub --> AppDB
    Sub --> SSE("sse.service / /api/events")
    SSE --> Client["Client (live updates)"]

    Cron("AUTOJOBS<br/>lgks_autojobs, node-cron") --> Sub
```

## Level 2: AI layer (AICore, the 4th tier)

```mermaid
flowchart TB
    Caller["Client via /ai/* REST<br/>or microapp calling AICORE.*"]

    subgraph CORE["AICore (api/controllers/aicore)"]
        direction TB
        Entry("Entry: sendMessage / runAgent /<br/>queueAgentRun / basics")
        Load("Load agent + persona<br/>(allowed tools, knowledge, model)")
        Hist("Load conversation history<br/>conversations.js")
        RAG("RAG delivery<br/>forced / on_demand / both")
        Loop("Agent loop<br/>agentLoop.js, up to max_steps")
        Res("Resilience<br/>retry, timeout, circuit breaker,<br/>fallback by engine priority")
        Eng("Engine adapter<br/>claude · openai · logiksai")
        Tool("Tool dispatch<br/>tooling.js to MCP registry")
        Persist("Persist turn")
    end

    Personas[("appdb<br/>sys_ai_personas · sys_ai_agents<br/>sys_ai_tasks · sys_ai_knowledge")]
    Conv[("logdb<br/>log_ai_conversations · log_ai_messages")]
    Hot[("Redis _CACHE<br/>hot buffer, breaker state")]
    Q[("NATS<br/>aicore.agent.run")]
    LLM["LLM provider"]
    VG["Vector-Gateway<br/>(per knowledge base)"]
    TS["Tooling server<br/>/list_tools, /run"]
    MCPTools("MCP tools<br/>query_schema · query_index<br/>query_analyse · query_results<br/>knowledge_search · create_task")
    Data[("Tenant data<br/>via _DB")]
    Jobs("AUTOJOBS cron row")

    Caller --> Entry
    Entry -- "async=true" --> Q
    Q --> Entry
    Entry --> Load
    Load <--> Personas
    Load --> Hist
    Hist <--> Hot
    Hist <--> Conv
    Hist --> RAG
    RAG -- "query" --> VG
    VG -- "matching chunks" --> RAG
    RAG --> Loop
    Loop --> Res --> Eng
    Eng <--> LLM
    Eng --> Loop
    Loop -- "tool call" --> Tool
    Tool --> MCPTools
    MCPTools <--> Data
    MCPTools -- "knowledge_search" --> VG
    MCPTools -- "create_task" --> Personas
    Personas -. "recurring tasks" .-> Jobs
    Jobs -. "enqueue run" .-> Q
    Tool -- "tool result" --> Loop
    Loop -- "final answer" --> Persist
    Persist --> Conv
    Persist --> Hot
    Persist --> Caller

    KN("KNOWLEDGE.extract") --> TS
    TS -- "extracted text" --> KN
    KN -- "index counters" --> Personas
    KN -- "upload to base" --> VG
```

## Level 2: plugin (microapp) flow

Plugins live in a Worker's `plugins/` folder (Microapps-Worker-NodeJS repo), not in this repo. This repo is the gateway that routes to them and the cluster registry that tracks them. See [docs/04-microapps.md](04-microapps.md).

### Startup: how a plugin becomes a service

```mermaid
flowchart TB
    Folder[("plugins/&lt;pluginID&gt;/<br/>logiks.json · api.js · routes.json<br/>dbschema/ · forms/ · reports/ · www/")]

    subgraph WK["Worker process"]
        direction TB
        P1("1. loadPlugins<br/>read logiks.json, catalog files,<br/>collect policies")
        P2("2. checkDependencies<br/>merge deps, npm install<br/>(if ENABLE_PLUGINS_INSTALL_DEPS)")
        P3("3. activatePlugins<br/>require api.js to APPINDEX.CONTROLLERS<br/>build service from routes.json")
        P4("4. connect<br/>join transporter")
        Mig("DBMIGRATOR.pluginMigration<br/>(if ENABLE_DBMIGRATION)")
        P1 --> P2 --> P3 --> P4
        P3 -. "boot option" .-> Mig
    end

    Folder --> P1
    Mig --> DB[("appdb / logdb<br/>plugin tables")]
    Folder -- "dbschema/schema_*.json" --> Mig

    Sys("AppServer system.service<br/>registerWorker · workerHeartbeat · drainWorker")
    Reg[("Worker registry<br/>nodes, services, plugins,<br/>menus, policies")]

    P4 -- "system.registerWorker<br/>(CLUSTER_TOKEN, services, menus,<br/>plugins, policies)" --> Sys
    Sys -- "token check, store" --> Reg
    Sys -- "worker proxies for helpers<br/>and controllers" --> P4
    P4 -- "heartbeat every 10s" --> Sys
    Reg --> Nav("navigator / menus / system.plugins<br/>consumed by UI and admin.plugins")
```

### Runtime: a request to a plugin

```mermaid
flowchart TB
    Client["Client"] -- "GET/POST /api/services/&lt;plugin&gt;/..." --> GW("Gateway<br/>domain resolve, rate limit,<br/>authenticate, authorize")
    GW --> Broker("Broker<br/>finds a node hosting service &lt;plugin&gt;<br/>load balanced, circuit breaker")
    Broker -- "action call over transporter" --> Svc

    subgraph WK["Worker: plugin service"]
        direction TB
        Svc("Generated action<br/>route · api.js fn · source · www · event")
        Run("runAction<br/>conf.data is a controller string<br/>or static data")
        Ctl("api.js controller<br/>PLUGIN.method(params, ctx)")
        Src("source / www<br/>JIT-compile .jsx, serve JSON defs and assets")
        Svc --> Run
        Svc --> Src
        Run -- "'DEMO.test1'" --> Ctl
        Run -- "static data" --> Out("Result")
        Ctl --> Out
    end

    Ctl -- "_DB / RBAC / MESSAGING / AICORE<br/>proxied via system.helpers<br/>and system.controllers" --> App("AppServer globals")
    App <--> Stores[("appdb · logdb · Redis · Queue · Files")]
    Ctl -- "_call('other.action')" --> Other("Other plugin service<br/>anywhere in the cluster")
    Other --> Ctl
    Src --> Disk[("plugin folder on Worker<br/>forms/ reports/ component/ www/")]

    Out --> Broker
    Broker --> GW
    GW -- "{status:'okay', results}" --> Client

    Ev(("Cluster event topic<br/>or AUTOJOBS cron")) -- "routes.json events" --> Svc
```

## Notes

- Services and controllers read and write both databases only through the `_DB` helper family, which picks a driver (MySQL, PgSQL, MSSQL, MongoDB, DynamoDB, DuckDB) from config.
- Workers do not get a separate data path to clients. All client traffic goes through the gateway, which forwards the action call over the transporter and returns the result.
- The `local_worker` AI lane ([api/workers/aiagent.worker.js](../api/workers/aiagent.worker.js)) isn't shown because nothing dispatches to it yet.
