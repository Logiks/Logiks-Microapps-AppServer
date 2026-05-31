# 5. Workers

> Audience: **platform engineers** and **architects** primarily; **app developers** should still read §5.1 to understand where their code runs.

A Worker is a long-lived Node.js process that hosts microapps. Workers join a Logiks cluster over the shared transporter and become callable from any other node automatically. The AppServer in this repo is itself a Worker (Gateway-flavoured). The general-purpose Worker template lives in [Logiks-Microapps-Worker-NodeJS](https://github.com/Logiks/Logiks-Microapps-Worker-NodeJS).

---

## 5.1 Worker Architecture

### Worker Types

Logiks recognises four Worker flavours, distinguished by *what they expose* and *what they host*, not by class hierarchy. Each flavour is a regular Worker process configured differently.

| Flavour | HTTP? | Hosts microapps? | Runs jobs? | Used for |
|---|---|---|---|---|
| **Gateway** | Yes (terminates HTTP) | No | No (unless leader) | The public entry point; in this repo |
| **Runtime** | No | Yes | No | Hosting microapp services on dedicated nodes |
| **Cluster** | No | No (usually) | Yes | Singleton-bound work — cron, migrations, coordination |
| **Specialized** | No | Optional | Optional | Purpose-built — search index builder, AI inference, heavy compute |

The flavour is a *configuration profile*, not a code variant. The Worker boilerplate runs as any flavour depending on its `.env` and the services it loads. The `nodeID` prefix (`gateway-`, `runtime-`, `cluster-`, …) is a convention that aids observability.

### Runtime Workers

A Runtime Worker exists to host microapp logic without a public HTTP surface. It connects to the cluster, loads services from `services/` and from each `plugins/<appid>/services/`, and waits for action calls.

Typical configuration:
- `RUN_MODE=worker` (reserved env var; today no-op but documents intent)
- `TRANSPORTER` matches the Gateway
- Does *not* set `PORT` (no HTTP listener)
- Services declare `rest:` aliases — they will be picked up by the Gateway's `autoAliases: true` and exposed under `/api`

### Cluster Workers

A Cluster Worker is one that participates in singleton-bound tasks via the `SINGLETONMANAGER` global. Examples:

- The leader runs `AUTOJOBS.startJobs()` (cron scheduling).
- The leader runs DB migrations when `MIGRATION_MODE=IMPORT`.
- The leader could run coordination tasks like cluster-wide cache warmup or schema reconciliation.

Any Worker can win the leader election (Redis lock). Designating "Cluster Workers" is a deployment convention: you assign a couple of Workers exclusively to coordination duties to keep them isolated from request traffic.

### Specialized Workers

A Specialized Worker is a Worker dedicated to a single, often resource-intensive responsibility. Examples:

- **Search indexer** — consumes `*.created`/`*.updated` events and writes to an external index.
- **AI inference Worker** — loads a model into memory; exposes a service like `ai.complete`.
- **Report generator** — runs CPU-bound report jobs on dedicated hardware.

Specialized Workers are how Logiks accommodates heterogeneous compute without compromising the Gateway's footprint.

### The Gateway Server (this repo)

In this repo, the Gateway Server is built in [api/server.js](../api/server.js). Its responsibilities:

1. Terminate HTTP on `process.env.PORT` (default 3000).
2. Apply CORS, Helmet, cookie parsing, session middleware.
3. Resolve the requesting domain to a microapp via `BASEAPP.getAppForDomain`.
4. Authenticate (JWT / API key / S2S / TL token / federated).
5. Authorize (RBAC scopes, tenant matching).
6. Rate-limit (distributed Redis counter).
7. Dispatch to the appropriate action through the broker — local or remote.

The Gateway also hosts the platform services in [api/services/](../api/services/): `auth`, `webhooks`, `pages`, `admin.*`, `developers.*`, `tenant`, etc.

---

## 5.2 Worker Management

### Registering Workers

A Worker joins the cluster simply by starting with matching `TRANSPORTER` and `NAMESPACE`. There is no central registry to update — the MicroApp Runtime's gossip protocol propagates the new node's services to every existing node within one `heartbeatInterval` (default 10 seconds, see [api/server.js:124](../api/server.js#L124)).

Things to set per Worker:

| Setting | Purpose |
|---|---|
| `SERVER_ID` | Must be unique across the cluster — used in `nodeID` |
| `TRANSPORTER` | Same URL on every Worker |
| `NAMESPACE` | Same name on every Worker (default `default`) |
| `CLUSTER_TOKEN` | Shared secret, exchanged in broker metadata |
| Service files | Drive what the Worker advertises to the cluster |

### Scaling Workers

Horizontal scaling = "run more processes." Logiks does not autoscale on its own — wire scaling to your orchestrator (PM2 cluster mode, systemd templated units, or Kubernetes ReplicaSets later in the roadmap).

When you scale:

- **Stateless services** scale linearly. The broker round-robins between instances of the same service automatically.
- **Stateful services** (those holding in-process state — e.g., a cache, a background loop) need leader election via `SINGLETONMANAGER` to keep state in one place.
- **Sessions** live in Redis, so any Gateway instance can serve any user.

### Worker Discovery

Discovery is implicit. Main Broker maintains a `$node.list` action exposing the current cluster view. The `developers.swagger` service further derives an OpenAPI document from the union of all action metadata across all nodes — useful for AI agents and clients alike.

### Worker Health

Worker health surfaces through:

1. **Heartbeats** — `heartbeatInterval: 10s`, `heartbeatTimeout: 30s`. A node that misses three heartbeats is removed from the registry.
2. **Periodic broker ping** — every 5 minutes, the broker pings every other node and logs RTT ([api/server.js:1285-1288](../api/server.js#L1285-L1288)).
3. **Circuit breaker** — per-action; if more than 50% of calls fail within a 60s window (with at least 10 calls), the breaker opens and subsequent calls fail fast ([api/server.js:110-115](../api/server.js#L110-L115)).
4. **Per-Worker `health` action** — implement it on each Worker to expose detailed state.

### Worker Monitoring

The broker is configured with `metrics: true` ([api/server.js:122](../api/server.js#L122)). Metrics include per-action call count, latency histograms, error rates, and circuit-breaker state.

To export metrics:

- Add a metrics reporter (Prometheus, Datadog, StatsD) via the broker `metrics` config.
- Or expose `$node.metrics` through an admin action and scrape it.

Application logs land in `logs/` (daily rotated Winston files). Audit logs land in `logdb.log_audit`. Request logs (if enabled via `config.json.log_requests`) land in `logdb.log_activities`.

---

## 5.3 Distributed Runtime

### Node Coordination

Coordination uses **Redis** for primitives that must be cluster-coherent:

| Concern | Redis structure |
|---|---|
| Distributed cache | `CACHESTORE:<key>` |
| Sessions | `sess:<sid>` (managed by connect-redis) |
| Rate-limit counters | `ratelimit:<identifier>` (TTL = window) |
| Singleton locks | `singleton:<activityName>` (TTL renewed on heartbeat) |
| Token blacklist | `blacklist:<jti>` |
| Shared transporter (if Redis) | `MOL-*` |

A single Redis instance is sufficient for clusters up to roughly tens of nodes; beyond that, Redis Cluster or sharding becomes appropriate. Redis is a single point of failure today — production deployments should run Redis with replication and Sentinel/Cluster failover.

### State Synchronization

There are three kinds of state in a Logiks cluster:

1. **Per-node ephemeral state** — in-process caches, in-flight requests, open file handles. Not synchronized.
2. **Cluster-shared transient state** — sessions, cached query results, rate-limit counters, locks. Lives in Redis; visible to every node.
3. **Durable state** — `appdb`, `logdb`, files in `uploads/`. Lives in MySQL and the filesystem (or S3); the source of truth.

Microapps should never assume node-local memory survives a request. If you need a value across requests, write to Redis or DB.

### Failover

The Shared Transporter is the failure-detection vehicle:

- If a Worker dies, heartbeats stop; after `heartbeatTimeout` (30s) it is removed from the registry.
- In-flight requests to that Worker fail. The broker's retry policy (`enabled: true, retries: 3` in [api/server.js:103-108](../api/server.js#L103-L108)) re-dispatches them to a surviving Worker if one exists.
- If no other Worker exposes the action, the call fails with `SERVICE_NOT_AVAILABLE`.

For the Gateway itself, a load balancer in front (HAProxy, NGINX, ALB) handles failover at the HTTP layer. Sessions are in Redis, so a request can land on any Gateway replica without re-authentication.

### Replication

There is no application-level replication. Replication is delegated to infrastructure:

- **MySQL** — primary/replica via your DB topology of choice.
- **Redis** — Sentinel or Cluster.
- **Files** — `uploads/` should be on shared storage (NFS / EFS / S3 via the `storage.driver` config) so any Gateway can serve any file.

The roadmap mentions multi-region; the current implementation assumes a single region.

### Load Balancing

Two layers:

1. **HTTP** — an external L4/L7 load balancer in front of the Gateway replicas. The Gateway is stateless beyond session-in-Redis, so any balancer suffices.
2. **Action dispatch** — `RoundRobin` strategy distributes calls across nodes that expose the same action. Alternative strategies — `Random`, `CpuUsage`, `Latency` — are configurable on the broker (not currently set in this repo; defaults to `RoundRobin`).

The bulkhead pattern is enabled ([api/server.js:116-120](../api/server.js#L116-L120)) — at most 10 concurrent calls per action per node, with a queue of up to 100. This protects individual Workers from being overwhelmed.

---

> **Next:** [§6 Services & APIs](06-core-services-and-apis.md) — the action surface, REST mapping, and the API gateway.