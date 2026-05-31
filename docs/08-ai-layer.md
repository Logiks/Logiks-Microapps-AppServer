# 8. AI Layer

> Audience: **app developers** building AI-powered microapps, **platform engineers** configuring AI engines, **architects** evaluating Logiks' AI posture.

The AI Layer is named **AICore** — the 4th tier of Logiks' T4 architecture, implemented in this repo at [api/controllers/aicore.js](../api/controllers/aicore.js). AICore is *the* agentic platform of Logiks: it owns the skill registry, context engine, memory, vector DB connections, agent loops, and tools integration. Microapps consume those capabilities through AICore's interfaces and can extend the registry with their own skills, tools, and domain-specific components — they do not reinvent the agentic stack.

Beneath AICore sits a pluggable **engine layer** ([AIEngine](../api/controllers/aicore/aiengine.js)) that adapts to LLM providers (LogiksAI today; Ollama, Claude, OpenAI by extension). Engines do the LLM I/O; AICore does the agentic work.

---

## 8.1 AI Architecture

### Where AICore Fits

```
┌──────────────────────────────────────────────────────────────────┐
│  Microapps (use-case-specific solutions: support, sales, …)     │
│   · register skills with AICore                                 │
│   · contribute tools                                            │
│   · consume AICore interfaces for skills/context/memory/agents  │
└────────────────────────────┬─────────────────────────────────────┘
                             │  AICORE.sendMessage / interfaces
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  AICore  (api/controllers/aicore.js)  — Tier 4: agentic layer    │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │  Skill registry      ·  Context engine                   │   │
│   │  Memory (semantic + episodic)  ·  Vector DB connections  │   │
│   │  Agent loops         ·  Tools integration                │   │
│   │  Policy controls     ·  Session ids                      │   │
│   └──────────────────────────────────────────────────────────┘   │
└────────────────────────────┬─────────────────────────────────────┘
                             │  engine.sendMessage
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  Engine layer  (api/controllers/aicore/<engine>.js)              │
│   AIEngine (abstract)                                            │
│       │                                                          │
│       ├── LogiksAI       ──►  LogiksAI hosted LLM platform       │
│       ├── Ollama         ──►  local Ollama models  (roadmap)     │
│       ├── Claude         ──►  Anthropic Claude     (roadmap)     │
│       └── OpenAI         ──►  OpenAI models        (roadmap)     │
└──────────────────────────────────────────────────────────────────┘
                             │  HTTP / SDK
                             ▼
                       Hosted or local LLM
```

The architecture cleanly separates three concerns:

1. **LLM I/O** — engines adapt to specific providers; pure protocol translation.
2. **Agentics** — AICore owns the orchestration, memory, retrieval, skills, tools.
3. **Domain** — microapps own their business logic and extend AICore with use-case-specific skills/tools.

### AI Runtime Layer

