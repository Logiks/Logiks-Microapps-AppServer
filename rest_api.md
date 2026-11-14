# REST API list and access plan

Generated 2026-11-14 from the `rest` definitions in `api/services/**/*.service.js` (129 endpoints).

**Where things stand.** No action declares `meta.scopes`, so once a caller is logged in (user, API key, TL token or S2S token) the gateway lets them call every endpoint below. The only role check is the `admin.` prefix. The "Proposed access" column is my suggestion for what each one should require. Change any cell you disagree with and I will turn the list into scope declarations.

**Access levels used**

| Level | Meaning |
|---|---|
| Public | No login. By design (login, health, webhooks). |
| Public, limited | Reachable with a TL token. Only the actions listed in `token_access.tl`. |
| Any user | Any logged-in user of the tenant. Data must be filtered by tenant inside the action. |
| Scope: ... | Needs a named scope or RBAC policy, for example one per form or per agent. |
| Tenant admin | Admin role inside one tenant. |
| Platform admin | Cluster operators only. This should be a separate privilege from tenant admin (see S-09). |
| Whitelist | Controlled by a config whitelist. |
| Remove | Dev or test only; take the route out of production. |

**Not in this list.** These are routes, not service actions, and have the same gap:

| Route | Today | Proposed access |
|---|---|---|
| `/fabric/*` | Login required (unless `fabric.login_required` is `false`); no per-section scope | Scope per proxy section |
| `/mcp` | Login required; system tools need admin role | Platform admin for system tools |
| `/api/events/:eventId` | Single-use ticket from `sse.ticket` | Keep |
| `/pages/*` | Public | Public |

Actions without a `rest` block (for example `system.helpers`, `system.controllers`, `auth.verifyAccessToken`) are not on the web, but `POST /api/requests/:service/:action` could reach them. That endpoint is now controlled by `request_whitelist`.

## admin

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| GET | `/api/admin` | admin.adminList | - | Platform admin | Cluster and tenant administration. |
| GET | `/api/admin/buildPolicy` | admin.buildPolicy | - | Platform admin | Cluster and tenant administration. |

## admin.apps

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| POST | `/api/admin/apps{/:task}{/:appid}` | admin.apps.apps | - | Platform admin |  |

## admin.ctrls

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| POST | `/api/admin/ctrls{/:task}{/:refid}` | admin.ctrls.ctrls | - | Platform admin |  |

## admin.files

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| POST | `/api/admin/files` | admin.files.files | path, appid | Platform admin |  |
| POST | `/api/admin/files/content` | admin.files.filesPreview | file, appid | Platform admin |  |
| POST | `/api/admin/files/upload` | admin.files.filesUpload | file, content, appid | Platform admin |  |

## admin.media

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| POST | `/api/admin/media` | admin.media.listMedia | path | Platform admin |  |
| GET | `/api/admin/media/preview` | admin.media.previewMedia | path | Platform admin |  |
| POST | `/api/admin/media/upload` | admin.media.uploadMedia | path | Platform admin |  |
| POST | `/api/admin/media/delete` | admin.media.deleteMedia | path | Platform admin |  |

## admin.nodes

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| GET | `/api/admin/nodes` | admin.nodes.listNodes | - | Platform admin | Can restart nodes. |
| GET | `/api/admin/nodes/info/:nodeId` | admin.nodes.nodeInfo | nodeId | Platform admin | Can restart nodes. |
| GET | `/api/admin/nodes/services` | admin.nodes.services | - | Platform admin | Can restart nodes. |
| GET | `/api/admin/nodes/cmd` | admin.nodes.cmd | cmd, nodeId | Platform admin | Can restart nodes. |

## admin.plugins

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| GET | `/api/admin/plugins` | admin.plugins.listNodes | more | Platform admin |  |
| GET | `/api/admin/plugins/info/:plugin` | admin.plugins.nodeInfo | plugin | Platform admin |  |

## agents

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| GET | `/ai/personas` | agents.listPersonas | - | Scope: AI agents | Per agent permission. |
| POST | `/ai/personas/:personaCode` | agents.upsertPersona | - | Scope: AI agents | Per agent permission. |
| DELETE | `/ai/personas/:personaCode` | agents.removePersona | - | Scope: AI agents | Per agent permission. |
| GET | `/ai/agents` | agents.listAgents | - | Scope: AI agents | Per agent permission. |
| POST | `/ai/agents/:agentCode` | agents.upsertAgent | - | Scope: AI agents | Per agent permission. |
| DELETE | `/ai/agents/:agentCode` | agents.removeAgent | - | Scope: AI agents | Per agent permission. |
| POST | `/ai/agents/:agentCode/run` | agents.runAgent | - | Scope: AI agents | Per agent permission. |
| GET | `/ai/sessions/:sessId` | agents.sessionHistory | - | Scope: AI agents | Per agent permission. |

