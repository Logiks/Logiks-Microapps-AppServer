# Developer Training Plan

> **Reference:** the definition syntax for the reports, forms, dashboards, hooks and automation used in Phases 2–6 is documented in [6-building-blocks.md](6-building-blocks.md). Keep it open while doing the hands-on tasks.

## Phase 1 — Foundation & Framework Basics (Week 1)

### Objectives

* Understand framework architecture
* Learn report and form lifecycle
* Understand API-driven development flow

### Topics

1. Framework Overview
2. Module Structure
3. Report vs Form Architecture
4. API Integration Basics
5. Database Binding
6. AJAX Fundamentals
7. Event Lifecycle

### Hands-on Tasks

* Create a basic report page
* Connect report to API
* Create a simple learner form
* Submit data using framework API

### Deliverables

* Working CRUD module
* Basic API integration
* Simple searchable report

---

# Phase 2 — Report Development Mastery (Week 2)

### Objectives

* Build dynamic reports
* Implement advanced report operations

### Topics Covered

* Search
* Sorting
* Filters
* Toolbar customization
* Sidebar integration
* Report types
* Aggregate functions
* Custom formatters
* Script execution
* Custom API actions
* Alert/Confirm/Prompt handling

### Hands-on Tasks

1. Create employee report
2. Add:

   * Search
   * Sort
   * Multi-filter
   * Aggregate totals
3. Create:

   * Button-triggered API calls
   * Custom formatter
   * Dynamic script execution

### Mini Project

Build:

> “Training Analytics Report”

Including:

* totals
* grouped reports
* action buttons
* dynamic UI behavior

---

# Phase 3 — Form Development & Dynamic Logic (Week 3)

### Objectives

* Build enterprise-level forms
* Implement conditional logic

### Topics Covered

* Text fields
* Select dropdowns
* Searchable dropdowns
* Dependent AJAX chains
* Radio-based field control
* Image/File upload
* Geolocation fields
* API-driven dropdowns
* Validation engine
* onLoad events
* Script execution
* Session variables
* Force fill logic

### Hands-on Tasks

Build:

> “Learner Registration System”

Features:

* Contractor → Site dependent dropdown
* Dynamic enable/disable
* File uploads
* Geolocation capture
* Form validations
* Pre-filled session data

### Practical Exercises

* Create custom validations
* Create form onLoad scripts
* Add dynamic dropdown API calls

---

# Phase 4 — Actions, Hooks & Workflow Automation (Week 4)

### Objectives

* Learn backend workflow execution
* Implement lifecycle hooks

### Topics Covered

* Action buttons
* InfoView types
* Edit/Delete actions
* History popup
* Pre-hooks
* Post-hooks
* Webhooks
* Notification Matrix
* Email automation
* API invocation inside hooks

### Hands-on Tasks

1. Create workflow approval form
2. Send email on status change
3. Trigger webhook after submission
4. Maintain history logs

### Mini Project

Build:

> “Approval Workflow Module”

Including:

* notifications
* history
* approval lifecycle
* automated email triggers

---

# Phase 5 — Advanced Components & Data Processing (Week 5)

### Objectives

* Build reusable custom React components
* Reuse a component across plugins
* Process external datasets

### Topics Covered

* Custom React (`.jsx`) components — authoring, default export, props
* JIT compilation & delivery via the `source` action
* Cross-plugin reuse — `comps` (dashboards) and `widget`/`module` (forms), `<plugin>.<component>`
* Component authoring caveats — no `import`s, default props, classic JSX runtime, `recache`
* Excel import
* Bulk database insert
* Data mapping
* Data preview
* Report integration

> Reference: [6-building-blocks.md §6.7 Custom React Components](6-building-blocks.md#67-custom-react-components) and §6.6 Data Processing.

### Hands-on Tasks

1. Build a custom React component (`.jsx`) in your plugin's `component/` folder and render it on a page.
2. Embed that component in a **dashboard card** (`comps`) and in a **form/InfoView** (`widget` with `config` props).
3. Reference a component owned by **another plugin** by its `<plugin>.<component>` name to prove cross-plugin reuse.
4. Build:

   > “Excel Import Utility”

   Features:

   * Upload Excel
   * Parse records
   * Validate data
   * Insert into DB
   * Show imported records

---

# Phase 6 — Advanced UI & Enterprise Features (Week 6)

### Objectives

* Build enterprise dashboards
* Create highly dynamic UI flows

### Topics Covered

* Tabs
* Complex popup forms
* Embedded report+form layouts
* Dashboard
* Charts
* QR Code generation
* Automator

### Hands-on Tasks

1. Create HSE-style popup
2. Add embedded reports
3. Build dashboard widgets
4. Generate QR codes
5. Create automation flows

### Final Project

Build:

> “Enterprise Training Management System”

Modules:

* Dashboard
* Reports
* Forms
* Notifications
* Charts
* QR Codes
* Import Utility
* Workflow automation

---

# Weekly Assessment Structure

| Week | Assessment              |
| ---- | ----------------------- |
| 1    | Basic CRUD + API        |
| 2    | Advanced Reports        |
| 3    | Dynamic Forms           |
| 4    | Workflow Automation     |
| 5    | Custom Component + Excel Import System |
| 6    | Final Enterprise Module |

---

# Recommended Daily Schedule

| Time    | Activity              |
| ------- | --------------------- |
| 1 Hour  | Concept Learning      |
| 2 Hours | Hands-on Coding       |
| 1 Hour  | Debugging & Review    |
| 30 Min  | Documentation Reading |

---

# Skill Progression Matrix

| Skill Area | Beginner     | Intermediate   | Advanced             |
| ---------- | ------------ | -------------- | -------------------- |
| Reports    | Basic list   | Filters & sort | Scripted reports     |
| Forms      | Static       | Dynamic        | Enterprise workflows |
| APIs       | CRUD         | Chained APIs   | Hook integrations    |
| Automation | Manual       | Notifications  | Full automator       |
| UI         | Simple forms | Tabs & popups  | Dashboards           |
| Components | Use existing | Author `.jsx`  | Cross-plugin reuse   |

---

# Expected Outcome After Completion

Developer should be able to:

* Independently build complete modules
* Develop enterprise-grade forms/reports
* Create workflow automations
* Integrate APIs efficiently
* Build dashboards and charts
* Handle dynamic scripting/hooks
* Author custom React components and reuse them across plugins
* Create reusable framework components
* Implement production-ready business flows

