# 9. AI Layer

> Audience: **app developers** building AI-powered microapps, **platform engineers** configuring AI engines, **architects** evaluating Logiks' AI posture.

The AI Layer is named **AICore** — the 4th tier of Logiks' T4 architecture, implemented in this repo at [api/controllers/aicore.js](../api/controllers/aicore.js) plus the module tree under [api/controllers/aicore/](../api/controllers/aicore/). AICore is *the* agentic platform of Logiks: it owns persona/agent definitions, the tool-calling agent loop, conversation history, background task scheduling, and the engine layer that talks to LLM providers. Microapps consume those capabilities through AICore's interfaces and the REST surface it exposes, and extend it by registering their own personas, agents and tasks — they do not reinvent the agentic stack.

Custom, proprietary — not built on LangChain, LlamaIndex, or the Anthropic Agent SDK — because the agentic primitives need to be first-class consumers of Logiks' tenancy, RBAC, audit, and event surfaces. The agent loop is a real multi-turn tool-use loop built directly against each provider's native tool-calling protocol.

---

## 9.1 AI Architecture

### Where AICore Fits

```
┌──────────────────────────────────────────────────────────────────┐
│  Microapps (use-case-specific solutions: support, sales, …)      │
│   · define personas (system prompt, model, tool/knowledge scope) │
│   · define agents (which persona, how it executes, limits)       │
│   · contribute tools via tools.json (registration path, not live)│
│   · call AICORE.sendMessage / runAgent / queueAgentRun           │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  AICore  (api/controllers/aicore.js + aicore/*.js) — Tier 4       │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │  Personas & Agents (sys_ai_personas / sys_ai_agents)      │   │
│   │  Agent loop (agentLoop.js)  ·  Tool dispatch (tooling.js) │   │
│   │  RAG delivery (rag.js)      ·  Tasks (tasks.js + cron)    │   │
│   │  Conversations (conversations.js)  ·  Basics (basics.js) │   │
│   │  Resilience: retry, timeout, circuit breaker              │   │
│   └──────────────────────────────────────────────────────────┘   │
└────────────────────────────┬─────────────────────────────────────┘
                             │  engine.sendMessage(sessId, messages, tools, …)
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  Engine layer  (api/controllers/aicore/engines/<engine>.js)       │
│   AIEngine (abstract)                                             │
│       │                                                           │
│       ├── LogiksAI   ──►  LogiksAI hosted LLM platform (stub)     │
│       ├── Claude     ──►  Anthropic Messages API                  │
│       └── OpenAI     ──►  OpenAI Responses API                    │
└──────────────────────────────────────────────────────────────────┘
                             │  HTTP / SDK
                             ▼
                       Hosted or local LLM
```

The architecture cleanly separates three concerns:

1. **LLM I/O** — engines adapt a generic `{messages, tools}` shape to a specific provider's wire protocol; pure protocol translation (see [api/controllers/aicore/engines/aiengine.js](../api/controllers/aicore/engines/aiengine.js)).
2. **Agentics** — AICore owns persona/agent definitions, the tool-calling loop, conversation history, scheduling, and resilience.
3. **Domain** — microapps own their business logic: they define personas/agents for their use case. Contributing their own tools (via `tools.json`) is the intended path but isn't fully wired yet (see Tool Calling, below) — today a persona's tool list draws from the built-in system tools.

### AI Runtime Layer

AICore runs *inline* with the AppServer process. The controller is loaded as a global (`AICORE`) at boot; `AICore.initialize()` reads `CONFIG.aicore`, instantiates one adapter per configured engine (sorted by `priority`), and wires resilience (retry/timeout/circuit-breaker) config for the agent loop and the `basics.js` utilities to share.

Three execution lanes exist for running an agent turn:

| Lane | How it runs | Entry point |
|---|---|---|
| **inline** | In the calling process, synchronously | `AICORE.runAgent(...)` / `AICORE.sendMessage(...)` |
| **queue** | Published to the cross-node NATS queue (`aicore.agent.run`); any node running `AICORE.startQueueConsumer()` picks it up | `AICORE.queueAgentRun(...)`, or `POST /ai/agents/:agentCode/run?async=true` |
| **local_worker** | Scaffolded, not yet dispatched | [api/workers/aiagent.worker.js](../api/workers/aiagent.worker.js) — a partial-bootstrap worker-thread lane for CPU-heavy local work, documented and ready to receive jobs, but nothing currently routes an agent's `execution_mode: "local_worker"` to it |