## knowledge

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| GET | `/ai/knowledge` | knowledge.list | - | Scope: AI knowledge | Per knowledge base permission. |
| GET | `/ai/knowledge/:knowledgeCode` | knowledge.get | - | Scope: AI knowledge | Per knowledge base permission. |
| POST | `/ai/knowledge/:knowledgeCode` | knowledge.upsert | - | Scope: AI knowledge | Per knowledge base permission. |
| DELETE | `/ai/knowledge/:knowledgeCode` | knowledge.remove | - | Scope: AI knowledge | Per knowledge base permission. |
| POST | `/ai/knowledge/:knowledgeCode/search` | knowledge.search | query | Scope: AI knowledge | Per knowledge base permission. |
| POST | `/ai/knowledge/:knowledgeCode/documents` | knowledge.ingest | docId, text | Scope: AI knowledge | Per knowledge base permission. |
| POST | `/ai/knowledge/:knowledgeCode/documents/batch` | knowledge.ingestBatch | documents | Scope: AI knowledge | Per knowledge base permission. |
| POST | `/ai/knowledge/:knowledgeCode/documents/file` | knowledge.ingestFile | file | Scope: AI knowledge | Per knowledge base permission. |
| GET | `/ai/knowledge/:knowledgeCode/documents` | knowledge.listDocuments | - | Scope: AI knowledge | Per knowledge base permission. |
| GET | `/ai/knowledge/:knowledgeCode/documents/:docId` | knowledge.getDocument | - | Scope: AI knowledge | Per knowledge base permission. |
| POST | `/ai/knowledge/:knowledgeCode/documents/delete` | knowledge.removeDocuments | docIds | Scope: AI knowledge | Per knowledge base permission. |
| POST | `/ai/knowledge/:knowledgeCode/sync` | knowledge.sync | - | Scope: AI knowledge | Per knowledge base permission. |
| GET | `/ai/knowledge/:knowledgeCode/health` | knowledge.health | - | Scope: AI knowledge | Per knowledge base permission. |
| GET | `/ai/tooling/health` | knowledge.toolingHealth | - | Scope: AI knowledge | Per knowledge base permission. |

## tasks

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| GET | `/ai/tasks` | tasks.listTasks | - | Scope: AI tasks |  |
| GET | `/ai/tasks/:taskId` | tasks.getTask | - | Scope: AI tasks |  |
| POST | `/ai/tasks` | tasks.createTask | - | Scope: AI tasks |  |
| POST | `/ai/tasks/:taskId/cancel` | tasks.cancelTask | - | Scope: AI tasks |  |

## application

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| GET | `/api` | application.fetch | - | Any user |  |
| POST | `/api/settings` | application.settings | module | Any user |  |
| POST | `/api/feature_flags` | application.feature_flags | module | Any user |  |
| POST | `/api/settings/save` | application.settings_save | module, module_name, setting_name, setting_value | Any user | Own settings. |
| GET | `/api/layout{/:layoutid}` | application.layout | - | Public, limited | Also used with a TL token for the first page. |
| GET | `/api/theme/:themeid` | application.theme | - | Public, limited |  |
| GET | `/api/theme/:themeid/media/:filename` | application.media | - | Public, limited |  |
| GET | `/api/navigator{/:navid}{/:deviceType}` | application.navigator | - | Any user |  |
| GET | `/api/page/:pageid` | application.page | - | Any user |  |
| GET | `/api/component/:compid` | application.component | - | Any user | Path is now confined to the app folder. |
| GET | `/api/template/:templatecode` | application.template | - | Any user | Renders a stored template with caller data. |
| GET | `/api/appvers` | application.appVers | packageid | Public, limited |  |
| POST | `/api/ling` | application.ling | lang, fetch | Public, limited |  |

