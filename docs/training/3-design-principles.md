# Design Principles

For enterprise application development, knowing only coding is not enough.
The developer also needs to understand:

* UI/UX behavior
* Business workflows
* Data architecture
* Reusability
* Scalability
* Event-driven design
* Security
* State management

These are the core design and engineering principles behind systems involving:

* Reports
* Forms
* Workflows
* Dashboards
* Automation
* Hooks
* APIs
* Enterprise CRUD systems

---

# 1. Component-Based Design Thinking

## Principle

Everything should be reusable and modular.

### Must Understand

* Reusable forms
* Reusable report configs
* Shared validation logic
* Shared APIs
* Shared UI components

### Example

Instead of:

```js
createUserForm()
createVendorForm()
```

Think:

```js
createForm(config)
```

> **In Logiks:** a plugin's `api.js` functions are registered as cluster-wide service actions (`<plugin>.<fn>`), so shared logic is written once and reused by any other plugin via `_call("<plugin>.<fn>", params)` — see [§4.4](../04-microapps.md#44-how-a-microapp-runtime-service-works).

---

# 2. Separation of Concerns (Very Important)

## Principle

UI, business logic, and data logic should remain separated.

---

## Correct Architecture

| Layer          | Responsibility |
| -------------- | -------------- |
| UI             | Rendering      |
| Service/API    | Data fetching  |
| Business Logic | Rules          |
| Database       | Storage        |

---

## Wrong Approach

Putting:

* validations
* API calls
* SQL
* UI manipulation
  inside one file.

> **In Logiks:** the plugin layout enforces this split — business logic lives in `api.js`, exposure/addressing in `routes.json`, and rendering in the UI folders (`pages/`, `forms/`, `component/`) served through the `source` action. Data access goes through the `_DB` global rather than raw SQL in the handler.

---

# 3. Configuration-Driven Development

This is critical for metadata-driven frameworks like Logiks.

## Principle

Behavior should come from metadata/config rather than hardcoded logic.

### Example

Instead of:

```js
if(role=="admin") showDelete()
```

Prefer:

```json
{
  "permissions": {
    "delete": ["admin"]
  }
}
```

> **In Logiks:** this is the native model. `logiks.json` declares `policies` and `navigation`, and `routes.json` maps a path's `data` to a controller (or returns static data) — behaviour is wired through config, not hardcoded. Menu visibility is gated by `to_check: "policy#<key>"` against the policy map.

---

# 4. Event-Driven Architecture

This training includes:

* hooks
* webhooks
* notifications
* automation
* post-submit actions

So understanding event systems is essential.

> **In Logiks:** a plugin subscribes to cluster event topics through the `events` map in `routes.json` (topic → controller), and publishes with `ctx.emit("<topic>", payload)`. Events fan out across the whole cluster by default — see [§7 Event System](../07-event-system.md).

---

## Must Know Concepts

| Event      | Trigger          |
| ---------- | ---------------- |
| onLoad     | Form opened      |
| onChange   | Field changed    |
| preSubmit  | Before save      |
| postSubmit | After save       |
| webhook    | External trigger |

---

## Key Principle

Actions should react to events, not tightly coupled code.

---

# 5. State Management Concepts

Very important for:

* forms
* dashboards
* reports
* popup systems

---

## Must Understand

* Current form state
* Dirty state
* Session variables
* Filters state
* User context
* Cache/state persistence

---

## Example

Changing Contractor:

* resets Site
* reloads API
* updates validation

This is state dependency.

---

# 6. UX Design Principles

Enterprise apps fail mostly because of bad UX.

---

## Important UX Concepts

### a) Progressive Disclosure

Show only relevant fields.

Example:

* Show accident details only if “Accident = Yes”

---

### b) Validation Feedback

Never fail silently.

Use:

* inline validation
* error summaries
* visual indicators

---

### c) Minimize User Effort

* searchable dropdowns
* autofill
* force fill
* session defaults

---

### d) Consistency

All reports/forms should behave similarly.

---

# 7. Data Flow Understanding

Must understand:

```text
UI → Validation → API → DB → Response → UI Update
```

This is critical for debugging.

---

# 8. Security Principles (Extremely Important)

Especially because training includes:

* uploads
* APIs
* hooks
* automation
* script execution

---

## Must Know

### Authentication

Who is user?

### Authorization

What can user do? In Logiks, declare access in a plugin's `logiks.json` `policies` map and gate UI/actions against those policy keys, enforced by the `RBAC` controller.

### Validation

Never trust frontend. Declare `params` on a route in `routes.json` so the runtime validates input before the controller runs.

### Sanitization

Prevent:

* XSS
* SQL injection
* script injection

### File Upload Safety

* MIME validation
* extension validation
* size limits

---

# 9. API Design Principles

Must understand proper API behavior.

---

## Good API Design

| Principle           | Example              |
| ------------------- | -------------------- |
| Consistent response | success/error format |
| Stateless           | no hidden dependency |
| Versioning          | `/api/v1/`           |
| Proper methods      | GET/POST/PUT/DELETE  |

---

# 10. Report Design Principles

Reports are not tables.

Must understand:

* filtering
* aggregation
* pagination
* exportability
* drill-down
* performance

---

## Key Principle

Reports should answer business questions quickly.

---

# 11. Form Design Principles

Enterprise forms are workflow engines.

Must understand:

* conditional visibility
* validation lifecycle
* dependency chains
* partial saves
* draft handling

---

# 12. Workflow Thinking

Very important.

Instead of:

> “What field to show?”

Think:

> “What business process is happening?”

---

## Example Workflow

```text
Draft
→ Submitted
→ Under Review
→ Approved
→ Closed
```

Each stage:

* permissions
* notifications
* validations
* actions

---

# 13. Automation Concepts

Must understand:

* triggers
* conditions
* actions
* retries
* idempotency

---

## Example

```text
IF status changes to Approved
THEN send email
AND trigger webhook
```

---

# 14. Dashboard & Visualization Principles

Must know:

* KPI thinking
* summarization
* chart readability
* actionable metrics

---

## Bad Dashboard

100 charts.

## Good Dashboard

5 actionable metrics.

---

# 15. Performance Principles

Critical for enterprise apps.

---

## Must Understand

* pagination
* lazy loading
* debouncing
* caching
* optimized API calls
* minimizing DOM updates

---

# 16. Business-Oriented Thinking (Most Important)

The developer should understand:

> “Why is the business asking for this?”

Not just:

> “How to code it?”

---

# Recommended Additional Learning Areas

| Area                     | Importance |
| ------------------------ | ---------- |
| UX Design                | High       |
| API Design               | High       |
| Security                 | Very High  |
| State Management         | High       |
| Event Systems            | Very High  |
| Workflow Design          | Very High  |
| Database Design          | High       |
| Performance Optimization | Medium     |
| Debugging                | Very High  |

---

# Ideal Engineering Mindset

The trainee should gradually evolve from:

```text
Field Developer
→ Module Developer
→ Workflow Developer
→ System Designer
→ Business Solution Engineer
```

That transition is what makes enterprise developers valuable.
