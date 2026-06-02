# 10. Common Modules

> Audience: **app developers**. These are the ready-made modules the framework ships in the **Setup MicroApp**. Knowing them is not optional — reusing them is how you avoid rebuilding user management, dropdowns, settings, menus, vendors, scheduling, webhooks, and notifications by hand.

Each module is an **admin UI** (configured in the Setup MicroApp) backed by an AppServer **controller/helper** (autoloaded as an `UPPER_CASE` global, see [§3](03-framework-fundamentals.md)) and one or more **`appdb` tables**. You *configure* these through the admin UI and *consume* the result from your plugin — e.g. a `datalists` entry becomes a form dropdown, a `menuManager` entry becomes navigation, a `vendorManager` entry becomes a messaging driver.

---

## 10.1 Security

| Module | Purpose | Backing | Table(s) |
|---|---|---|---|
| `userManager` | User / access management | [users.js](../api/controllers/users.js) (`USERS`), [me.service.js](../api/services/me.service.js), [auth.service.js](../api/services/auth.service.js) | `lgks_users`, `user_settings`, `lgks_mfa` |
| `userGroups` | User teams / group management | `USERS` | `lgks_users_group` |
| `userRoles` | Roles & permissions for RBAC | [rbac.js](../api/controllers/rbac.js) (`RBAC`) | `lgks_roles`, `lgks_rolemodel`, `lgks_privileges`, `lgks_access`, `lgks_scopes` |
| `deviceManager` | Device identification & locking (optional) | auth/MFA flow | `lgks_mfa`, `lgks_security_iplist` |
| `bizStaff` | User → company-staff mapping for permission control | Profile/business plugin (admin-driven) | plugin tables |

RBAC is the enforcement layer behind all of these — a plugin declares access keys in its `logiks.json` `policies` map ([§4](04-microapps.md)), and `RBAC` checks them against the roles/privileges configured here.

---

## 10.2 Masters

| Module | Purpose | Backing | Table(s) |
|---|---|---|---|
| `datalists` | Master dropdown manager — controls **every** dropdown in the system | data/lists layer | `do_lists` |

This is the source for form `dataSelector` fields: a field's `groupid` names a list managed here ([§6.3 Forms](training/6-building-blocks.md#63-forms)). Define a dropdown once in `datalists` and reuse it across every form/report.

---

## 10.3 Setup

| Module | Purpose | Backing | Table(s) |
|---|---|---|---|
| `environment` | Environment variables across the system (DB queries, ctx, AI, …) | [env.js](../api/controllers/env.js) (`ENV`) | `lgks_environment` |
| `ctrlCenter` | Control parameters — manages endpoints and runtime parameters | [settings.js](../api/controllers/settings.js); `ctrlcenter` actions in [utils.service.js](../api/services/utils.service.js) | `lgks_ctrlcenter` |
| `sysSettings` | System-wide settings (portal shutdown, etc.) | `SETTINGS` ([settings.js](../api/controllers/settings.js)) | `sys_settings`, `lgks_settings` |
| `keyManager` | Primary secret management — controls keys generated across the system | [keyManager.js](../api/controllers/keyManager.js) (`KEYMANAGER`) | `lgks_apikeys` |
| `vendorManager` | Vendor management by class (messaging, payment gateway, email, …) | [vendors.js](../api/controllers/vendors.js) (`VENDORS`) | `sys_vendors` |
| `topbars` | Landing card/group top-bar menu management | navigation layer | `do_topbars` |
| `menuManager` | Navigation controls for the whole system, grouped by `menuid` | [navigator.js](../api/controllers/navigator.js) (`NAVIGATOR`) | plugin `menus/` + `do_topbars` |

`vendorManager` is what the [`MESSAGING`](../api/helpers/messaging.js) helper reads to build its drivers (email/SMS/API/payment) — you configure a vendor here, then send through it without touching credentials in code. `menuManager`/`NAVIGATOR` filters navigation per user privilege, complementing the `navigation` block in a plugin's `logiks.json`.

---

## 10.4 Advanced

| Module | Purpose | Backing | Table(s) |
|---|---|---|---|
| `automator` | Scheduled or triggered jobs that drive automation across modules | [autojobs.js](../api/controllers/autojobs.js) (`AUTOJOBS`) | `lgks_autojobs`, `sys_workflows` |
| `Templates` | Printable documents / PDF generation | [templates.js](../api/helpers/templates.js) (`TEMPLATES`) | `do_templates` |
| `MsgTemplates` | SMS / WhatsApp message templates | `MESSAGING` + templates | `do_templates`, `sys_notifications` |
| `ManageWebhooks` | Inbound API calls — callbacks/webhooks with auth & whitelisting | [webhooks.js](../api/controllers/webhooks.js) (`WEBHOOKS`) + [webhooks.service.js](../api/services/webhooks.service.js) | `sys_webhooks`, `lgks_security_iplist` |
| `NotificationMatrix` | Sends SMS/WhatsApp/email on triggers; lets users edit the messages | `MESSAGING` ([messaging.js](../api/helpers/messaging.js)) | `sys_notifications` |

These are the automation backbone documented in [§6.5 Hooks & Workflow Automation](training/6-building-blocks.md#65-hooks--workflow-automation): `automator` runs scheduled/triggered jobs, `NotificationMatrix` + `MsgTemplates` + `vendorManager` deliver the messages, and `ManageWebhooks` receives inbound calls. Form `postsubmit` hooks (`bizflow`) typically fire these.

---

## How developers consume these

You rarely call these modules directly — you **configure** them and the framework wires them in:

| You want to… | Use the module | It shows up as |
|---|---|---|
| Add a dropdown to a form | `datalists` | a `dataSelector` `groupid` ([§6.3](training/6-building-blocks.md#63-forms)) |
| Add a menu/landing card | `menuManager` / `topbars` | navigation filtered by privilege |
| Restrict who can do what | `userRoles` + `logiks.json` `policies` | `RBAC` checks ([§4](04-microapps.md)) |
| Send an email/SMS on an event | `vendorManager` + `NotificationMatrix` | a `MESSAGING` driver call |
| Run something on a schedule | `automator` | an entry in `lgks_autojobs` |
| Accept an external callback | `ManageWebhooks` | a `WEBHOOKS` endpoint |
| Generate a PDF/printable | `Templates` | a `TEMPLATES` render |
| Read a config value | `environment` / `ctrlCenter` / `sysSettings` | `ENV` / `SETTINGS` globals |

> **Note on scope:** these modules' **admin UIs** live in the Setup MicroApp (a plugin, outside this repo). The **backings** above — controllers, helpers, and `appdb` tables — are in this AppServer repo and are what your plugin actually talks to. The exact admin-UI configuration screens are documented with the Setup MicroApp.