## auth

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| POST | `/auth/tltoken` | auth.tltoken | geolocation | Public, limited | Mints a TL token. The token itself is limited by token_access.tl (S-03). |
| POST | `/auth/s2stoken` | auth.s2stoken | appid, appkey, deviceid, deviceType, geolocation | Public, app key | Needs a valid S2S app key plus IP check. Token limited by token_access.s2s. |
| POST | `/auth/generateToken` | auth.generateToken | encrypt, user | Remove | Mints a token for any user object. Dev only; remove from production builds. |
| GET | `/auth/applink/:hashid` | auth.applink | - | Any user | Magic link redirect; needs a logged-in user. |
| POST | `/auth/authlink` | auth.authlink | loginId, geolocation | Public | Starts federated login. |
| GET | `/auth/federated-login/:uuid` | auth.federatedLoginGet | - | Public | SAML / SSO return. Response signature, issuer, audience and state are checked. |
| POST | `/auth/federated-login{/:uuid}` | auth.federatedLoginPost | - | Public | SAML / SSO return. Response signature, issuer, audience and state are checked. |
| POST | `/auth/fedtoken` | auth.doTokenLogin | retoken, deviceid, deviceType, geolocation | Public | One-time retoken exchange. |
| POST | `/auth/login` | auth.login | username, password, deviceid, deviceType, geolocation | Public | Rate limited; needs account lockout (S-13). |
| POST | `/auth/verify-otp` | auth.verifyOtp | identifier, otp, deviceType, geolocation | Public | Attempts are limited per identifier. |
| POST | `/auth/refresh` | auth.refresh | refreshToken, deviceType, geolocation | Public | Needs a valid refresh token. |
| POST | `/auth/logout` | auth.logout | refreshToken, accessToken | Any user |  |
| POST | `/auth/logout-all` | auth.logoutAll | - | Any user |  |

## data

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| GET | `/api/data` | data.listGroups | - | Any user |  |
| GET | `/api/data/:groupid` | data.fetch | - | Any user |  |
| POST | `/api/data/fetch` | data.fetchFiltered | groupid, filter | Any user |  |
| POST | `/api/data/bulk` | data.fetchBulk | groupids | Any user |  |

## dbops

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| GET | `/api/dbops` | dbops.start | - | Any user |  |
| POST | `/api/dbops/save` | dbops.save | operation, source, fields | Remove | Dev only; stores a form definition from the request. |
| POST | `/api/dbops/create` | dbops.create | refid, fields, datahash | Scope: per form | Needs RBAC policy per form / table. |
| POST | `/api/dbops/bulk` | dbops.bulk | refid, fields, datahash | Scope: per form |  |
| POST | `/api/dbops/fetch` | dbops.fetchSingle | refid, datahash | Scope: per form |  |
| POST | `/api/dbops/update` | dbops.update | refid, fields, datahash | Scope: per form |  |
| POST | `/api/dbops/delete` | dbops.delete | refid, filter, datahash | Scope: per form |  |
| POST | `/api/dbops/approve` | dbops.workflowApprove | refid, filter, datahash | Scope: per workflow |  |
| POST | `/api/dbops/reject` | dbops.workflowReject | refid, filter, datahash | Scope: per workflow |  |
| POST | `/api/dbops/validate` | dbops.workflowValidate | refid, filter, datahash | Scope: per workflow |  |

## developers

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| GET | `/api/developers/routes.json` | developers.listRoutesJSON | allAPI, allServices, search | Tenant admin | Route map. Needs a developer-only gate. |
| GET | `/api/developers/routes` | developers.listRoutes | allAPI, allServices, search | Tenant admin |  |
| GET | `/api/developers/routes/:name` | developers.fetchRoute | name | Tenant admin |  |

## developers.swagger

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| GET | `/api/developers/swagger/openapi.json` | developers.swagger.spec | - | Tenant admin | In the noauth sample, so currently public. |

## files

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| GET | `/api/files` | files.files | folder, searchTerm | Any user | Tenant filtered. |
| GET | `/api/fileTree` | files.fileTree | folder | Tenant admin | Lists files of any folder; needs a tenant filter. |
| GET | `/api/files/preview{/:fileid}` | files.filesPreview | - | Any user | The uri form reads any path under uploads; needs a tenant check. |
| POST | `/api/files/upload` | files.upload | - | Any user |  |
| POST | `/api/files/uploadbulk` | files.uploadBulk | - | Any user |  |
| POST | `/api/files/trash` | files.trash | filters | Any user | Own tenant. |
| POST | `/api/files/delete` | files.delete | fileId | Any user | Own tenant (now filtered by guid). |
| DELETE | `/api/files/purge` | files.purge | - | Tenant admin | Permanently deletes trashed files. |