Recurring work (scheduled tasks) rides the platform's existing cron infrastructure ([api/controllers/autojobs.js](../api/controllers/autojobs.js)) rather than a bespoke scheduler — see §9.3 Tasks.

### Engine Plugin Pattern

To add a new LLM provider:

1. Create `api/controllers/aicore/engines/<provider>.js` extending `AIEngine` ([aiengine.js](../api/controllers/aicore/engines/aiengine.js)).
2. Implement `__name()` and `async sendMessage(sessId, messages, tools, userInfo, params)`, translating the generic message/tool shape into the provider's native protocol and translating the response back into `{ message, toolCalls, usage, raw }`.
3. Register the driver in [api/controllers/aicore/index.js](../api/controllers/aicore/index.js)'s `DRIVERS` map.
4. Add an entry under `CONFIG.aicore.engines` (`{ key, driver, priority, config }`).

Engines are provider-agnostic from the agent loop's point of view — `agentLoop.js` and `basics.js` only ever see `{message, toolCalls, usage, raw}`, never a provider-specific response shape.

---

## 9.2 LLM Integration

AICore supports multiple engines simultaneously, ordered by `priority`. `resilience.js`'s `callEngine()` tries them in order, applying per-engine retry/timeout and a circuit breaker (state kept in `_CACHE` so it's shared cluster-wide, not per-process) — if the highest-priority engine is failing or its breaker is open, the call falls through to the next one. This is real fallback behaviour, not a documented intention.

### Claude

[api/controllers/aicore/engines/claude.js](../api/controllers/aicore/engines/claude.js) — fully implemented against the Anthropic Messages API via `@anthropic-ai/sdk`. Tool calls round-trip as native `tool_use` / `tool_result` content blocks — the same protocol Claude Code itself is built on. Supports multimodal input (text + base64 images) for `describe`/`ocr`.

### OpenAI

[api/controllers/aicore/engines/openai.js](../api/controllers/aicore/engines/openai.js) — fully implemented against OpenAI's Responses API (`responses.create`), using `function_call` / `function_call_output` for tool calling. Also the only engine wired for `embed()` (`text-embedding-3-small` by default).

### LogiksAI

[api/controllers/aicore/engines/logiksai.js](../api/controllers/aicore/engines/logiksai.js) — Logiks' own hosted LLM platform, and the default/priority-1 engine in `config_sample.json`. The request/response mapping (`{url, apikey, appid}` → `POST {url}/chat`) is written against a best-effort field layout and is **not yet confirmed against LogiksAI's real API reference** — treat it as a stub with a realistic shape until verified.

### Ollama and other providers

Not wired yet. Adding one is exactly the four-step engine plugin pattern above — no architectural gap, just an unwritten adapter file.

### Multi-Model Routing

Today: one process can run several engines with priority-ordered fallback (above), but a given **persona** pins to a single `engine_key` + `model`. Routing a single call across models by cost/quality/latency, or letting a skill-equivalent declare a *preferred* engine rather than a pinned one, is not implemented.

### Embeddings

