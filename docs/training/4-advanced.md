# Advanced Design Principles

To become a true framework developer — someone who can independently design enterprise solutions on Logiks MicroApps — a developer needs several higher-level concepts that are often missed in training plans.

> These principles continue the sequence from [§3 Design Principles](3-design-principles.md) (1–16); this chapter covers 17–33.

---

# 17. Domain Modeling

Before creating forms and reports, understand:

### Entities

* User
* Contractor
* Site
* Department
* Training
* Incident
* Audit

### Relationships

```text
Contractor
    |
    +--- Site
              |
              +--- Employee
                        |
                        +--- Training
```

### Skills Required

* One-to-One
* One-to-Many
* Many-to-Many
* Master-Detail relationships

Most enterprise application mistakes happen because the data model is wrong before coding starts.

---

# 18. Requirements Analysis

Before development:

### Learn to ask:

* What problem are we solving?
* Who are the users?
* What are the workflows?
* What reports are required?
* What approvals are required?
* What notifications are required?

### Example

Wrong:

> Create Training Form

Right:

> Training Request → Approval → Scheduling → Completion → Certificate Generation

This becomes a solution instead of a screen.

---

# 19. Process Mapping

Every enterprise solution should first be drawn.

Example:

```text
Create Request
      ↓
Manager Approval
      ↓
Safety Approval
      ↓
Training Scheduled
      ↓
Training Completed
      ↓
Certificate Issued
```

Before coding:

* Draw the process
* Identify actors
* Identify states
* Identify transitions

---

# 20. State Machine Thinking

Most business systems are state machines.

Example:

```text
Draft
↓
Submitted
↓
Approved
↓
Rejected
↓
Closed
```

Each state defines:

| State     | Allowed Actions |
| --------- | --------------- |
| Draft     | Edit            |
| Submitted | Review          |
| Approved  | Close           |
| Closed    | Read Only       |

This mindset is critical for workflows.

---

# 21. Role-Based Access Control (RBAC)

Training should include:

### Users

### Roles

### Permissions

Example:

| Role    | Create | Edit | Delete | Approve |
| ------- | ------ | ---- | ------ | ------- |
| User    | Yes    | Own  | No     | No      |
| Manager | Yes    | Yes  | No     | Yes     |
| Admin   | Yes    | Yes  | Yes    | Yes     |

Every form, report and API should be designed with permissions in mind.

> **In Logiks:** a plugin declares its access keys in the `logiks.json` `policies` map; these are reported to the AppServer at registration and enforced through the `RBAC` controller. Reference them from `navigation[].to_check` (`policy#<key>`) to gate menus and from handlers to gate actions.

---

# 22. Auditability

Enterprise systems require traceability.

Must understand:

### Who changed?

### What changed?

### When changed?

### Why changed?

Examples:

* History Popup
* Audit Trail
* Activity Log
* Version Tracking

---

# 23. Data Integrity Principles

Never trust user input.

Must understand:

### Required Fields

### Referential Integrity

### Duplicate Prevention

### Unique Constraints

### Transaction Safety

Example:

Do not allow:

```text
Training Record
without Employee
```

even if UI allows it.

---

# 24. Enterprise Integration Thinking

Most projects eventually integrate with:

* SAP
* Oracle
* HRMS
* ERP
* Active Directory
* Email systems
* WhatsApp
* SMS
* External APIs

Must understand:

### Inbound Integration

External system → Your system

### Outbound Integration

Your system → External system

---

# 25. Error Recovery Design

Most developers think:

```text
Success
or
Failure
```

Enterprise systems need:

```text
Success
Retry
Rollback
Manual Intervention
Escalation
```

Example:

Email sending fails.

Do not lose the notification.

Queue it.

Retry later.

---

# 26. Batch Processing Concepts

Relevant because of:

* Excel imports
* Notifications
* Automation

Must understand:

### Bulk operations

### Queues

### Background jobs

### Scheduled jobs

Example:

Importing 100,000 records should not happen in browser request.

---

# 27. Scalability Awareness

Even if current deployment is small.

Understand:

### What happens when:

* 100 users become 5,000?
* 10 records become 5 million?

Must know:

* indexing
* pagination
* caching
* query optimization

---

# 28. Observability

Developers should learn:

### Logs

### Metrics

### Monitoring

### Alerts

Example:

```text
User submits form
↓
API called
↓
Webhook fired
↓
Email sent
```

Can you trace the entire journey?

---

# 29. Configuration vs Customization

A common mistake.

Always ask:

> Can this be configured?

Before:

> Should I write custom code?

Priority:

```text
Configuration
↓
Extension
↓
Customization
↓
Core Modification (avoid)
```

This is especially important in framework-based development.

> **In Logiks:** prefer `logiks.json` / `routes.json` config first; then extend by adding `api.js` functions in your own plugin; then reuse other plugins' actions via `_call`. Avoid modifying the AppServer or Worker core — a plugin is the extension point, so capabilities can be hot-plugged without touching the runtime.

---

# 30. Product Thinking

Not every feature request is a good feature.

Must learn:

### Value vs Complexity

A simple matrix:

| Feature    | Business Value        | Development Cost |
| ---------- | --------------------- | ---------------- |
| High Value | Build                 |                  |
| Low Value  | Challenge Requirement |                  |

---

# 31. Documentation Discipline

Every module should have:

### Functional Documentation

* What it does

### Technical Documentation

* APIs
* Hooks
* Automations

### User Documentation

* How to use

A developer who documents becomes far more effective in enterprise projects.

---

# 32. Testing Mindset

The training plan currently focuses on building.

It should also include testing.

### Unit Testing

Validation logic

### Integration Testing

API interactions

### User Acceptance Testing

Business scenarios

### Regression Testing

Ensure existing functionality still works

Automated testing and AI-assisted quality assurance are increasingly part of enterprise delivery and should be built into the workflow.

---

# 33. Solution Architecture Fundamentals

By the end of training, the developer should be able to answer:

### Functional View

* What does the solution do?

### Data View

* What entities exist?

### Workflow View

* What processes exist?

### Integration View

* What systems interact?

### Security View

* Who can do what?

### Deployment View

* Where does it run?
