# Framework Building Blocks — Reports, Forms, Dashboards & Automation

> This is the **reference** the 6-week plan ([1-training-plan.md](1-training-plan.md)) builds on. Phases 2–6 teach reports, forms, workflow/automation, and advanced UI; this chapter documents the actual definition syntax for each.
>
> Everything here is grounded in real plugin definitions in the Worker repo — primarily the `docs` and `profile` plugins under `Microapps-Worker-NodeJS/plugins/`. The full catalogue of field types, formatters, and filter types is defined by the **frontend runtime** (outside this repo); the tables below list what is in active use in those plugins. When you hit a type not listed here, check an existing plugin definition for a working example.

---

## 6.1 Where building blocks live

Reports, forms, dashboards and menus are **JSON definition files inside a plugin folder**. They are not code — the runtime renders them. They are fetched on demand through the plugin's auto-generated `source` action (see [§4.2/§4.4](../04-microapps.md#42-anatomy-of-a-plugin-folder)).

| Building block | Folder | Rendered as |
|---|---|---|
| Reports | `plugins/<id>/reports/<name>.json` | A searchable/sortable data grid |
| Forms | `plugins/<id>/forms/<name>.json` | A create/edit form + InfoView (detail) |
| Dashboards | `plugins/<id>/dashboards/<name>.json` | A grid of chart/widget cards |
| Menus | `plugins/<id>/menus/<name>.json` | Navigation (also see `logiks.json` `navigation`) |
| Components | `plugins/<id>/component/<name>` | Reusable UI fragments referenced by `comps` |

A report row typically links to a form's **InfoView**; a form **saves** to a table and fires hooks; a dashboard **aggregates** the same tables. They share one convention: a `source` block backed by SQL, and **session placeholders** for the current user/tenant.

### Session placeholders

Any definition value may embed these; the runtime substitutes them per request:

| Placeholder | Resolves to |
|---|---|
| `#SESS_USER_ID#` | Current user id |
| `#SESS_GUID#` | Current tenant/user guid |
| `#SESS_GROUP_NAME#` | User's group |
| `#SESS_ACCESS_LEVEL#` | User's access level |
| `#SESS_PRIVILEGE_ID#` | User's privilege id |
| `#ADMIN_PRIVILEGE_RANGE#` | Privilege threshold for admin-level access |
| `#REFID#` | The reference id of the current record |

---

## 6.2 Reports

A report is a data grid over a SQL source. Example: [`plugins/docs/reports/main.json`](../../../Microapps-Worker-NodeJS/plugins/docs/reports/main.json).

### Anatomy

```json
{
  "schema": "1.0",
  "title": "Documents",
  "category": "DOCMAN",
  "privilege": "*",
  "policy": "docs.main.open",
  "blocked": false,
  "rowlink": false,
  "rowsPerPage": 20,
  "showExtraColumn": false,
  "custombar": false,
  "source":  { /* SQL data source */ },
  "buttons": { /* row / toolbar actions */ },
  "datagrid":{ /* column definitions */ }
}
```

### `source` — the data

```json
"source": {
  "type": "sql",
  "table": "docs_tbl,profiletbl",
  "cols": "docs_tbl.id,docs_tbl.title,(concat(docs_tbl.docyear,'-',docs_tbl.docyear+1)) as docyear,profiletbl.full_name",
  "where": {
    "docs_tbl.profile_id=profiletbl.id": "RAW",
    "(DATE(docs_tbl.expires) < CURDATE())": "RAW"
  },
  "limit": 10
}
```

- `table` — comma-joined tables; join conditions go in `where` as `"<condition>": "RAW"` (RAW = inject verbatim, no escaping).
- `cols` — explicit column list; supports SQL expressions and `as` aliases.
- `where` — a map of condition → mode; `"RAW"` injects the key as-is. Embed session placeholders here to tenant-scope the report.

### `datagrid` — the columns

Each key is a column; the value configures display, search, sort, formatting, filtering, and access:

```json
"docs_tbl.category": {
  "label": "Category",
  "sortable": true,
  "searchable": true,
  "hidden": false,
  "groupable": false,
  "formatter": "pretty",
  "policy": "docs.main.show_category",
  "style": "width:50px;",
  "filter": {
    "type": "dataSelectorFromUniques",
    "nofilter": "--",
    "table": "docs_tbl",
    "columns": "category,category"
  }
}
```

A column can also be **computed by a method** instead of a DB column:

```json
"docs_tbl.doclink": { "label": "Doc Link", "type": "method", "method": "getDocLink" }
```

**Column formatters** (observed in use):

