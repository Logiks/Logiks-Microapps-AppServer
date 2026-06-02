# 7. Helpers and Controllers

> Audience: **app developers** and **platform engineers**. A function-level reference for the helpers and controllers that are callable from other worker nodes.

Every file in [api/helpers/](../api/helpers/) and [api/controllers/](../api/controllers/) is autoloaded as an `UPPER_CASE` global on each node ([§3.4](03-framework-fundamentals.md#34-controllers--helpers-reference)). Two surfaces are reachable across the cluster:

- **Helpers** — all of them are reachable through the `system.helpers` action.
- **Controllers** — only those whose `initialize()` returns `true` are reachable through `system.controllers`. This chapter documents those nine (plus `AICORE`, which is public only when AI is enabled).

`initialize()` is the boot hook on every module and is not listed below.

---

## 7.1 Calling these from another node

Call the global directly; no import:

```javascript
const rows = await _DB.db_selectQ("appdb", "lgks_users", "*", { active: "true" }, {});
const ok   = await RBAC.checkPolicy(ctx, "billing.allow.access");
```

Or go through the system service. On a Worker the convenience globals wrap it:

```javascript
await _helper("_DB.db_selectQ", "appdb", "lgks_users", "*", { active: "true" }, {});   // → system.helpers
await _controller("RBAC.checkPolicy", "billing.allow.access");                          // → system.controllers
// or directly:
await ctx.call("system.helpers",     { cmd: "_DB.db_selectQ", params: [ … ] });
await ctx.call("system.controllers", { cmd: "USERS.getUserInfo", params: ["guid-123"] });
```

List what's available at runtime: `system.helpers { cmd: "list_helpers" }` and `system.controllers { cmd: "list_controllers" }`.

> **The trailing `ctx`** in many signatures is supplied by the receiving node — when calling cross-node you pass only the leading parameters. Controller methods are reachable cross-node **only** if the controller is cluster-public (listed in §7.3).

---

## 7.2 Helpers

### `_DB` — database access ([_db.js](../api/helpers/_db.js))

- **`db_connection(dbkey)`** — get the connection/pool for a database key (`"appdb"`, `"logdb"`).
- **`db_now()`** — current DB datetime string. **`db_nowunix()`** — current unix timestamp.
- **`db_clean(value)`** — escape a value for SQL. **`db_clean_key(value)`** — escape an identifier (table/column).
- **`db_query(dbkey, sql, params)`** — run a parameterised raw SQL query.
- **`db_findOne(dbkey, table, columns, where, orderBy="id DESC", flatObj=false)`** — fetch a single row.
- **`db_selectQ(dbkey, table, columns, where, whereParams, additionalQueryParams)`** — build and run a SELECT.
- **`db_insertQ1(dbkey, table, data)`** — insert one row from an object; returns the insert id.
- **`db_insert_batchQ(dbkey, table, data)`** — bulk-insert an array of rows.
- **`db_updateQ(dbkey, table, data, where)`** — update rows matching `where`.
- **`db_deleteQ(dbkey, table, where)`** — delete rows matching `where`.

### `_DBLOGGER` — DB log writer ([_dbLogger.js](../api/helpers/_dbLogger.js))

- **`_log(logID, payload, ctx)`** — write `payload` to table `log_<logID>`, but only if that table exists and `logID` is allow-listed; otherwise it silently returns `false` (see [§11.5](11-audit-logs.md#115-frontend-logs--the-_dblogger-helper)).

### `_HOOKS` — in-process hook registry ([_hooks.js](../api/helpers/_hooks.js))

- **`register(hook_key, callback)`** — subscribe a callback to a hook key.
- **`invoke(hook_key, dataParams)`** — fire all callbacks registered for a hook key.
- **`hook_categories()`** — list the registered hook keys.

### `CACHEMAP` — per-user cache ([cacheMap.js](../api/helpers/cacheMap.js))

- **`get(mapKey, dataKey, defaultValue=false, ctx)`** — read a user-scoped cached value (Redis), returning the default if absent.
- **`set(mapKey, dataKey, dataValue, ctx)`** — write a user-scoped cached value.

### `DATAMODELS` — model binding for JSON components ([dataModels.js](../api/helpers/dataModels.js))

- **`getModel(table)`** — load the data model (column definitions / binding) for a table.
- **`checkHook(tables, operation, dbkey="app", param="")`** — check/run model hooks for an operation.
- **`prepareField(table, field, data)`** — transform a field value before persistence.
- **`processField(table, field, data)`** — transform a field value after load.
- **`prepareData(table, singleRecord)`** — prepare a full record for persistence.
- **`processData(singleRecord)`** — post-process a loaded record.
- **`processQuery(table, sql)`** — adjust a SQL query according to the model.

### `DBMIGRATOR` — schema migration ([dbMigrator.js](../api/helpers/dbMigrator.js))

- **`pluginMigration(pluginID, schemaFile)`** — run a plugin's schema migration ([§4.7](04-microapps.md#47-per-plugin-db-migration)).
- **`startMigration(dbkey)`** — run migration for a database (per `MIGRATION_MODE`).
- **`getMigrationFile(dbkey)`** — locate the schema file for a database.
- **`saveMigrationScript(dbkey)`** — write the generated migration SQL to disk.
- **`exportSchema(dbKey, writeFile=true, tablePrefix=false)`** — dump the live DB schema to JSON.
- **`generateMigration(dbKey, newSchemaFile, writeFile=false, inputSchemaIsFile=true)`** — diff schemas and produce ALTER statements.
- **`applyMigration(dbKey, filename)`** — apply a migration file. **`applyMigrationSchema(dbKey, sql)`** — apply raw migration SQL.

### `DBOPS` — stored DB operations ([dbOps.js](../api/helpers/dbOps.js))

- **`storeDBOpsQuery(jsonQuery, fields, operation, forcefill, userInfo, params, hooks, ctx)`** — register a stored, parameterised DB operation definition.
- **`getDBOpsQuery(dbOpsID, userInfo, ctx)`** — fetch a stored DB operation by id.
- **`saveFormObject(dbops, formObj, userInfo, ctx)`** — persist a form submission through a stored operation.

### `ENCRYPTER` — crypto ([encrypter.js](../api/helpers/encrypter.js))

- **`encrypt(text, encryptionKey)`** / **`decrypt(encryptedText, encryptionKey)`** — AES-256-GCM encrypt/decrypt.
- **`generateHash(content, pwdSalt=false)`** — hash a value (e.g. a password).
- **`compareHash(password, passwordHash, pwdSalt=false)`** — verify a value against a hash.

### `FILES` — file storage ([files.js](../api/helpers/files.js))

- **`saveFile(ctx, folder, content)`** — store a file.
- **`getFileInfo(guid, fileId)`** — file metadata. **`searchFile(guid, searchTerm)`** — search a tenant's files.
- **`getFileById(guid, fileId, responseType="stream", moreData=false)`** — fetch a file by id.
- **`getFileByPath(guid, fileUri, responseType="stream")`** — fetch a file by path.
- **`publishFile(guid, fileId, expiresOn, ctx)`** — create a public/published link.
- **`getFilePublished(fileURI, responseType="stream", moreData=false)`** — fetch a published file.

### `JSONPROCESSOR` — JSON UI component processing ([jsonProcessor.js](../api/helpers/jsonProcessor.js))

- **`processJSONComponent(jsonObj, objId, moduleId, ctx)`** — process a JSON UI component (policy filtering + query binding).
- **`processFormFields(formFields, ctx, objId, moduleId)`** — process a form's field definitions.
- **`generateSelector(fieldObj, fieldKey, ctx)`** — build a dropdown/selector's options.

### `MESSAGING` — outbound messaging ([messaging.js](../api/helpers/messaging.js))

- **`loadDrivers()`** — load messaging vendor drivers from `sys_vendors`. **`getDrivers()`** — list loaded drivers. **`getParams(driverId)`** — a driver's config.
- **`sendTopic(topic, params, ctx)`** — dispatch a message by topic (the notification-matrix path).
- **`sendMessage(driver, params, ctx)`** — send through a named driver. **`sendMessageByEvent(driver, params, ctx)`** — send via an event-mapped driver.
- **`sendEmail(driverConfig, driverId, params, ctx)`** — send email via an SMTP driver. **`sendAPI(driverConfig, driverId, params, ctx)`** — send via an API driver (SMS/WhatsApp/webhook).

### `MISC` — utilities ([misc.js](../api/helpers/misc.js))

- **`generateDefaultDBRecord(ctx, forUpdate=false)`** — the default audit columns (`guid`, `created_on/by`, `edited_on/by`).
- **`processUpdateQueryFromBody(ctx, tableName, whereCond, extraFields="edited_on=?")`** — build an UPDATE from the request body.
- **`getClientIP(req)`** — client IP. **`getIpBlock(ip)`** — IP block/subnet. **`isHTTPS(ctx)`** — whether the request is HTTPS.
- **`generateUUID(prefix, n)`** — a UUID with optional prefix/length. **`timeStamp()`** — current timestamp.
- **`slugify(text)`** — URL-safe slug. **`toTitle(str)`** — Title Case. **`urlify(jsonObject)`** — object → query string.
- **`executeFunctionByName(functionName, dataParams, ctx)`** — invoke a function by dotted name (`CONTROLLER.method`).
- **`geoDistanceMeters(g1, g2)`** — distance in metres between two geopoints.
- **`getAdditionalParams(dataObj)`** — extract paging/extra params. **`getDebugInfo(ctx, req, res)`** — assemble request debug info. **`getEnv()`** — environment info.
- **`_replace(text, data, strict=true)`** — substitute `{placeholders}` from a data object. **`_replaceCtx(text, ctx, strict=true)`** — substitute session placeholders (`#SESS_*#`). **`_replaceObj(jsonObj, ctx, strict=false)`** — substitute placeholders throughout an object.

### `QUERY` — dynamic & saved queries ([query.js](../api/helpers/query.js))

- **`parseQuery(sqlObj, filter={}, metaInfo={})`** — build executable SQL from a query object plus filters.
- **`saveQuery(sqlObj, params, ctx, dbkey='*', module='general', title='Query', category='-')`** — persist a saved query. **`storeQuery(queryObj, userObj, queryID=false, params, ctx)`** — store/update a query definition.
- **`getSavedQuery(queryId, ctx, more=false)`** / **`getQueryByID(queryID, userObj, ctx)`** — fetch a saved query.
- **`updateWhereFromEnv(whereObj, metaInfo)`** — inject env/session values into a where clause.

### `RULEENGINE` — business rules ([ruleEngine.js](../api/helpers/ruleEngine.js))

- **`processRule(ruleID, dataFields, addonFacts)`** — evaluate a `json-rules-engine` rule against facts.
- **`listRules(filter)`** — list defined rules.

### `TEMPLATES` — template rendering ([templates.js](../api/helpers/templates.js))

- **`loadTemplate(templateCode, data, ctx)`** — load and render a stored template by code.
- **`process(template, sqlSource, data={}, params={}, ctx)`** — render a template against data and an optional SQL source.

### `UNIQUEID` — id generation ([uniqueid.js](../api/helpers/uniqueid.js))

- **`generate(size)`** — a secure unique id. **`generateAsync(size)`** — the async variant.
- **`customAlphabet(alphabet, size)`** — an id generator over a custom alphabet.
- **`generateNonSecure(size)`** — a fast, non-secure id.

### `VALIDATIONS` — input validation ([validations.js](../api/helpers/validations.js))

- **`validateRule(formData, ruleObj)`** — validate data against a rule object; returns `{ status, errors }`.
- **`processRule(ruleID, dataFields)`** — validate data against a stored rule. **`listRules(filter)`** — list validation rules.

### `URLSHORTNER` — short URLs ([urlShortner.js](../api/helpers/urlShortner.js))

- **`urlShorten(srcURL, category, callback)`** — create a short URL for a source URL.

### `WORKERS` — worker/thread pool ([workers.js](../api/helpers/workers.js))

- **`loadWorker(workerName)`** / **`unloadWorker(workerName)`** / **`restartWorker(workerName)`** — manage a worker.
- **`enqueueJob(workerName, payload)`** — queue a job to a worker. **`broadcast(payload)`** — send to all workers.
- **`listWorkers()`** — list loaded workers. **`autoload()`** — autoload configured workers.

### Helpers with no cluster-callable methods

- **`DBHELPERS`** ([dbHelpers.js](../api/helpers/dbHelpers.js)) exposes no methods on the global; it registers **in-process globals** `createDBInsertFromRequest(ctx, input_fields, db_table, msgTitle, callback)`, `createDBUpdateFromRequest(ctx, input_fields, db_table, whereLogic, msgTitle, callback)`, and `createDBDeleteFromRequest(ctx, db_table, whereLogic, msgTitle, callback)` — request-to-CRUD helpers usable only on the local node.
- **`DEBUGGER`** ([debugger.js](../api/helpers/debugger.js)) — `isRemoteDebugger()`, `startRemoteDebugger()`, `stopRemoteDebugger()`; dev-time only.

---

## 7.3 Cluster-public controllers

These have `initialize()` returning `true`, so they're reachable via `system.controllers`.

### `RBAC` — access control ([rbac.js](../api/controllers/rbac.js))

- **`checkPolicy(ctx, policyStr, defaultValue=false)`** — evaluate a policy key for the current user.
- **`checkScope(ctx, scopeStr, defaultValue=false)`** — evaluate a scope.
- **`getRoleId(ctx)`** — the current user's role id. **`buildPolicyTable(ctx)`** — build the effective policy table.
- **`registerPolicies(appid, guid, policyObj, ctx)`** — register policy definitions. **`reloadPolicies(ctx)`** — reload the policy set.
- **`processJSONComponent(ctx, jsonObject)`** — filter a JSON component by policy.

### `USERS` — user management ([users.js](../api/controllers/users.js))

- **`getUserInfo(userid, where={}, more=false, callback)`** — fetch a user's profile. **`listUsers(whereCond, callback)`** — list users.
- **`verifyUser(userid, password, appId)`** — verify credentials. **`updateUserPassword(guid, userid, password)`** — set a new password.
- **`findOrCreateFederatedUser(federatedData, federatedSource)`** — get or create a user from SSO data.
- **`getUserData(sessionId, ctx)`** — session-bound user data. **`getUserAvatar(avatar, avatar_type)`** — resolve an avatar.
- **`hasMFA(guid, userid)`** — whether MFA is enabled. **`generateMFASecret(guid, userid, mfaType=false)`** — create an MFA secret.
- **`generateTOTPCode(guid, userid, userInfo, remoteIP, deviceType, geolocation)`** — issue a TOTP/OTP code. **`valiateOTPCode(otpIdentifier, otpCode)`** — validate an OTP code.

### `ENV` — environment variables ([env.js](../api/controllers/env.js))

- **`getEnvVariable(ctx, varName, defaultValue=null)`** — read one variable. **`getEnvModule(ctx, moduleName)`** — a module's variables. **`fetchEnvByNature(ctx, nature)`** — variables by nature (`backend`/`frontend`). **`fetchEnvInfo(metaInfo)`** — assemble env for a request.
- **`registerEnvVariable(ctx, module, varName, varValue, varParams={}, varNature='backend')`** — create a variable.
- **`updateEnvVariable(ctx, varCode, varValue, varParams={}, varNature='backend', varPrivilege='admin')`** — update one. **`deleteEnvVariable(ctx, varCode)`** — delete one.
- **`importEnvVariables(ctx, module, envList)`** — bulk import. **`loadEnvironment()`** / **`reloadEnvironment()`** — (re)load from `lgks_environment`.

### `SETTINGS` — persistent settings ([settings.js](../api/controllers/settings.js))

- **`getUserSettings(guid, userId, setting_key, defaultValue=null)`** — read a user/app/global setting.
- **`registerUserSettings(guid, userId, setting_key, setting_value, category="general")`** — write a setting.

### `NAVIGATOR` — navigation menus ([navigator.js](../api/controllers/navigator.js))

- **`getNavigation(appID, navID, deviceType, userInfo, filter, ctx)`** — build a navigation menu filtered by user/device.
- **`addNavigation(appID, navID, menuItems)`** — add menu items. **`importNavigtaion(appID, menuArray)`** — bulk-import navigation.

### `GEOFENCES` — spatial fences ([geofences.js](../api/controllers/geofences.js))

- **`findGeofence(guid, geolocation, groupid='general', fenceType="polygon", limit=10, max_distance=1, geoTable="lgks_geofences")`** — find the fence(s) containing a point.
- **`listGeofences(guid, geolocation, groupid='general', limit=10, geoTable="lgks_geofences")`** — list nearby fences.

### `AUTHFEDERATED` — federated SSO ([authFederated.js](../api/controllers/authFederated.js))

- **`getEngines()`** — list SSO engines. **`listFederatedLogins(appId)`** / **`getFederatedLogin(appId, federatedLoginID)`** — configured logins.
- **`getFederatedLoginEndpoint(appid, federatedLoginID, ctx)`** — build the SSO login/redirect endpoint.
- **`verifyFederatedLoginResponse(appid, federatedLoginID, ctx)`** — verify an SSO callback. **`processFederatedLoginResponse(appid, federatedLoginID, ctx)`** — turn a verified response into a session/user.
- **`resolveTenantByFederation(appId, federatedLoginID, ssoSource)`** — map an SSO login to a tenant.

### `APIBOX` — stored API definitions ([apibox.js](../api/controllers/apibox.js))

- **`runAPI(apiCode, params={}, ctx=null)`** — execute a stored API-box definition by code.

### `SINGLETONMANAGER` — cluster-singleton election ([singletonmanager.js](../api/controllers/singletonmanager.js))

- **`initiateSingleton(activityName, funcToStart, funcOnEnd, options={})`** — run a task as a cluster-wide singleton (Redis lock + heartbeat); only one node runs it at a time. Returns a `Singleton` instance whose lifecycle methods (`tryAcquire`, `startHeartbeat`, `check`, `release`, `stop`) are managed internally.
- **`listRunning()`** — list singleton activities running on this node.

### `AICORE` — AI layer (conditionally public)

`AICORE` ([aicore.js](../api/controllers/aicore.js)) is cluster-public **only when AI is enabled** and an engine resolves. Its primary method is `sendMessage(message, sessId, moduleId, params, ctx)`. See [§9 AI Layer](09-ai-layer.md) for the full surface and current status.

---

> This chapter lists the **in-cluster method API**. For the **HTTP** surface (route groups, auth, the OpenAPI spec and explorer), see [§6 Core Services & APIs](06-core-services-and-apis.md).

> **Next:** [§8 Event System](08-event-system.md) — the platform's eventing model, well-known topics, and distributed messaging patterns.
