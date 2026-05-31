# Critical Thinking in the Logiks Framework

Critical thinking in software is the ability to analyze problems deeply, question assumptions, evaluate trade-offs, and design based on real constraints instead of blindly following patterns, trends, or frameworks.

On Logiks this matters *more*, not less. The framework removes so much boilerplate — a plugin is a folder, a form is JSON, a dropdown is a `datalist`, RBAC is a `policies` map — that the hard part is no longer *writing* code. It is deciding **what to build, what to configure, and what to reuse**. This document maps the general discipline of critical thinking onto how you actually make those decisions in Logiks.

> This is the mindset behind the design principles in [training §3](../training/3-design-principles.md) and [§4](../training/4-advanced.md). Read this for the *why*; read those for the catalogue.

---

## What Critical Thinking Looks Like in Logiks

### 1. Understanding the Actual Problem

Not every problem is a coding problem — and on Logiks, most aren't.

Example — "the report is slow":

- **Non-critical:** wrap everything in `_CACHE`.
- **Critical:** find the root cause first —
  - Is the report `source` SQL joining unindexed columns? (look at the `where`/`cols` in the report JSON, [§6.2](../training/6-building-blocks.md#62-reports))
  - Is a form firing too many dependent `dataSelectorFromTable` lookups per keystroke?
  - Is a plugin calling `_call` across the cluster bus in a loop instead of one batched action?
  - Is it a missing index on an `appdb` table, not an app problem at all?
  - Is the page re-fetching `source` definitions instead of using the cached `.js`?

The goal is the *root cause*, not a reflex. The platform gives you the seams to inspect — use them before adding machinery.

---

### 2. Evaluating Trade-offs (the Logiks decision ladder)

Every solution has a cost. On Logiks the most important trade-off is captured by the framework's own **Configuration → Extension → Customization → Core** ladder ([§4 #29](../training/4-advanced.md)). Always climb from the top:

| Question | Prefer | Over |
|---|---|---|
| Can a **Setup module** ([§9](../09-common-modules.md)) already do this? | `datalists`, `menuManager`, `vendorManager`, `automator`, `NotificationMatrix` | new code |
| Can it be **config**? | `logiks.json` `policies`/`navigation`, `routes.json`, a form/report JSON | a handler |
| Does it need **logic**? | an `api.js` function in *your* plugin | forking shared code |
| Is the logic **reusable**? | call another plugin's action via `_call` | re-implementing it |
| Does it truly need **core changes**? | almost never — extend via a plugin | editing the AppServer/Worker |

Other real Logiks trade-offs a critical thinker weighs:

- **New plugin vs extend an existing one?** A plugin is the isolation + reuse boundary. Split when ownership/lifecycle differ; don't split for the sake of it.
- **Event (`ctx.emit`) vs direct (`_call`)?** Events fan out to *all* subscribers cluster-wide and decouple producer from consumer ([§7](../07-event-system.md)); `_call` is request/response and couples you to a specific action. Use events for "react to this," `_call` for "I need an answer."
- **Custom React component vs JSON form/report?** JSON definitions are cheaper to maintain and reuse; reach for a `.jsx` component ([§6.7](../training/6-building-blocks.md#67-custom-react-components)) only when the JSON model can't express the UI.
- **Dedicated table vs shared `appdb` rows?** Namespace your own (`<plugin>_*`) when you own the data; reuse platform tables when you're extending platform concepts.
- **Run on a Worker vs the AppServer?** Heavy/owned logic belongs in a plugin on a Worker; the AppServer is the gateway.

Optimize for maintainability, operational simplicity, team skill, and delivery speed — not "newest." The framework already chose the stack; your job is choosing the *shape* within it.

---

### 3. Thinking in Systems, Not Features

Feature-level: "add authentication."

Critical thinking — and a check on what Logiks **already provides** before you build anything:

- Multi-tenant? Every request already carries a tenant `guid`; data should be scoped by it.
- RBAC? Declare a `policies` map in `logiks.json`; `RBAC` enforces it ([§4](../04-microapps.md)).
- Login methods? `logiksauth`, `local`, federated login already exist; MFA lives in `lgks_mfa`.
- Service-to-service? There's an `s2stoken` path so AICore/jobs act with identity.
- Audit? `logs.audit` already stores tamper-evident before/after state ([§10](../10-audit-logs.md)).
- Owner stamping? `forcefill` forces tenant/owner columns from the session on save.

The critical thinker asks "what does the platform already solve?" *before* writing a login screen. The second-order effects (tenant scoping, audit, revocation) are mostly already wired — reusing them is the design decision.

---

### 4. Challenging Assumptions

Strong Logiks engineers ask:

- Do we need a **new plugin** for this, or is it a component/route on an existing one?
- Can this be a **`datalist` / `policy` / `routes.json` entry** instead of code?
- Can the **platform** solve it (a Setup module, a hook, the event bus) instead of application logic?
- Is **AICore** actually the right tool here, or is a deterministic `bizrules` hook simpler and governable? (Probabilistic ≠ better.)
- Is this **abstraction** helping, or am I hiding behavior I'll need to debug later?

A concrete cautionary example from this very codebase: frontend logging via `_DBLOGGER._log` **silently returns `false`** when the target table is missing or the `ALLOWED_LOGS` check mismatches ([§10.5](../10-audit-logs.md)). A non-critical thinker assumes "logging works because the call succeeded." A critical thinker verifies the row actually landed. *The call returning is not the same as the effect happening.*

---

### 5. Designing for Failure

The Logiks runtime is distributed (Workers join a cluster bus), so failure is the default case. Assume: a Worker drops, the transporter reconnects, an action times out, an event is delivered twice, an operator ships a bad plugin.

What the framework already gives you — and what you must design *with*:

- **Retries & timeouts** — the broker runs `retryPolicy` (retries) with a `requestTimeout` (~10s); design actions to be safe to retry.
- **Idempotency** — events fan out to *all* subscribers; a `logs.activity`/`postsubmit` handler may run more than once. Make handlers idempotent (no double-charge, no duplicate row).
- **Graceful drain** — Workers heartbeat and drain on `SIGINT/SIGTERM` so in-flight calls finish ([§4 lifecycle](../04-microapps.md)); don't hold un-checkpointed state.
- **Isolation** — a crashing plugin shouldn't take down others; keep failures inside the plugin boundary.
- **Observability** — emit `logs.*` and write file logs ([§10](../10-audit-logs.md)) so the request → action → webhook → notification chain is traceable.
- **Graceful degradation** — if a `vendorManager` driver (SMS/email) is down, queue and retry via `automator`; don't lose the notification.

---

## In Architecture Discussions

A critical thinker doesn't say:

> "Make it a separate plugin."

They say:

> "Given that this logic has its own release cadence and a distinct owner, and that other plugins already need to call it, a separate plugin reduces coupling and lets it hot-plug independently — provided we keep its action contract stable and emit events for the side effects rather than letting callers reach into its tables."

The difference is reasoning from Logiks' real constraints (hot-plug, contracts, the bus) instead of a slogan.

---

## Core Skills Behind It

**Technical (Logiks-flavored):** plugin/contract design, SQL & `appdb` data modeling, the event vs `_call` model, RBAC/policy design, the config ladder, operational thinking about the cluster bus.

**Cognitive:** first-principles thinking, trade-off evaluation, risk analysis, long-term consequence analysis, and *abstraction control* — knowing what `_DB`, `_call`, the `source` action, and the JIT JSX compiler hide, and what it costs.

---

## How to Build Critical Thinking in Logiks Developers

**Force design reasoning.** Before a plugin is written, ask: Why a plugin and not a component? What did you reject — config, a Setup module, an existing action? What happens at 10× rows/users? What fails first when a Worker drops?

**Run contract reviews.** Review the *action and event contracts* a plugin exposes, not just its code — those are what other plugins depend on. Expose hidden assumptions, don't criticize.

**Teach failure cases.** Most learn the happy path. Teach the Logiks-specific ones: duplicate event delivery, a plugin calling a not-yet-registered action, a silent `_DBLOGGER` no-op, a dependent dropdown storm, a Worker draining mid-request.

**Avoid blind framework dependency.** Framework fluency ≠ engineering. Understand what the abstractions hide: how the `source` action resolves and caches `.jsx`, how `runAction` dispatches `data`, how `forcefill` overrides client input, what `_DBLOGGER`'s allowlist gates. Know the escape hatches and the lifecycle.

---

## Why This Matters More on Logiks

Logiks is an AI-first, hot-pluggable, distributed, contract-driven platform — every one of those properties raises the stakes:

- **Hot-pluggable** plugins create dependency complexity — what calls what, and is it loaded yet?
- **Distributed** modules make observability and idempotency non-negotiable.
- The **AICore** (Tier 4, [§8](../08-ai-layer.md)) introduces probabilistic behavior — decisions must stay governable, with deterministic hooks where correctness matters.
- **Plugin isolation** affects both performance and security.
- **Contracts matter more than implementations** — a stable action/event contract lets modules evolve independently.

The engineering challenge isn't "making modules work." It's ensuring modules **evolve independently, fail in isolation, keep stable contracts, stay observable, and keep AI decisions governable.** That is architectural critical thinking, not coding ability.

---

## One-Line Definition

> Critical thinking on Logiks is the disciplined ability to choose the right level of the Configuration → Extension → Customization ladder for the real problem — under the constraints of a distributed, hot-pluggable, contract-driven platform — with its future consequences in mind.