| Formatter | Effect |
|---|---|
| `text` | Plain text (default) |
| `pretty` | Human-friendly rendering of coded values |
| `date` | Date formatting |
| `year` | Year-only |
| `uppercase` | Upper-cased text |

**Filter types** (the `filter.type` on a column):

| Filter type | Use |
|---|---|
| `dataSelectorFromUniques` | Dropdown of distinct values from a `table`/`columns` |
| `date` | Date / date-range picker |
| `select` | Static option list |
| `sql` / `LEFT` | Filter driven by a SQL fragment / left-match |
| `method` | Custom method supplies the filter options |

### `buttons` — row & toolbar actions

```json
"buttons": {
  "infoview@docs.document/{hashid}": {
    "icon": "fa fa-eye", "class": "branch", "label": "View Documents"
  }
}
```

The key is an **action route**: `infoview@<plugin>.<form>/{hashid}` opens the InfoView of the named form for the row (`{hashid}` is the row's hashed id). This is how a report row drills into a form's detail view.

---

## 6.3 Forms

A form defines a create/edit screen, its data source, lifecycle hooks, and its InfoView (read-only detail). Example: [`plugins/profile/forms/business.json`](../../../Microapps-Worker-NodeJS/plugins/profile/forms/business.json).

### Anatomy

```json
{
  "hooks":    { /* lifecycle hooks — see §6.5 */ },
  "forcefill":{ /* server-forced values */ },
  "source":   { /* table binding */ },
  "script":   "profile",            // optional client-side script bundle (plugin id)
  "gotolink": "infoview/profile.addressbook/{hashid}?",
  "fields":   { /* editable fields */ },
  "infoview": { /* detail view layout (tabs/panels) */ }
}
```

### `source` — table binding

```json
"source": {
  "type": "sql",
  "table": "profiletbl_business",
  "where": ["profile_id"],
  "refcol": "profile_id",      // FK column on this table
  "refmaster": "profiletbl",   // parent/master table
  "precreate": true            // auto-create the row if missing
}
```

`refcol`/`refmaster` model a master-detail relationship (this form's row hangs off a parent record); `precreate: true` creates the detail row on first open.

### `fields` — the inputs

Each key is a column; the value configures the input:

```json
"biz_currency": {
  "label": "Biz Currency",
  "group": "Info",
  "type": "dataSelector",
  "groupid": "biz_currency",
  "no-option": "Select Biz Currency",
  "required": true
}
```

**Field types** (observed in use):

| Type | Input |
|---|---|
| `text` | Single-line text |
| `textarea` | Multi-line text |
| `email` | Email (validated) |
| `phone` | Phone number |
| `url` | URL |
| `number` | Numeric |
| `date` | Date picker |
| `tags` / `tag` | Tag/multi-token input |
| `select` | Static dropdown |
| `dataSelector` | Dropdown from a named option group — set `groupid` |
| `dataSelectorFromTable` | Dropdown sourced from a DB table (see below) |
| `dataMethod` | Dropdown sourced from a controller method (see below) |
| `module` / `widget` | Embedded module/widget (`src` names it) |

**Common field attributes:** `label`, `group` (groups fields into sections), `required`, `hidden`, `no-option` (placeholder for selectors), `multiple`, `default`, `search` (searchable dropdown).

### Dynamic & dependent dropdowns

Three ways to populate a selector, in increasing dynamism:

```json
// 1. From a named option group (managed via the datalists module, §9)
{ "type": "dataSelector", "groupid": "biz_type" }

// 2. From a database table (searchable, filterable)
{
  "type": "dataSelectorFromTable",
  "table": "profiletbl",
  "columns": "full_name as title,id as value",
  "where": { "blocked": "false" },
  "search": true,
  "no-option": "Select Business"
}

// 3. From a controller method (fully custom)
{ "type": "dataMethod", "method": { "name": "getCountrySelector", "valuefield": "default" } }
```

`columns` always projects to `title` (shown) and `value` (stored). For dependent chains (e.g. Contractor → Site), the child selector's `where`/method references the parent field's value so it reloads when the parent changes.

### `forcefill` — server-forced values

```json
"forcefill": {
  "guid": "#SESS_GUID#",
  "groupuid": "#SESS_GROUP_NAME#",
  "access_level": "#SESS_ACCESS_LEVEL#",
  "privilegeid": "#SESS_PRIVILEGE_ID#"
}
```

These columns are set from the **session on save regardless of what the client sends** — the enforcement point for tenant/owner stamping. Never trust the browser for these (see [§3 #8 Security](3-design-principles.md)).

### InfoView — the detail view

The `infoview` block lays out the read-only record view as **groups/panels** (the basis of tabs and embedded sub-reports):

```json
"infoview": {
  "script": "profile",
  "groups": {
    "business": { "label": "Business", "type": "module", "src": "infoviewTable", "vmode": "view" }
  }
}
```

Each group can embed another module (`type: "module"`, `src: …`) — this is how a record's detail screen shows related reports/forms as tabs.

---

## 6.4 Dashboards & Charts

A dashboard is a grid of **cards**, each card a chart or widget over a SQL aggregate. Example: [`plugins/profile/dashboards/main.json`](../../../Microapps-Worker-NodeJS/plugins/profile/dashboards/main.json).

```json
{
  "policy": "my_dashboard.editorInvoice.access",
  "class_container": "container-fluid",
  "cards": {
    "card1": {
      "policy": "my_dashboard.editorInvoice.access",
      "title": "Invoices Status",
      "config": { "type": "pie", "chart_data": "actual" },
      "source": {
        "type": "sql",
        "table": "invoices_tbl",
        "cols": "invoices_tbl.status as title,count(*) as value",
        "where": { "invoices_tbl.created_by='#SESS_USER_ID#' OR #SESS_PRIVILEGE_ID# <= #ADMIN_PRIVILEGE_RANGE#": "RAW" },
        "groupby": "title",
        "orderby": "title desc"
      },
      "width": 3
    },
    "card4": { "title": "Item Chart", "config": { "type": "comps" }, "comps": "editorInvoice.items_wise_chart", "width": 12 }
  }
}
```

- `config.type` — chart kind (`pie`, `line`, …) or `comps` for a custom component.
- `config.chart_data` — `actual` or `actual_no_percent` (how values are rendered).
- `source.cols` — project to `title` (label) and `value` (metric); use `dataset_title` for multi-series. `groupby`/`orderby` drive the aggregation.
- `width` — Bootstrap-style grid columns out of 12.
- `comps` — `"<plugin>.<component>"` renders a custom component instead of a built-in chart.
- `policy` at dashboard and card level gates visibility.

---

## 6.5 Hooks & Workflow Automation

### Form lifecycle hooks

A form runs hooks at three points ([`docs/forms/main.json`](../../../Microapps-Worker-NodeJS/plugins/docs/forms/main.json)):

```json
"hooks": {
  "preload":    { "helpers": ["countries"] },
  "presubmit":  { "modules": ["bizrules"] },
  "postsubmit": { "modules": ["bizflow", "bizlogger"] }
}
```

| Phase | When | Typical module |
|---|---|---|
| `preload` | Before the form renders | `helpers` that supply option data (e.g. `countries`) |
| `presubmit` | Before the row is saved | `bizrules` — business-rule validation (reject/transform) |
| `postsubmit` | After the row is saved | `bizflow` — workflow transitions; `bizlogger` — activity/audit logging |

`bizrules` / `bizflow` / `bizlogger` are the standard hook modules: **validate → persist → react**. This is the framework's "react to events, not hardwired code" model ([§3 #4](3-design-principles.md)).

### The `_hooks` helper (code-level hooks)

For server-side code, [_hooks.js](../../api/helpers/_hooks.js) is a simple registry:

```javascript
HOOKS.register("docs.aftersave", (data) => { /* … */ });   // subscribe
HOOKS.invoke("docs.aftersave", payload);                    // fire all callbacks
HOOKS.hook_categories();                                    // list registered keys
```

### Automation backings (what these hooks call into)

| Capability | Backing | Notes |
|---|---|---|
| Notifications / messaging | [messaging.js](../../api/helpers/messaging.js) — `MESSAGING.sendTopic` / `sendMessage` / `sendEmail` / `sendAPI` | Driver-based (email, API); `dbops` emits `messaging.dispatch` on data changes to route topic messages |
| Inbound webhooks | [webhooks.js](../../api/controllers/webhooks.js) — `WEBHOOKS.receiveRequest(endpoint, ctx)` + [webhooks.service.js](../../api/services/webhooks.service.js) | Receives external calls and routes them |
| Scheduled jobs | [autojobs.js](../../api/controllers/autojobs.js) — `startJobs` / `loadJobs` / `registerNewJob` / `activateJob` | Cron-style background jobs |
| Activity/audit logging | The `logs.*` events (see [§10 Audit & Logs](../10-audit-logs.md)) | `bizlogger` / `dbops` emit `logs.activity` |
| Data-change events | [dbops.service.js](../../api/services/dbops.service.js) emits `dbops.create`, `messaging.dispatch`, `logs.activity` | Subscribe to these to automate on CRUD |

---

## 6.6 Data Processing

| Task | How |
|---|---|
| File upload / download | [uploads.js](../../api/controllers/uploads.js) — `moveUploadedFile`, `getDestinyPath`, `resolveFileObj`; forms use `module`/`widget` fields for the upload UI |
| Create / update / delete | [dbops.service.js](../../api/services/dbops.service.js) — the generic CRUD service; emits events on every operation |
| Bulk / Excel import | Parse the upload, then loop inserts through `dbops` (or `_DB` directly); emit a progress event and write outcomes to a log table |

---

## 6.7 Custom React Components

When the built-in reports/forms/dashboards aren't enough, a plugin can deliver **custom UI as React components**. Components are authored as `.jsx`, compiled on the fly, served through the `source` action, and — crucially — **reusable across plugins**: any plugin can render a component owned by another.

### Authoring

Put a React component (default export, function component) in the plugin's `component/` (or `components/`) folder. Tailwind utility classes work. Example — [`plugins/docs/component/test1.jsx`](../../../Microapps-Worker-NodeJS/plugins/docs/component/test1.jsx):

```jsx
export default function WelcomePage({ ref_id, ref_src } = {}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <h1 className="text-6xl font-bold text-gray-800">Welcome</h1>
    </div>
  );
}
```

### Compilation & delivery

The plugin's `source` action ([§4.4](../04-microapps.md#44-how-a-microapp-runtime-service-works)) compiles and serves it:

1. A request for `component/<name>.js` resolves to the `.jsx` source if present.
2. `JITCOMPILER.compileJSX` ([helpers/jitcompiler.js](../../../Microapps-Worker-NodeJS/helpers/jitcompiler.js)) transpiles it with `@swc/core` (target es2020, **React classic runtime**), **strips `import` statements**, patches destructured props to default `= {}`, and caches the compiled `.js` next to the source.
3. The compiled JS is returned to the browser:

```
GET /api/services/<plugin>/source?folder=component&file=<name>.js
```

Pass `params.recache=true` to force a recompile after editing (the action serves a freshly built `_1` variant).

### Referencing a component (including cross-plugin)

Components are addressed as **`<plugin>.<component>`**, so any plugin can consume any other plugin's component:

- **In a dashboard card** — render a component instead of a chart:
  ```json
  "card4": { "config": { "type": "comps" }, "comps": "editorInvoice.items_wise_chart", "width": 12 }
  ```
- **In a form / InfoView** — embed a component as a `widget` (or `module`) field, passing props via `config`:
  ```json
  "activity": {
    "type": "widget",
    "src": "bizlogger.logs",          // <plugin>.<component>
    "vmode": "view",
    "width": 12,
    "config": { "ref_id": "#refid#", "ref_src": "profile" }
  }
  ```

Real cross-plugin references in the shipped plugins include `accounts.ledger`, `docman.docs`, `emails.inbox`, `payroll.history`, `notesBoard.notes`, and `bizlogger.logs` — each a component owned by one plugin and embedded by another. This is the UI-layer counterpart to the cluster-wide action reuse in [§4.5](../04-microapps.md#45-cluster-wide-reuse): server logic is shared via `_call`, UI is shared via `comps`/`widget`.

### Props & data

Values under a `widget`/`module` `config` (and session placeholders like `#refid#`, `#SESS_*#`) are passed to the component as props — so a component receives the row/context it should render. For its own data a component calls plugin actions over the API (e.g. `GET /api/services/<plugin>/<route>`), exactly like any other client code.

### Authoring caveats

- **No `import`s** — import lines are stripped at compile time. `React` and host globals are provided by the runtime; don't rely on ESM imports or bundler-only features.
- **Always accept a props object** — props are patched to default `= {}`, so a component rendered without props must not crash. Read inputs from the props passed via `config`.
- **Classic JSX runtime** — `React` must be in scope (provided by the host); there is no automatic JSX runtime.
- **Caching** — the compiled `.js` is written beside the `.jsx`; use `recache=true` to rebuild after changes, otherwise the cached build is served.

---

## Gaps to confirm with the platform team

These are real features named in the plan but **not fully derivable from this repo** — confirm the authoritative details before relying on the notes above:

1. **`automator`** and **`notificationMatrix`** (the Advanced Setup modules in [§9 Common Modules](../09-common-modules.md)) — their configuration model and trigger/condition/action schema are UI-driven and not in this codebase.
2. The **complete** field-type / formatter / filter-type catalogues live in the **frontend runtime**; the tables above cover only what the sampled plugins use.
3. The exact **Excel-import** utility (parsing, validation, preview) referenced in Phase 5 — there is no dedicated importer in this repo; document the chosen approach once decided.
