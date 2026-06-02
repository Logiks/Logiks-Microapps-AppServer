# Requirement to Functionality

Most platforms make you translate a business requirement into code. Logiks shortens that journey: functionality decomposes into a small set of named building blocks, and most of a requirement maps onto them through configuration rather than custom development. This article walks the path from a stated need to a running capability, and shows how to keep the two traceable to each other.

> Background reading: [§4 MicroApp / Plugin](../04-microapps.md), the building-block reference in [training §6](../training/6-building-blocks.md), the reusable modules in [§10 Common Modules](../10-common-modules.md), and the requirements/process thinking in [training §17–19](../training/4-advanced.md).

---

## The path

A requirement becomes functionality in five steps. The middle three are where Logiks does the heavy lifting.

1. **Understand the requirement** — what problem, for whom, and what "done" looks like. Not "build a screen," but "what process is this?"
2. **Model the process and data** — the entities, their relationships, and the states a record moves through.
3. **Map to building blocks** — decide which forms, reports, dashboards, workflows, and access rules deliver the requirement.
4. **Build** — configure those blocks (and write code only where configuration can't reach).
5. **Verify** — confirm each requirement is covered by something you can point at and test.

The discipline that makes this reliable is in step 1 and step 3: state the requirement as a *process*, then map each part of it to a *concrete artifact*.

---

## Requirements describe processes, not screens

A request usually arrives as a screen wish ("we need a leave form"). The useful version is the process behind it:

> Leave request → manager approval → HR record → balance updated → employee notified.

Once it's a process, the data and the functionality fall out of it: there's an entity (a leave request), it has states (submitted, approved, rejected), actors with different rights (employee, manager, HR), things that happen on transitions (notify, update balance), and questions people will ask of it (pending approvals, leave taken by team). Each of those is a building block.

This reframing — from screen to process — is the single highest-leverage habit ([training §18–19](../training/4-advanced.md)). Everything downstream gets easier when the requirement is a process.

---

## The mapping

Translate the requirement clause by clause. Most clauses land on one of these:

| The requirement says… | Logiks functionality | Built with |
|---|---|---|
| "capture / enter X" | A **form** | field types, groups, validation ([§6.3](../training/6-building-blocks.md#63-forms)) |
| "X depends on Y" (e.g. Site depends on Contractor) | A **dependent dropdown** | `dataSelectorFromTable` / `dataMethod` |
| "X is always the current user / tenant" | **Forced server-side values** | `forcefill` |
| "list / search / filter X" | A **report** | `source` + `datagrid`, filters ([§6.2](../training/6-building-blocks.md#62-reports)) |
| "totals / counts / trends" | Report aggregates or a **dashboard** | aggregate columns; chart cards ([§6.4](../training/6-building-blocks.md#64-dashboards--charts)) |
| "approve / route / move through stages" | A **workflow** | status flow + `presubmit`/`postsubmit` hooks ([§6.5](../training/6-building-blocks.md#65-hooks--workflow-automation)) |
| "notify someone when…" | **Notifications** | NotificationMatrix + messaging vendors ([§10.4](../10-common-modules.md#104-advanced)) |
| "who can see / do what" | **Access control** | `policies` in `logiks.json` + RBAC ([§4](../04-microapps.md)) |
| "each customer/branch sees only theirs" | **Multi-tenancy** | tenant-scoped data (built in) |
| "the standard list of departments/types" | **Master data** | `datalists` ([§10.2](../10-common-modules.md#102-masters)) |
| "import the existing spreadsheet" | **Bulk import** | Excel import → DB ([§6.6](../training/6-building-blocks.md#66-data-processing)) |
| "print / generate a document" | **Templates** | document templates ([§10.4](../10-common-modules.md#104-advanced)) |
| "run nightly / on a schedule" | **Scheduled job** | `automator` (singleton-elected) |
| "we must be able to see who changed what" | **Audit trail** | `logs.audit` / `logs.activity` ([§11](../11-audit-logs.md)) |
| "a screen the standard blocks can't express" | A **custom component** | React `.jsx` ([§6.7](../training/6-building-blocks.md#67-custom-react-components)) |
| "talk to system Z" | **Integration** | a plugin action / webhook (often a developer task) |

The whole set lives inside one **plugin** — a folder with a `logiks.json` — which is the deployable unit you ship ([§4](../04-microapps.md)).

---

## A worked example

Take the leave-request requirement and map it:

| Requirement | Artifact |
|---|---|
| Employees submit leave with type, dates, reason | a **form**; `leave_type` is a `datalist`; `employee_id`/`tenant` set by `forcefill` |
| Managers see pending requests for their team | a **report** filtered by status and team |
| Manager approves or rejects | a **workflow**: states `submitted → approved/rejected`, a `presubmit` rule, a `postsubmit` action |
| Employee is notified of the decision | a **notification** fired from `postsubmit` |
| HR sees leave taken this quarter | a **dashboard** with a chart card |
| Only HR can edit approved records | a **policy** on the edit action |
| Every change is traceable | `logs.audit` on the state change |

Nothing on that list is custom code. It is a plugin with one form, one report, one dashboard, a workflow, a few policies, and a notification — all configuration. That is the typical shape of a Logiks feature, and it's why a requirement reaches working functionality quickly.

---

## Build in the right order, on the right rung

When you build, climb down the ladder only as far as you must ([training §29](../training/4-advanced.md)):

1. **Reuse** — is there a Setup module or an existing plugin action that already does this? ([§10](../10-common-modules.md))
2. **Configure** — express it in `logiks.json` / `routes.json` and the form/report/dashboard definitions.
3. **Extend** — add an `api.js` function in your plugin for logic configuration can't express.
4. **Custom** — a React component or an integration, where nothing else fits.

Most requirements finish at step 2. Custom components and integrations are where effort and risk concentrate, so identify them early and treat them as their own line item — they're also the natural place to involve a developer.

---

## The requirements you don't have to write

Some functionality is asked for in a requirements document but is already part of the platform. You don't re-specify or rebuild it; you configure it:

- **Authentication and sessions** — login, tokens, MFA.
- **Multi-tenancy** — every request carries a tenant; scope data by it.
- **Access control** — declare policies; RBAC enforces them.
- **Audit and activity history** — emit `logs.*`; the trail is recorded with tamper-evident hashing ([§11.4](../11-audit-logs.md#114-audit--activity-integrity)).
- **Rate limiting, security headers, CORS** — handled by the gateway.

Treat these as non-functional requirements the platform satisfies by default, and spend the requirement conversation on what's actually specific to the business.

---

## Keep requirement and functionality traceable

The mapping isn't just for building — it's the acceptance contract. For each requirement clause, name the artifact that delivers it and the way you'll confirm it:

| Requirement | Delivered by | Verified by |
|---|---|---|
| Submit leave | `leave` form | submit a request; the record is saved and owner-stamped |
| Manager approval | workflow + report | a manager moves a request to approved; an employee cannot |
| Decision notification | `postsubmit` notification | approving sends the message |
| HR-only edit | edit policy | a non-HR user is refused |
| Traceability | `logs.audit` | the state change appears in the audit log |

If a requirement clause has no artifact, it isn't built. If an artifact maps to no requirement, question why it exists. This one-to-one view is what lets you tell a customer, line by line, that the requirement is met — and it doubles as the test plan.

---

## Where requirements turn into trouble

- **"Just add a field/screen."** Ask what process it serves. A field with no process behind it usually signals an unmodelled requirement.
- **Custom-by-default.** Reaching for a React component when a configured form would do adds cost and maintenance for no gain. Justify every drop down the ladder.
- **High effort, low value.** Some asks cost far more than they return ([training §30](../training/4-advanced.md)). Surface that during scoping, propose the smaller cut, and let the business decide.
- **Skipping the data model.** Most rework traces back to getting entities and relationships wrong before any building started ([training §17](../training/4-advanced.md)).

---

Functionality on Logiks is mostly assembled, not authored. The work that decides whether a feature is good happens before any building block is touched — understanding the process, modelling the data, and mapping each requirement to the thing that satisfies it. Do that well and the build is short, the result is traceable, and the customer can see their requirement reflected back, clause by clause.
