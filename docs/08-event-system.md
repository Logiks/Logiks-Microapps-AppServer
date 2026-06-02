# 8. Event System

> Audience: **app developers** primarily; **platform engineers** for §8.3.

Events are how microapps loosely couple themselves. Action calls handle synchronous request/response between exactly two parties; events handle fan-out — one emitter, many subscribers — across the whole cluster.

---

## 8.1 Event Architecture

### Event-Driven Design

Logiks events are *typed topics* with *structured payloads*. A microapp emits a topic name and a payload object; any subscriber on any node can receive it. Subscriptions are declared statically inside a service definition, so the broker can register them at startup.

Event delivery is **fire-and-forget** by default — the emitter does not learn whether subscribers handled the event successfully. Use action calls when you need a return value or a delivery guarantee.

### Event Bus

The "event bus" in Logiks is the MicroApp broker itself, plus the configured transporter. Events emitted on one node are propagated to peer nodes through the transporter and dispatched to subscribers there.

The broker provides three emission primitives:

| Method | Scope |
|---|---|
| `ctx.emit("topic", payload)` | Balanced — one instance per service group receives the event (load-balanced like an action call) |
| `ctx.broadcast("topic", payload)` | Broadcast — every subscribing service instance on every node receives it |
| `ctx.broadcastLocal("topic", payload)` | Local — only services on the current node receive it |

Choose deliberately. For "invoice created → send email" semantics, `emit` is right (one email per invoice, even if you scaled the notifier). For "config reloaded → drop caches everywhere" semantics, `broadcast` is right.

### Message Brokers

Logiks does not introduce its own message broker — it uses whatever MicroApp transporter you configure. Supported transporters (via `process.env.TRANSPORTER`):

| Transporter | URL scheme | Persistence | Use case |
|---|---|---|---|
| **Redis** | `redis://host:port` | None (PubSub) | Default; integrated with Redis you already need for cache |
| **NATS** | `nats://host:port` | None unless JetStream | High-throughput, low-latency clusters |
| **MQTT** | `mqtt://host:port` | Broker-dependent | IoT-style fan-out |
| **TCP** | `tcp://` | None | Direct node-to-node, no broker |
| **AMQP / Kafka / others** | Per MicroApp adapter | Varies | Heavier infra; commit log semantics |

The shipped sample uses Redis (`TRANSPORTER=redis://127.0.0.1:6379` in `env_sample`). Production deployments can switch to NATS or AMQP without code changes — only the env var changes.

> **Note on durability.** None of the default transporters persist events. If an event is emitted while a subscriber is down, that subscriber misses it. For durable event handling, use a transporter with persistence (NATS JetStream, AMQP with durable queues, Kafka) or pair emission with a DB write that subscribers can replay.

---

## 8.2 Working with Events

### Publishing Events

From any service action or controller, emit through the broker:

```javascript
// inside an action handler
ctx.emit("billing.invoice.created", {
    invoiceId: result.guid,
    customerId: ctx.params.customerId,
    amount: ctx.params.amount,
    tenantId: ctx.meta.user.tenantId,
    timestamp: Date.now()
});
```

From a global controller (no `ctx` in scope), use the broker reference from `SERVER`:

```javascript
SERVER.getBroker().emit("billing.invoice.created", payload);
```

**Naming convention:** `<microapp>.<entity>.<action>`. Use past-tense verbs for "something happened" events (`created`, `updated`, `deleted`, `paid`, `expired`). Use imperative for commands (`billing.invoice.send`) but prefer action calls for those.

### Subscribing to Events

Declare an `events` block inside a service definition:

```javascript
module.exports = {
    name: "notifier",
    events: {
        "billing.invoice.created"(payload, sender, eventName) {
            this.logger.info("New invoice", payload.invoiceId);
            return this.actions.notifyCustomer(payload);
        },

        "billing.invoice.paid": {
            group: "ledger",
            async handler(payload) {
                await this.actions.recordPayment(payload);
            }
        }
    }
};
```

Two forms:

- **Shorthand** — `topic: handler(payload, sender, eventName)`. Subscribes with the service name as its group.
- **Object form** — `topic: { group, handler }`. Lets you set the group explicitly. Subscribers in the same group share events round-robin; subscribers in different groups each get a copy.

Wildcards are supported: `"billing.invoice.*"` matches `created`, `updated`, `deleted`, etc. Use `"**"` to subscribe to all events (typically only for audit/observability services).

### Event Pipelines

For multi-step processing, chain events with intermediate emit/subscribe pairs:

```
billing.invoice.created
    → notifier emits  notifications.email.queued
        → email-worker emits  notifications.email.sent
            → logs.audit (terminal)
```

This pattern lets you insert new steps without touching upstream code. Each step is observable independently (each has its own topic).

### Event Replay

Logiks does not provide built-in event replay (the default transporters are non-persistent). To replay:

1. Persist event payloads to DB at emit time (a "transactional outbox" pattern).
2. Provide an admin action that re-emits historical events from the DB, scoped by topic or time window.

The `logs` services partially fulfill this for audit-class events — they store payloads in `logdb` and can be queried directly.

### Dead Letter Queues

There is no DLQ infrastructure in this release. A subscriber that throws inside an event handler logs the error and continues; the event is lost. For at-least-once semantics, use a durable transporter (NATS JetStream, Kafka, AMQP) and wire your subscriber's failure path to a poison queue.

### Well-Known Platform Events

The platform emits these topics; subscribe to them in your microapps:

| Topic | When | Payload |
|---|---|---|
| `system.request_completed` | After every HTTP route call | `{ method, path, status, duration }` |
| `logs.audit` | Caller-driven (any service) | Audit row data → written to `logdb.log_audit` |
| `logs.activity` | Caller-driven | Activity row data → `logdb.log_activities` |
| `logs.security` | Caller-driven | Security row data → security log tables |
| `system.error` | When critical errors occur (convention) | Error context |

The `logs.*` topics are consumed by [api/services/logs.service.js](../api/services/logs.service.js#L23). Microapps should emit them rather than writing to `logdb` directly so that future routing changes (e.g., dual-writing to an external SIEM) are transparent.

### Audit and Activity Pattern

Recommended emission inside any state-changing action:

```javascript
async handler(ctx) {
    const result = await /* … do the work … */;

    ctx.emit("logs.audit", {
        appid: ctx.meta.appInfo.appid,
        userid: ctx.meta.user.userId,
        category: "billing",
        subcategory: "invoice.created",
        ref_id: result.guid,
        ip: ctx.meta.remoteIP,
        metadata: { amount: ctx.params.amount }
    });

    return result;
}
```

The logs service handles the DB write idempotently and adds timestamps via `MISC.generateDefaultDBRecord`.

---

## 8.3 Distributed Messaging

### Queue Systems

Logiks does not bundle a job queue. The `config_sample.json` includes a stubbed `queue: { enable: false, host: "amqp://…" }` block; the framework does not wire it. To run background jobs:

1. **Scheduled jobs** — use `AUTOJOBS` (cron-style, leader-elected via Redis lock).
2. **Async work from requests** — emit an event and subscribe asynchronously, or persist a "todo" row and have a worker poll it.
3. **External queue integration** — install BullMQ / RabbitMQ client in your microapp's Worker; subscribe to events that enqueue work.

### Streaming

Two unrelated meanings:

1. **HTTP response streaming** — see [§6.2 Streaming APIs](06-core-services-and-apis.md#streaming-apis). Not specifically tooled in this release.
2. **Event streaming** — relevant when using a streaming transporter (Kafka, NATS JetStream). Logiks events become commit-log records; subscribers can replay from any offset. Not enabled by default; switch the transporter to opt in.

### Pub/Sub

Pub/sub is the default mode of Logiks events. `broker.emit` is balanced pub/sub (one instance per group); `broker.broadcast` is full fan-out pub/sub.

Topic patterns:

- **Notification fan-out** — `<microapp>.notify.<channel>` (email, sms, in-app) → subscribers per channel.
- **Domain events** — `<microapp>.<entity>.<verb>` → multiple subscribers (audit, search index, analytics) each react independently.
- **System events** — `system.*` reserved for the platform.

### Priority Queues

Not natively supported. MicroApp events do not carry priority. If you need priority semantics:

1. Use multiple topics (`billing.invoice.created.high`, `billing.invoice.created.low`) and let subscribers process them in priority order.
2. Or write events to a DB queue with a priority column and have a worker poll by priority.

### Delivery Guarantees Reference

| Guarantee | How to achieve in Logiks |
|---|---|
| At-most-once | Default — `broker.emit` over Redis transporter |
| At-least-once | Durable transporter (NATS JetStream, Kafka, AMQP) + idempotent subscribers |
| Exactly-once | Idempotent subscribers + dedup key + transactional outbox; not provided as a primitive |
| Ordered | Use a single subscriber per topic per partition; rely on transporter's ordering (Kafka, NATS streams) |

### Observability of Events

Built-in observability for events:

- MicroApp logs each event emission and delivery at `debug` level (visible if `SERVER_CONSOLE_LOG_LEVEL=debug`).
- The broker's `metrics: true` setting exports event throughput and error rates per topic.
- Subscribing a wildcard handler in a dev/staging microapp gives you a live tap on every event.

For production observability, ship MicroApp metrics to Prometheus / Datadog and add a `**` subscriber that writes a sampled stream of events to your APM.

---

> **Next:** [§9 AI Layer](09-ai-layer.md) — the agentic tier microapps build on. The full chapter list is in the [Documentation Index](00-index.md).