## me

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| GET | `/api/me` | me.myInfo | - | Any user | Own data only. |
| GET | `/api/scopes` | me.myScope | - | Any user | Own data only. |
| POST | `/api/me/updatepass` | me.passwordUpdate | oldPassword, newPassword, passwordType | Any user | Checks the current password. |
| POST | `/api/me/reloadPolicies` | me.reloadPolicies | - | Any user | Reloads the caller's own policy cache. |

## modules

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| GET | `/api/modules/:module{/:item}{/:operation}{/:refid}` | modules.fetchModule | - | Any user | Name is validated; asks the plugin worker. |
| GET | `/api/modules/:module/component{/:item}` | modules.fetchComponent | - | Any user |  |
| POST | `/api/requests/:moduleId{/:actionId}` | modules.fetchService | - | Whitelist | Now limited by request_whitelist.actions (S-01). |
| GET | `/api/ui/:module{/:asset1}{/:asset2}` | modules.fetchUI | - | Whitelist | Calls <service>.www on a worker; add to the whitelist or restrict to known plugins. |

## public

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| GET | `/api/ping` | public.ping | - | Public |  |
| GET | `/health` | public.health | - | Public |  |
| GET | `/api/public/files/:fileUri` | public.file | fileUri | Public, link key | Anyone with the published link; relies on the link id being unguessable. |

## query

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| POST | `/api/query` | query.query | query | Remove | Free-form query builder. Already refused in production; remove the route. |
| POST | `/api/query/raw` | query.queryRaw | query | Remove | Shows compiled SQL. Dev only. |
| POST | `/api/query/view` | query.viewQuery | queryid, filter | Remove | Dev only. |
| POST | `/api/query/save` | query.storeQuery | query, srcid | Remove | Dev only. |
| POST | `/api/query/run` | query.runQuery | queryid, filter | Scope: per query | Runs a stored query; needs a per-query permission. |

## sse

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| POST | `/api/sse/ticket` | sse.ticket | - | Any user |  |

## system

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| POST | `/api/system/system/switch-color` | system.switchActiveColor | color | Platform admin | Moves cluster traffic between blue and green. |

## tenant

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| POST | `/api/tenant` | tenant.fetch | guid | Any user | Own tenant. |

## test

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| POST | `/api/test` | test.test1 | - | Remove | Untracked local test.service.js; do not ship. |
| POST | `/api/test/t2` | test.test2 | - | Remove |  |
| POST | `/api/test/t3` | test.test3 | pluginid, module, file | Remove |  |

## userstates

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| POST | `/api/userstates` | userstates.fetch | module | Any user |  |
| POST | `/api/userstates/save` | userstates.save | module, state | Any user |  |
| POST | `/api/userstates/reset` | userstates.reset | module | Any user |  |

## utils

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| GET | `/api/domrules/:ruleId` | utils.getDOMRule | - | Any user |  |
| POST | `/api/rules/:ruleId` | utils.runRule | fields | Scope: rules | Runs a stored business rule with caller facts. |
| POST | `/api/validate/:ruleId` | utils.runValidation | fields | Any user |  |
| POST | `/api/log` | utils.logActivity | logId, payload | Any user | Needs a size limit. |
| GET | `/api/ctrlcenter/:module{/:ctrlId}` | utils.ctrlcenterGet | - | Any user | Frontend controls for the caller's tenant. |
| GET | `/api/cacheMap` | utils.listCacheKey | - | Platform admin | Lists every cache key for every tenant. |
| GET | `/api/cacheMap/clear{/:cacheId}` | utils.clearCache | - | Platform admin | State-changing GET; clears cache maps. |

## webhooks

| Method | URL | Action | Params | Proposed access | Notes |
|---|---|---|---|---|---|
| POST | `/webhooks/:webhookid` | webhooks.runWebhook | - | Public, webhook key | Should require a key on every webhook. |
| GET | `/webhooks/:webhookid` | webhooks.runWebhook1 | - | Public, webhook key | Same as above. |

## Count by proposed access

| Level | Endpoints |
|---|---|
| Any user | 37 |
| Scope | 36 |
| Platform admin | 20 |
| Remove | 9 |
| Public | 9 |
| Public, limited | 6 |
| Tenant admin | 6 |
| Whitelist | 2 |
| Public, webhook key | 2 |
| Public, app key | 1 |
| Public, link key | 1 |
