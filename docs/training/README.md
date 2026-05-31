# Developer Training

This folder is the onboarding curriculum for developers building on Logiks MicroApps. Where chapters 1–8 in [../00-index.md](../00-index.md) document *how the framework works*, this track teaches *how to build well* on it — the prerequisites, a phased plan, and the engineering principles behind good plugins.

The business-facing layer this track focuses on — forms, reports, dashboards, menus, components — is exactly what lives inside a plugin's UI folders (`plugins/<id>/forms/`, `reports/`, `dashboards/`, `pages/`, `component/`, `menu/`) and is served through the plugin's `source` action. So everything here is built *inside a plugin*, as defined in [§4 MicroApp / Plugin](../04-microapps.md).

## Reading order

| # | File | What it covers |
|---|---|---|
| ★ | [quickstart.md](quickstart.md) | **Start here if you're new** — a one-page rundown of the whole plan |
| 0 | [0-prerequisites.md](0-prerequisites.md) | Skills to have before starting, a 1-week prep schedule, and a readiness matrix |
| 1 | [1-training-plan.md](1-training-plan.md) | A 6-week phased plan with hands-on tasks, mini-projects, and assessments |
| 2 | [2-basic-rules.md](2-basic-rules.md) | Maintainability rules: naming conventions, folder structure, error handling |
| 3 | [3-design-principles.md](3-design-principles.md) | Core design principles **1–16** |
| 4 | [4-advanced.md](4-advanced.md) | Advanced principles **17–33** (continues the sequence from file 3) |
| 5 | [more.md](more.md) | A forward-looking list of advanced topics for after the main track |
| 6 | [6-building-blocks.md](6-building-blocks.md) | **Reference**: the actual definition syntax for reports, forms, dashboards, automation & custom React components (backs the Phase 2–6 hands-on work) |

The design principles are one continuous sequence: **1–16** in file 3, **17–33** in file 4. File 5 is a separate roadmap list, not part of that numbering. File 6 is reference material, not a principle.

## How the principles map to the framework

The principles in files 3–4 are general enterprise-engineering ideas; here is where each lands in the Logiks plugin model:

| Principle | In Logiks |
|---|---|
| Component-based / reuse | `api.js` functions are cluster-wide service actions (`<plugin>.<fn>`); reuse via `_call(...)` ([§4.4](../04-microapps.md#44-how-a-microapp-runtime-service-works), [§4.5](../04-microapps.md#45-cluster-wide-reuse)) |
| Separation of concerns | Logic in `api.js`, exposure in `routes.json`, rendering in UI folders served by the `source` action |
| Configuration-driven | `logiks.json` (`policies`, `navigation`) and `routes.json` (`data`) wire behaviour through config |
| Event-driven | `routes.json` `events` map subscribes to topics; `ctx.emit(...)` publishes ([§7](../07-event-system.md)) |
| RBAC / authorization | `logiks.json` `policies` map, enforced by the `RBAC` controller; menus gated via `to_check: "policy#<key>"` |
| Validation / data integrity | Route `params` in `routes.json` are validated before the handler runs |
| Data access | The `_DB` global (and other mirrored AppServer helpers) rather than raw SQL in handlers |
| Per-plugin schema / migration | `dbschema/schema_*.json` applied by `DBMIGRATOR` on Worker boot ([§4.7](../04-microapps.md#47-per-plugin-db-migration)) |
| Configuration vs customization | Config → extend with your own plugin → reuse via `_call` → avoid core changes; plugins hot-plug without touching the runtime |
| Distributed runtime / scalability | Plugins run on Workers that join the cluster bus and are reachable cluster-wide ([§5](../05-workers.md)) |

## Prerequisite reading

Before starting file 1, skim [§1 Introduction](../01-introduction.md), [§2 Getting Started](../02-getting-started.md), and [§4 MicroApp / Plugin](../04-microapps.md) so the principles below have concrete mechanics to attach to.