AICore runs *inline* with the AppServer process. The controller is loaded as a global (`AICORE`) at boot by [api/baseapp.js:28-47](../api/baseapp.js#L28-L47); engines are instantiated during `AICore.initialize()` based on `CONFIG.aicore`.

For lightweight workloads (HTTP-based LLM calls, broker tool invocations), inline operation is sufficient — the LLM is I/O-bound and doesn't block the event loop meaningfully. For workloads that need heavy local computation (embedding generation, in-process retrieval, vector indexing), the recommended pattern is to deploy a Python Worker via [Microapps-Worker-Python](https://github.com/Logiks/Microapps-Worker-Python) that participates in the cluster and exposes specialized actions — AICore can be configured to call those Worker actions as part of its agent loops.

### AI Contracts

The contracts AICore exposes have two sides:

**For microapps consuming AICore** (the interface surface — intended):

| Capability | AICore interface |
|---|---|
| LLM round-trip | `AICORE.sendMessage(message, sessId, moduleId, params, ctx)` |
| One-shot LLM call | `AICORE.oneShot(message, moduleId, params, ctx)` |
| Skill execution | `AICORE.runSkill(skillId, params, ctx)` |
| Skill registration | `AICORE.registerSkill(skillDef)` |
| Tool registration | `AICORE.registerTool(toolDef)` |
| Memory access | `AICORE.memory.get/put/search(...)` |
| Context assembly | `AICORE.context.assemble(ctx, requirements)` |

**For engines plugging into AICore** (the engine plugin contract — present in code):

```javascript
// api/controllers/aicore/myengine.js
const AIEngine = require("./aiengine");

module.exports = class MyEngine extends AIEngine {
    constructor(params = {}) { super(params); /* … */ }
    __name() { return "myengine"; }
    async sendMessage(sessId, message, userInfo, params = {}) {
        // call the LLM; return the response
    }
};
```

Then in [api/controllers/aicore.js](../api/controllers/aicore.js) `initialize()`:

```javascript
case "myengine":
    aiEngine = new MyEngine(CONFIG.aicore.config);
    break;
```

### AI Context Engine

The **Context Engine** is the AICore module that assembles per-request context before the LLM call. Once built, it will pull:

| Source | Use |
|---|---|
| `ctx.meta.user` | Identity, role, scopes |
| `ctx.meta.tenantInfo` | Tenant defaults, feature flags |
| Episodic memory (KV) | Recent agent–user exchanges in session |
| Semantic memory (vector DB) | Relevant past knowledge by similarity |
| Platform events (subscribed) | Activity since last turn |
| Skill metadata | Prompt template, tool list, memory scope of the dispatched skill |
| Environment | Time, locale, current page/route |

Microapps don't assemble context themselves — they pass `ctx` to AICore and the Context Engine handles assembly. This avoids each microapp re-implementing context logic; corrections and improvements live in one place.

> **Status:** Roadmap. Not yet in code.

---

## 8.2 LLM Integration

AICore is LLM-agnostic. The LLM is whatever the configured engine talks to. Switching providers is a configuration change.

Though LogiksAI provides additional layer of intelligence and cross platform Personas which expdediates the delivery of AI based objectives.

### Engine Plugin Pattern

To add a new LLM provider:

1. Create `api/controllers/aicore/<provider>.js` extending `AIEngine`.
2. Implement `__name()` and `async sendMessage(sessId, message, userInfo, params)`.
3. Add a `case "<provider>"` branch in [api/controllers/aicore.js:15-21](../api/controllers/aicore.js#L15-L21).

The `params` object is engine-specific — model name, temperature, system prompt, tool schemas if AICore is doing tool calling, retrieval hits if pre-computed, etc. Engines pass-through unrecognised fields.

### LogiksAI (default)

**LogiksAI** is Logiks' own hosted LLM platform — the default engine and the only one wired in the switch today. The integration class [api/controllers/aicore/logiksai.js](../api/controllers/aicore/logiksai.js) extends `AIEngine`; `sendMessage` is currently a stub. When complete, it will issue requests against the LogiksAI service.

### Ollama, Claude, OpenAI

> **Roadmap.** None are wired yet. The expected shape:
>
> - **Ollama** — POST to a local Ollama URL (`/api/chat`); translate the response.
> - **Claude** — use `@anthropic-ai/sdk`; call `messages.create` with system + user messages + tool definitions.
> - **OpenAI** — use `openai`; call `chat.completions.create` or `responses.create`.
>
> Each is one file under `api/controllers/aicore/` plus one `case` in the initialize switch.

### Multi-Model Routing

> **Roadmap.** AICore today selects one engine per process via `CONFIG.aicore.engine`. The intended evolution: a skill can declare its preferred engine (`skillDef.engine = "claude"`), and the dispatcher picks the right one at runtime. Automatic routing (latency / cost / quality) is further out.

### Embedding Models

Embeddings power semantic memory and RAG retrieval inside AICore (intended). The plan: AICore manages an embedding provider (configured separately from the chat engine) and exposes embedding-aware memory APIs. Microapps don't choose embedding models per call — they trust AICore's configured embedder.

> **Status:** Roadmap. The embedding interface is not yet present.

---

## 8.3 AI Agents

### Agent Framework

AICore *is* the agent framework for Logiks. Custom, proprietary — not built on LangChain, LlamaIndex, or the Anthropic Agent SDK — because the agentic primitives need to be first-class consumers of Logiks' tenancy, RBAC, audit, and event surfaces.

The central abstractions are **Skills**, **Tools**, **Memory**, **Context Engine**, and **Agent Loops** — described below.

### Skills — The Unit of Agentic Capability

A **Skill** is a registered behavioural unit in AICore's skill registry. A skill bundles:

- A **prompt template** — typically with placeholders for context the engine fills in.
- A **tool list** — which tools the LLM may use during the skill's execution.
- A **memory scope** — `tenant` | `user` | `session` | `none`.
- An **input schema** — what callers must supply to invoke the skill.
- A **provider hint** *(roadmap)* — which engine to prefer.
- **Context requirements** — which slices of context the Context Engine should pre-fill.

Skill records live in `appdb` (intended schema below) and are loaded by AICore at dispatch.

```javascript
// Intended shape — not yet enforced by code
{
    skillId: "billing.refund",
    appid: "billing",
    version: 1,
    promptTemplate: "Refund {{params.amount}} for invoice {{params.invoiceId}}. Reason: {{params.reason}}. Customer history: {{context.recentActivity}}.",
    tools: ["billing.lookupInvoice", "billing.processRefund", "notifications.notifyCustomer"],
    memoryScope: "tenant",
    inputSchema: {
        invoiceId: { type: "string" },
        amount: { type: "number" },
        reason: { type: "string" }
    },
    engine: "logiksai",
    contextRequirements: ["user", "tenant", "recentActivity"]
}
```

**Microapps register skills** through `AICORE.registerSkill(skillDef)` (planned API). Registration happens at microapp install or first run; the skill is then available to dispatch from any code path.

**Microapps extend the skill set** — they don't ship parallel skill registries. The billing microapp owns `billing.*` skills; the support microapp owns `support.*` skills; AICore is the central registry.

> **Status:** Skill registry is roadmap. Microapps wanting LLM access today call `AICORE.sendMessage` directly.

### Tool Calling

AICore will integrate tools from two sources:

1. **AppServer broker actions** — auto-discovered via `developers.swagger`. Any action with `params` + `meta.scopes` is a candidate. AICore presents them to the LLM in the provider's tool-use format, executes the LLM's tool calls via `ctx.call(...)`, and feeds results back into the loop. RBAC and audit apply uniformly.
2. **AICore-native tools** — helpers AICore provides directly (e.g., memory search, vector retrieval, web fetch, internal book-keeping). These don't go through the broker.

**Microapps contribute tools** by exposing actions on their services. Any well-scoped, well-described action becomes available to skill dispatchers cluster-wide.

> **Status:** Tools integration is roadmap. The infrastructure (action catalog via `developers.swagger`, `ctx.call(...)`, RBAC, audit) exists; the AICore-side dispatcher and tool registry do not yet.

### Memory

AICore will manage memory in two tiers:

| Tier | Backed by | Lifetime | Used for |
|---|---|---|---|
| **Semantic memory** | Vector DB (Qdrant or alternative) | Long-lived; aged out by policy | "What does the agent know about this tenant / user / topic?" |
| **Episodic memory** | Key-value store (Redis short-term, MySQL durable) | Per session or per agent run | Recent turns, intermediate tool results, working memory |

Memory is **scoped per skill** via `memoryScope`. The Context Engine respects the scope when retrieving for a given dispatch — so a `user`-scoped skill never sees another user's memory.

Microapps access memory through AICore's interfaces (`AICORE.memory.*`); they don't write directly to the vector DB or the KV store. This keeps multi-tenant isolation, retention, and embedding strategy centralised.

> **Status:** Roadmap. Memory interfaces and the vector DB integration are planned.

### Context Windows

AICore's Context Engine (when built) will manage prompt budgets per-engine — Claude's 200K window vs OpenAI's 128K vs LogiksAI's specifics. Strategy:

1. Rank context sources by priority (skill metadata first, then identity, then episodic, then RAG, then events).
2. Re-rank semantic memory hits and include top-K within budget.
3. Summarise older episodic turns when raw transcript would overflow.

Microapps don't worry about context budgets — AICore does.

### Multi-Agent Systems

Multi-agent topology in AICore emerges from **skill composition**: a skill can invoke other skills via the LLM's tool-use mechanism (because skills are also tool definitions). Cross-skill orchestration is implicit — the LLM chooses what to call next.

Concrete topologies microapps will be able to build:

- **Supervisor + sub-skills** — one orchestrator skill delegates to specialist skills.
- **Skill-based dispatch** — a router matches user intent to one of many skills.
- **Event-driven agents** — microapps subscribe to events and trigger skill runs autonomously.

All of these use the AppServer's existing primitives (events, action calls, audit) plus AICore's skill registry.

> **Status:** Multi-agent composition emerges naturally once skill registry + tool calling are built. Today, none of it.

---

## 8.4 AI Pipelines

### RAG Pipelines

RAG flows through AICore's memory + retrieval interfaces. The full pipeline (intended):

1. **Ingest** — microapps push documents (or AICore subscribes to events that announce new content); AICore chunks, embeds, and writes to the vector DB.
2. **Query** — at skill dispatch, the Context Engine embeds the user query and searches the vector DB under the skill's memory scope.
3. **Compose** — top-K hits are re-ranked, deduplicated, and injected into the prompt's RAG section.
4. **Generate** — the engine (LLM) produces an answer grounded in the retrieved context.

Microapps trigger ingest through `AICORE.memory.ingest(payload, scope)` (planned); retrieval is automatic during skill dispatch.

> **Status:** Roadmap. Vector DB integration not yet present.

### Embedding Pipelines

AICore will manage one embedding model per deployment (configured via `CONFIG.aicore.embeddings`). Embeddings + metadata (tenant, scope, source pointer, timestamp) land in the vector DB through AICore's interfaces. Microapps don't run embeddings themselves.

> **Status:** Roadmap.

### Semantic Search

Semantic search is exposed to microapps as `AICORE.memory.search(query, scope, options)`. Microapps that want search-as-a-feature in their UI call this and either return raw hits or compose with an LLM step.

> **Status:** Roadmap.

### Vector Storage

**Qdrant** is the intended default vector store. Architecture:

- Self-hosted or cloud Qdrant — connection configured in `CONFIG.aicore.vectorDB`.
- AICore manages collections; microapps don't address Qdrant directly.
- Multi-tenant isolation enforced by AICore via metadata filters (`tenant_id`, `scope_id`) on every query.
- HNSW indexes for fast approximate nearest-neighbour search.

Alternative vector backends (pgvector, Pinecone, Weaviate, Milvus) can be supported through pluggable vector-store adapters, similar to the engine plugin pattern.

> **Status:** Vector DB connection layer is roadmap. The choice of Qdrant is the intended default; the abstraction will allow alternatives.

### AI Orchestration

End-to-end orchestration inside AICore (intended):

```
Microapp action calls AICORE.runSkill(skillId, params, ctx)
        │
        ▼
AICore: load skill from registry
        │
        ▼
Context Engine: assemble per-request context
   · user/tenant from ctx.meta
   · episodic memory in scope
   · semantic memory hits from vector DB
   · subscribed events since last turn
        │
        ▼
Render prompt: skill template + context + params
        │
        ▼
Engine.sendMessage(prompt, tool schemas)
        │
        ▼  (LLM may emit tool calls)
Tool dispatcher:
   · broker action → ctx.call(...) with audit
   · AICore-native tool → execute directly
        │
        ▼
Loop until terminal or step limit
        │
        ▼
Memory writes (episodic + semantic) per skill scope
        │
        ▼
Audit emit (logs.audit event on broker)
        │
        ▼
Return response to microapp
```

Microapps invoke the loop with one call; AICore runs the rest. The microapp's job is to define skills, contribute tools (its actions), and consume the response.

> **Status:** This loop is the design; today AICore performs only the engine dispatch step.

---

## What Microapps Do, What AICore Does

The division of labour, stated explicitly:

| Concern | Owner |
|---|---|
| LLM model selection | AICore (via engine config) |
| LLM I/O protocol | Engine (adapter) |
| Prompt template authoring | Microapp (in skill definitions) |
| Skill registry | AICore |
| Skill dispatch logic | AICore |
| Tool registry | AICore (sourced from broker + native) |
| Tool execution | AICore (via `ctx.call` for broker actions) |
| Context assembly | AICore (Context Engine) |
| Memory storage | AICore (semantic + episodic) |
| Vector DB connection | AICore |
| Agent loop control | AICore |
| Multi-tenant isolation in AI | AICore (using AppServer's tenant context) |
| Domain logic | Microapp |
| Use-case-specific prompts and skills | Microapp (extending AICore's registry) |
| Domain-specific data ingestion | Microapp (calling AICore's memory interfaces) |
| Use-case UI | Microapp |

The headline: **microapps extend AICore; microapps do not duplicate AICore.**

## What This Chapter Documents vs Current Code

| Capability | Documented as | Code state |
|---|---|---|
| `AICORE.sendMessage` | Present | ✅ Implemented (delegates to engine) |
| `AICORE.oneShot` | Present | 🚧 Empty stub |
| Engine plugin (`AIEngine`) | Present | ✅ Implemented (abstract base) |
| LogiksAI engine | Present | 🚧 Wired, but `sendMessage` returns false |
| Ollama / Claude / OpenAI engines | Present | 🚧 Not wired yet |
| Skill registry | Intended | ❌ Not in code |
| Context Engine | Intended | ❌ Not in code |
| Memory (semantic + episodic) | Intended | ❌ Not in code |
| Vector DB integration | Intended (Qdrant default) | ❌ Not in code |
| Agent loops | Intended | ❌ Not in code |
| Tools integration | Intended | ❌ Not in code |

Treat this chapter as the architectural contract microapps will build against. Today, the only end-to-end path that exists is: microapp calls `AICORE.sendMessage`, which delegates to the configured engine (LogiksAI), which currently returns false. Everything else is the platform AICore will become.

---

> Return to the [Documentation Index](00-index.md) or revisit [§4 MicroApp / Plugin](04-microapps.md) for the contract surface AI microapps build on.
