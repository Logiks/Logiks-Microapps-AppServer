# Basic Rules to Work in the Framework

As enterprise applications evolve over time, the ability to maintain, troubleshoot, and enhance them efficiently becomes just as important as building them. Well-structured and maintainable systems reduce technical debt, improve team productivity, and make future enhancements safer and faster. Developers must therefore follow established maintainability principles such as consistent naming conventions, organized folder structures, reusable utilities, clear documentation, and uniform coding standards. Equally important is adopting a robust error-handling philosophy, ensuring that applications can gracefully handle user mistakes, system failures, API issues, and unexpected conditions through proper logging, retry mechanisms, and structured exception management. Together, these practices form the foundation of reliable, scalable, and sustainable enterprise software.

# Maintainability Philosophy

Most important in long-term enterprise systems.

## Must Learn

### Naming conventions

These mirror how the framework actually loads and registers things — follow them or the runtime will resolve names you did not intend (see [§4 MicroApp / Plugin](../04-microapps.md)).

- **Plugin (folder) names** — lowercase, no spaces or special characters (e.g. `demo`, `billing`). The folder name *is* the pluginID, and the loader registers the service under a lowercased name regardless, so always author it lowercase.
- **Fixed plugin files** — `logiks.json`, `api.js`, and `routes.json` use exactly those lowercase names; the loader looks them up by name.
- **JS source files** (helpers, controllers, `api.js` modules) — camelCase, no spaces or special characters (e.g. `cacheMap.js`, `dbMigrator.js`, `ruleEngine.js`).
- **Functions, variables, and methods** — camelCase, no spaces or special characters.
- **Global helpers and controllers** — autoloaded as `UPPER_CASE` globals; primary/native ones are prefixed with `_` (e.g. `_DB`, `_CACHE`, `_ENV`).
- **API endpoints / route paths** — lowercase, no spaces or special characters (e.g. `/invoices`, `/create`). A route is exposed at `/api/services/<plugin><path>`.
- **Database, table, and column names** — lowercase, no spaces or special characters. Namespace a plugin's own tables with its pluginID (`<plugin>_invoices`) to avoid collisions in shared databases.

### Folder structure
- The plugin folder structure must be followed strictly (manifest at the root, `api.js`, `routes.json`, `dbschema/`, `www/`, and the UI folders), otherwise the loader cannot bind the plugin's services, routes, and assets. See [§4.2 Anatomy of a Plugin Folder](../04-microapps.md#42-anatomy-of-a-plugin-folder).

### Code consistency
- Naming Standards – Use uniform naming conventions for variables, functions, classes, APIs, database objects, and configuration files.
- Coding Style – Follow agreed formatting rules, indentation, spacing, line lengths, and code structure.
- Design Patterns – Apply common architectural and implementation patterns consistently throughout the system.
- Error Handling – Use standardized approaches for validation, exception handling, logging, and user feedback.
- API Responses – Maintain consistent request and response structures across all services.
- File Organization – Follow a predefined folder and module structure for easy navigation.
- Documentation Standards – Ensure comments, code documentation, and technical specifications follow common guidelines.
- Reusable Components – Prefer shared utilities and common libraries over duplicate implementations.

### Documentation
- Functional Documentation – Document business objectives, workflows, user journeys, and expected system behavior.
- Technical Documentation – Maintain architecture diagrams, module interactions, database schemas, and integration details.
- API Documentation – Clearly define endpoints, request/response formats, authentication methods, and error codes.
- Business Rules Documentation – Record validations, calculations, approval processes, and decision logic.
- Configuration Documentation – Document environment variables, application settings, feature flags, and deployment configurations.
- Deployment Documentation – Maintain installation, deployment, upgrade, rollback, and recovery procedures.
- Operational Documentation – Provide monitoring, troubleshooting, backup, maintenance, and support guidelines.
- Change Documentation – Record release notes, breaking changes, migrations, and major architectural decisions.
- Knowledge Transfer Documentation – Ensure sufficient information exists for new developers to understand and maintain the system.
- Documentation Maintenance – Keep documentation synchronized with system changes and treat it as part of the development lifecycle.

### Reusable utilities
- Common Functionality – Extract frequently used logic into shared utilities instead of duplicating code across modules.
- Single Source of Truth – Maintain one implementation for common operations such as validation, formatting, calculations, and data transformations.
- Modularity – Design utilities to be independent, focused, and reusable across different applications and modules.
- Standardization – Use common utility libraries for logging, error handling, API communication, authentication, and configuration management.
- Configurability – Build utilities that can be adapted through parameters or configuration rather than requiring code modifications.
- Encapsulation – Hide implementation details and expose clear, well-defined interfaces for consumers.
- Documentation – Clearly document utility purpose, inputs, outputs, dependencies, and usage examples.
- Testing – Ensure reusable utilities are thoroughly tested since defects can impact multiple parts of the system.
- Versioning – Manage changes carefully to maintain backward compatibility for dependent modules.
- Dependency Management – Minimize unnecessary dependencies and avoid creating tightly coupled utility libraries.

### Error Handling Philosophy
Enterprise systems must fail gracefully.

- User Errors – Validate inputs early and provide clear, actionable messages that help users correct mistakes without exposing technical details.
- System Errors – Handle unexpected failures gracefully, prevent application crashes, and ensure system stability under adverse conditions.
- API Failures – Anticipate network issues, timeouts, invalid responses, and service unavailability with appropriate fallback mechanisms.
- Retry Logic – Implement controlled retries for transient failures while preventing duplicate processing and unintended side effects.
- Logging – Record meaningful events, warnings, and errors with sufficient context to support monitoring, auditing, troubleshooting, and root-cause analysis.
- Exception Management – Use standardized exception handling patterns and avoid unhandled errors propagating to end users.
- Error Classification – Differentiate between validation errors, business rule violations, system failures, and integration issues for appropriate handling.
- User Feedback – Present user-friendly error messages while capturing detailed technical information in logs.
- Recovery Mechanisms – Design systems to recover from failures through retries, rollbacks, compensation actions, or manual intervention processes.
- Observability – Ensure errors, performance issues, and critical events are visible through logs, metrics, alerts, and monitoring systems.