`AICORE.embed(input, ctx, params)` → `basics.js`'s `embed()` tries engines in priority order and uses the first one whose adapter implements `embed()` — today that's OpenAI only (Claude and LogiksAI throw `AIEngine`'s default "does not support embeddings"). There is no separate `CONFIG.aicore.embeddings` provider selection; it's the same engine list.

---

## 9.3 AI Agents

### Personas and Agents — the two building blocks

AICore replaced the originally-planned single "Skill" abstraction with two simpler, DB-backed registries (`sys_ai_personas` / `sys_ai_agents` in `appdb`, cached in `_CACHE` with upsert-invalidation — same pattern as `api/controllers/providers.js`):

**Persona** — *what the AI is and what it's allowed to touch*: system prompt, engine/model, allowed MCP tools, allowed knowledge scopes (and knowledge delivery mode — see RAG below).

```javascript
await AICORE.personas.upsert(guid, "support-agent", {
    title: "Support Agent",
    systemPrompt: "You are a support assistant… use tools to look up real data before answering.",
    engineKey: "claude",                 // must match a `key` in CONFIG.aicore.engines
    model: "claude-sonnet-5",
    allowedTools: ["query_schema", "query_index", "query_results"], // subset of REGISTRY.listTools()
    allowedKnowledge: ["kb.support"],    // optional — see RAG
    knowledgeMode: "on_demand",          // off | forced | on_demand | both
    params: { temperature: 0.2 }
}, ctx);
```

**Agent** — *when/how a persona actually runs*: which persona, execution mode, step/time limits, trigger.

```javascript
await AICORE.agents.upsert(guid, "support-bot", {
    title: "Support Bot",
    personaCode: "support-agent",
    executionMode: "inline",   // inline | queue | local_worker (see §9.1 — local_worker not yet dispatched)
    maxSteps: 6,                // tool-calling steps before giving up
    timeoutMs: 30000,
    trigger: "manual"
}, ctx);
```

Both are exposed over REST by [api/services/agents.service.js](../api/services/agents.service.js): `GET/POST/DELETE /ai/personas(/:personaCode)` and `GET/POST/DELETE /ai/agents(/:agentCode)`. Like every AICore route, these are only auto-aliased under the private, authenticated `/api` route — `agents.*`/`tasks.*` aren't in `CONFIG.noauth`, so they're never reachable via `/api/public` without a Bearer JWT / API key / `tkn` / `s2stkn`.

### The Agent Loop

[api/controllers/aicore/agentLoop.js](../api/controllers/aicore/agentLoop.js) is the real, working multi-turn tool-use loop: load the agent + its persona → build the tool list → call the engine → if it asks for tool calls, execute them and feed results back → repeat until the model stops asking for tools or `max_steps` is hit → persist the turn.

```javascript
const result = await AICORE.runAgent("support-bot", "How many orders were placed last week?", null, ctx);
// result: { sessId, status: "success" | "max_steps_reached" | "error", message, steps, response, turnMessages }
```

Or over REST: `POST /ai/agents/:agentCode/run` with `{ message, sessId? }`; add `?async=true` to dispatch via the queue lane instead and get back `{ sessId, status: "queued" }`. Passing the same `sessId` back in continues the conversation — history is reassembled from `conversations.js` on every call.

`AICORE.sendMessage(message, sessId, moduleId, params, ctx)` is the no-explicit-agent entry point: it resolves an agent via `moduleId` if given, else via [intentDetector.js](../api/controllers/aicore/intentDetector.js) (a small regex-rule matcher) against `CONFIG.aicore.intentAgentMap`, else `CONFIG.aicore.defaultAgent`.

### Tool Calling

AICore does not have its own separate tool system — [tooling.js](../api/controllers/aicore/tooling.js) wraps the existing **MCP tool registry** ([api/controllers/mcp/registry.js](../api/controllers/mcp/registry.js)) directly, in-process: any tool an MCP client would see via `tools/list`/`tools/call` is available to an agent, narrowed to a persona's `allowedTools` (empty/missing list = unrestricted). That dispatch path is genuinely built — not a roadmap item.

What's in the registry today is narrower than "any broker action", though. Two sources feed it:

- **System tools** ([api/controllers/mcp/tools/](../api/controllers/mcp/tools/)) — always registered. Today that's four: `query_schema`, `query_index`, `query_analyse`, `query_results` — natural-language-friendly access to the Logiks JSON query DSL.
- **Plugin tools** — the intended path for microapps to contribute tools: a plugin declares them in a `tools.json` manifest next to its `logiks.json`. The AppServer-side registration code exists (`loadPluginTools()`), but the chain feeding it isn't complete yet — the Worker side doesn't read/forward `tools.json`, and `system.plugins` doesn't aggregate a `tools` array yet, so `loadPluginTools()` currently has nothing to register (you'll see `MCP: failed to load plugin tools from system.plugins` in the boot log; harmless today, but a sign this path isn't live). Until that's finished, a plugin cannot yet make its own actions callable as agent tools this way.

Two tools are injected by the agent loop itself rather than coming from the MCP registry:

- **`knowledge_search`** — added when a persona's knowledge mode is `on_demand`/`both` (see RAG, below).
- **`create_task`** — added for any persisted chat turn whose persona allows it; lets the model defer work to a background task (one-off or recurring) instead of answering inline. See §9.3 Tasks.

### Memory

Two tiers exist today, both real:

| Tier | Backed by | Lifetime | Module |
|---|---|---|---|
| **Episodic (conversation) memory** | `_CACHE` hot buffer (sliding TTL) + durable `log_ai_conversations`/`log_ai_messages` in `logdb` | Per session; durable log never expires | [conversations.js](../api/controllers/aicore/conversations.js) |
| **Semantic memory (vector)** | — | — | Not present. `knowledge.js`'s `search()`/`extract()` are stubs (`search` returns `[]`, `extract` is empty) |

The RAG *delivery* pipeline (below) is fully wired to call into semantic memory the moment it exists — nothing in `agentLoop.js` or `rag.js` needs to change when `knowledge.js` is implemented.

### Tasks — background, scheduled agent work

[api/controllers/aicore/tasks.js](../api/controllers/aicore/tasks.js) is a durable work-item registry (`sys_ai_tasks`, `appdb`) — a real, built feature, not a design sketch. A task always runs under its owner's own identity and permissions (no privilege escalation via deferred work). Two ways to create one:

- **Directly**, via `AICORE.tasks.create(guid, { title, message, agentCode, repeat? }, ctx)` or `POST /ai/tasks`.
- **From inside a chat turn**, via the `create_task` tool the agent loop offers automatically — the model decides something needs deferred/background handling and calls it itself.

One-off tasks are dispatched immediately through the queue lane (`AICORE.queueAgentRun`, tagged with the `taskId`); `startQueueConsumer()` reports the outcome back onto the task row (`completed`/`failed`) once the run finishes. A **recurring** task (`repeat: { every, unit, until? }`) registers a row in `lgks_autojobs` — the platform's existing cron system — whose `job_script` points back at `tasks.runScheduled`, so every cron firing just re-dispatches the same task under the same owner; the task's status cycles `scheduled → queued → scheduled` rather than reaching a terminal state. Cancelling a recurring task also retires its autojob row so it actually stops firing.

REST surface ([api/services/tasks.service.js](../api/services/tasks.service.js)): `GET /ai/tasks`, `GET /ai/tasks/:taskId`, `POST /ai/tasks`, `POST /ai/tasks/:taskId/cancel`.

### Multi-Agent Systems

Today's primitive for composing agents is the MCP tool surface: nothing stops one agent's allowed tools from including a broker action that itself calls `AICORE.runAgent(...)` for another agent/persona, giving a supervisor → sub-agent topology. There is no dedicated orchestration layer beyond that — composition is whatever a microapp wires up using tool calling + `ctx.call`.

---

## 9.4 AI Pipelines

### RAG

The delivery mechanism is fully built in [rag.js](../api/controllers/aicore/rag.js): a persona's `knowledgeMode` controls how retrieved context reaches the model —

- `off` (default, no `allowedKnowledge`) — no knowledge involved.
- `forced` — retrieved once per turn, injected into context before the first engine call; the model doesn't choose.
- `on_demand` — exposed as the `knowledge_search` tool; the model decides whether/what to search.
- `both` — forces an initial retrieval *and* still offers the tool for follow-up queries within the same turn.

What's still a stub: the actual retrieval backend. `rag.js` calls `KNOWLEDGE.search(guid, query, false, { scopes }, {}, topN)` ([api/controllers/knowledge.js](../api/controllers/knowledge.js)), which returns `[]` unconditionally today. So RAG is wired end-to-end but currently never surfaces real hits — implementing `knowledge.js` is the only remaining piece.

### Embedding Pipelines

`AICORE.embed(input, ctx, params)` → first engine (priority order) that implements `embed()` — OpenAI today (see §9.2). `AICORE.ingestKnowledge(filePath, ctx)` chains `KNOWLEDGE.extract()` (also a stub) into `embed()`, so the ingest *path* exists but produces nothing until `knowledge.js`'s extraction is implemented.

### Vector Storage

Not present. No vector DB connection exists in the codebase yet; `knowledge.js`'s header comment lists the intended sources (a Vector Gateway service, MySQL full-text search, local RAG) but none are implemented. This is the one genuinely open architectural piece of AICore's roadmap — everything else documented as "built" above is real, runnable code.

### AI Orchestration — the actual end-to-end flow today

```
Caller: AICORE.runAgent(agentCode, message, sessId, ctx)   (or sendMessage / queueAgentRun)
        │
        ▼
Load agent (sys_ai_agents) + persona (sys_ai_personas)
        │
        ▼
Build tool list: MCP tools (scoped to persona.allowedTools)
   + knowledge_search (if knowledgeMode is on_demand/both)
   + create_task (if persisted turn and persona allows it)
        │
        ▼
If knowledgeMode is forced/both: retrieve once, inject as context
        │
        ▼
Loop (up to agent.max_steps):
   engine.sendMessage(messages, tools) via resilience.js
     (retry → timeout → circuit breaker → next-priority engine fallback)
        │
   tool calls? → dispatch via tooling.js (MCP) / rag.js / tasks.js → feed results back
        │
   no tool calls → done
        │
        ▼
Persist turn (conversations.js: hot cache + durable logdb)
        │
        ▼
Return { sessId, status, message, steps, response }
```

### Utility functions (no persona/agent needed)

[basics.js](../api/controllers/aicore/basics.js) implements a set of single-shot utilities, all built on the same `complete()` primitive (one engine call, no tools, with full resilience/fallback) and exposed directly on `AICORE`: `summerize`, `extract` (structured fields from content), `classify`, `translate`, `generate` (raw completion), `moderate`, `describe` (vision), `ocr` (vision), `queryNL` (natural language over the Logiks JSON query DSL), `embed`. These accept the same flexible content shape as the agent loop (`string | {fileId} | {attachment} | {text} | {mimeType, data}`), resolved by [content.js](../api/controllers/aicore/content.js). This replaces what an earlier design called `oneShot` — there is no `AICORE.oneShot`; `generate` is the raw one-shot entry point today.

---

## What Microapps Do, What AICore Does

| Concern | Owner |
|---|---|
| LLM model selection | AICore (per-persona `engineKey`/`model`, with cluster-wide priority fallback) |
| LLM I/O protocol | Engine adapter (`api/controllers/aicore/engines/*.js`) |
| Persona/agent definitions | Microapp (via `AICORE.personas`/`AICORE.agents` or `/ai/personas`, `/ai/agents`) |
| Agent loop control, retry/fallback | AICore |
| Tool registry | AppServer broker + MCP registry (not AICore-specific) |
| Tool execution | AICore's `tooling.js`, via `ctx.call(...)` under RBAC/audit |
| Conversation history | AICore (`conversations.js`) |
| Background/recurring task scheduling | AICore (`tasks.js` + the platform's existing cron/autojobs system) |
| Knowledge retrieval backend | **Open** — `knowledge.js` is a stub; implementing it is the main remaining gap |
| Vector DB connection | **Open** — not yet built |
| Domain logic | Microapp |
| Use-case-specific prompts (personas) | Microapp |
| Contributing new tools (`tools.json` → MCP registry) | Microapp (intended path; not fully wired yet) |
| Use-case UI | Microapp |

The headline: **microapps define personas/agents and tasks run under them; AICore runs the loop, keeps history, schedules recurring work, and talks to the LLM.**

## What This Chapter Documents vs Current Code

| Capability | Code state |
|---|---|
| `AICORE.sendMessage` / `runAgent` / `queueAgentRun` | ✅ Implemented |
| Agent loop (multi-turn tool calling) | ✅ Implemented |
| Personas / Agents registries + REST | ✅ Implemented |
| Engine: Claude | ✅ Implemented |
| Engine: OpenAI | ✅ Implemented |
| Engine: LogiksAI | 🚧 Wired, request/response shape unconfirmed against the real API |
| Engine: Ollama / others | ❌ Not written (plugin pattern ready) |
| Resilience (retry, timeout, circuit breaker, fallback) | ✅ Implemented |
| Tool calling via MCP registry (dispatch + system tools) | ✅ Implemented |
| Plugin-contributed tools (`tools.json` → MCP registry) | 🚧 Registration code exists; Worker-side + `system.plugins` wiring not finished |
| Tasks (one-off + recurring, via cron) | ✅ Implemented |
| `create_task` tool (model-initiated deferral) | ✅ Implemented |
| Conversation history (episodic memory) | ✅ Implemented |
| RAG delivery (forced / on_demand / both) | ✅ Implemented |
| Knowledge retrieval backend (`knowledge.js`) | ❌ Stub — returns no results |
| Vector DB integration | ❌ Not in code |
| Embeddings | 🚧 OpenAI only |
| `local_worker` execution lane | 🚧 Worker file exists; nothing dispatches to it yet |
| Intent detection | 🚧 Basic regex matcher, documented as such in its own source |

Compared to where this chapter stood before: personas, agents, the real agent loop, tool calling, tasks/scheduling, conversation history, and two full LLM engines all moved from "roadmap" to "built." The remaining gap is almost entirely the knowledge/vector-retrieval backend — everything that depends on it (RAG delivery, embedding ingestion) is wired and waiting.

---

> Return to the [Documentation Index](00-index.md) or revisit [§4 MicroApp / Plugin](04-microapps.md) for the contract surface AI microapps build on.
