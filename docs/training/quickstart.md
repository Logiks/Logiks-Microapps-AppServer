# Training Quickstart (for new developers)

A one-page rundown of the full plan. New to Logiks? Start here, then go deep with [1-training-plan.md](1-training-plan.md).

---

## The big picture (read once)

- A **plugin** (a.k.a. microapp) is just a **folder** with a `logiks.json` inside. Drop it into a Worker's `plugins/` folder and it goes live across the cluster. No central registry, no `appId`. ([§4](../04-microapps.md))
- Inside that folder you build with **four kinds of files**:
  - **`api.js`** → your logic (functions).
  - **`routes.json`** → which logic is reachable over HTTP + which events you listen to.
  - **`forms/` `reports/` `dashboards/`** → UI as **JSON definitions** (no code).
  - **`component/`** → **custom React (`.jsx`)** when JSON isn't enough.
- You rarely write SQL/HTTP by hand — you use globals like `_DB` (database) and `_call` (call another plugin). ([§4.5](../04-microapps.md#45-cluster-wide-reuse))

That's the whole model. Everything below is just learning each piece.

---

## The 6 weeks in one line each

| Week | You learn to build… | Lives in |
|------|---------------------|----------|
| 1 | A basic CRUD module + API — your first plugin | [§2 Getting Started](../02-getting-started.md), [§4](../04-microapps.md) |
| 2 | **Reports** — searchable, sortable, filterable data grids | [§6.2](6-building-blocks.md#62-reports) |
| 3 | **Forms** — fields, dependent dropdowns, validation | [§6.3](6-building-blocks.md#63-forms) |
| 4 | **Hooks & automation** — workflows, notifications, webhooks | [§6.5](6-building-blocks.md#65-hooks--workflow-automation) |
| 5 | **Custom React components** + Excel/bulk data import | [§6.7](6-building-blocks.md#67-custom-react-components), [§6.6](6-building-blocks.md#66-data-processing) |
| 6 | **Dashboards, charts & enterprise UI** — the final module | [§6.4](6-building-blocks.md#64-dashboards--charts) |

Spend ~half your day reading/concepts and half hands-on coding. Build something small each week.

---

## Your first day

1. Read [§1 Introduction](../01-introduction.md) and the "big picture" above.
2. Get an AppServer + a Worker running ([§2.2](../02-getting-started.md)).
3. Create the smallest plugin: a folder + `logiks.json` + a `routes.json` that returns `{ "message": "Hello" }` ([§2.3 Hello World](../02-getting-started.md#hello-world-microapp)).
4. Add an `api.js` function and call it over HTTP ([§2.3 API MicroApp](../02-getting-started.md#api-microapp)).

If those four work, you understand the core loop. The rest is breadth.

---

## When you're stuck

| Question | Go to |
|---|---|
| "What's the rule for naming / structure?" | [2-basic-rules.md](2-basic-rules.md) |
| "How do I write a form/report/dashboard?" | [6-building-blocks.md](6-building-blocks.md) |
| "How should I *think* about this (design)?" | [3-design-principles.md](3-design-principles.md) |
| "Do I have the prerequisites?" | [0-prerequisites.md](0-prerequisites.md) |
| "How do logs/audit work?" | [§10 Audit & Logs](../10-audit-logs.md) |

---

## Three habits that matter most

1. **Reuse before you build** — check if a component, helper (`_DB`), or another plugin's action already does it.
2. **Config over code** — prefer `logiks.json` / `routes.json` / JSON definitions before writing custom logic.
3. **Never trust the frontend** — validate with route `params`, stamp owner/tenant fields with `forcefill`.

> Ready for the full version? → [1-training-plan.md](1-training-plan.md)
