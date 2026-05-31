# Release Checklists

Three checklists for shipping the MicroApps platform safely:

1. [First-time server deployment](#1-first-time-server-deployment) — standing up a new cluster from nothing.
2. [Subsequent server release](#2-subsequent-server-release) — updating an existing AppServer.
3. [Subsequent plugin release](#3-subsequent-plugin-release) — adding or updating a plugin on a running cluster.

Work top to bottom. Anything marked **gate** must pass before you continue. Tick boxes as you go and keep the completed list with the release record.

> References: deployment in [§2 Getting Started](../02-getting-started.md), configuration in [§3 Framework Fundamentals](../03-framework-fundamentals.md), plugins in [§4 MicroApp / Plugin](../04-microapps.md), migrations in [§4.7](../04-microapps.md#47-per-plugin-db-migration), workers in [§5 Workers](../05-workers.md), logs in [§10 Audit & Logs](../10-audit-logs.md), and common failures in [§11 Troubleshooting](../11-troubleshooting.md).

---

## 1. First-Time Server Deployment

For bringing up a brand-new cluster. Allow time — this is the longest of the three.

### 1.1 Prerequisites & infrastructure

- [ ] Host(s) provisioned (Linux for production); sizing agreed (start ~2 GB RAM per node).
- [ ] Node.js installed (18 LTS minimum, 20 LTS recommended).
- [ ] **MySQL 8** reachable; two empty databases created — `appdb` and `logdb`.
- [ ] **Redis** reachable (used for cache, sessions, locks, and — if chosen — the transporter).
- [ ] **Transporter** decided and reachable: Redis (default), NATS, MQTT, or TCP.
- [ ] (If using AI) a **Qdrant** vector store reachable (Docker compose starts it under the `ai` profile).
- [ ] DNS / hostnames for the public endpoint decided.

### 1.2 Configuration & secrets

- [ ] `cp env_sample .env` and `cp config_sample.json config.json`.
- [ ] **Required env set:** `SERVER_ID` (unique), `TRANSPORTER`, `NODE_ENV` — startup aborts if these are missing.
- [ ] Other env reviewed: `PORT`/`HOST`, `NAMESPACE`, `CLUSTER_TOKEN`, `SESSION_SECRET`, `ENC_SALT`, `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX`.
- [ ] `config.json` filled in: `dbmysql.appdb` and `dbmysql.logdb`, `cache` (Redis), `cors`, `authjwt`, `mail`, `storage`, `logger`.
- [ ] **Secrets are strong and unique, and not committed to git:** `authjwt.secret`, `ENC_SALT`, `SESSION_SECRET`, `CLUSTER_TOKEN`, and all DB passwords. **(gate)**
- [ ] `CORS` tightened from the sample's permissive defaults; intended origins only.

### 1.3 Database & migrations

- [ ] Back up the (empty) databases or snapshot the instance so you have a known baseline.
- [ ] Apply the schema: run once with `MIGRATION_MODE=IMPORT node index.js` and wait for `Post Initalization Completed`, then stop. **(gate)**
- [ ] Confirm tables exist in `appdb` and `logdb`.
- [ ] If you intend to use frontend logging, create `log_activities_user` / `log_errors_frontend` — they are **not** in the shipped schema (see [§10.5](../10-audit-logs.md#105-frontend-logs--the-_dblogger-helper)).

### 1.4 Launch

Choose one path.

**Docker Compose**
- [ ] `cp .env.docker.sample .env`; set ports, DB creds, `CLUSTER_TOKEN`, `SESSION_SECRET`, `ENC_SALT`.
- [ ] `config.json` present (it is mounted at runtime, not baked into the image).
- [ ] `docker compose up -d` (add `--profile ai` for Qdrant).
- [ ] Containers report healthy; the AppServer healthcheck (`/api/public/public/ping`) passes.

**PM2 / host**
- [ ] `npm install`.
- [ ] `pm2 start ecosystem.config.js`, then `pm2 save` and `pm2 startup`.
- [ ] For multiple gateway instances, set distinct `SERVER_ID` per instance.

- [ ] A reverse proxy (nginx/HAProxy/ALB) terminates TLS and forwards to the gateway. **(gate for production)**

### 1.5 Workers & cluster

- [ ] At least one Worker started with **matching** `TRANSPORTER`, `NAMESPACE`, and `CLUSTER_TOKEN` (mismatched token is rejected).
- [ ] Worker env set: unique `NODE_ID`; `ENABLE_PLUGINS_INSTALL_DEPS` if plugins declare npm deps; `ENABLE_DBMIGRATION` if plugins ship schema.
- [ ] Worker appears in the cluster and its services are reachable.

### 1.6 Front-end applications & domains

- [ ] `applications.json` entries created for each front-end application (branding, theme, login). *(This is separate from plugins — see [§4.1](../04-microapps.md#41-what-a-microapp-is).)*
- [ ] `lgks_domains` rows bind each `domain_host` to its `appid` (unknown/blocked domains are rejected at the gateway).

### 1.7 Security hardening

- [ ] Default/sample credentials all replaced.
- [ ] CORS, Helmet, and security headers verified on responses.
- [ ] Rate limits set appropriately for the expected load.
- [ ] Webhook IP whitelists configured where inbound webhooks are used.
- [ ] RBAC roles/scopes seeded; an admin account exists and non-admins can't reach `admin.*`.
- [ ] Run [security-review](../../) on the release branch. **(gate)**

### 1.8 Verification (smoke tests)

- [ ] `curl <host>/api/public/public/ping` returns a healthy response. **(gate)**
- [ ] Login flow works end to end; a JWT is issued and accepted on `/api`.
- [ ] An authenticated `/api` call succeeds; an unauthorized one is correctly rejected.
- [ ] A plugin route (`/api/services/<plugin>/…`) responds.
- [ ] `test-api.sh` (auth + RBAC smoke test) passes.

### 1.9 Post-deployment

- [ ] **Backups** scheduled: `appdb`, `logdb`, and the `uploads/` directory.
- [ ] Log rotation confirmed (`logs/` rotates daily, 10-day retention by default).
- [ ] Metrics/monitoring wired (broker `metrics: true`; export to Prometheus/Datadog).
- [ ] Scheduled jobs running on exactly one node (`AUTOJOBS` via singleton election).
- [ ] Redis runs with persistence/replication (Sentinel or Cluster) — it is a single point of failure otherwise.
- [ ] `uploads/` on shared/persistent storage if more than one gateway replica.

### 1.10 Sign-off

- [ ] Release recorded (version, date, who, config snapshot).
- [ ] Rollback path for the next release understood (snapshot + config backup).
- [ ] Owner/on-call identified.

---

## 2. Subsequent Server Release

For updating an existing AppServer. The aim is a smooth update with minimal downtime and a clear way back.

### 2.1 Plan & version control

- [ ] Release notes / changelog drafted; version tagged in git.
- [ ] Breaking changes flagged (config keys, env vars, schema, action/event contracts).
- [ ] Release window agreed; stakeholders notified if any downtime is expected.

### 2.2 Pre-release review & staging

- [ ] Diff reviewed; run [code-review](../../) and [security-review](../../) on the release branch.
- [ ] Deployed to a **staging** cluster that mirrors production. **(gate)**
- [ ] Smoke + regression tests pass on staging (`test-api.sh`, key flows, plugin routes).
- [ ] New/changed env vars and `config.json` / `system.json` keys documented and prepared for production.

### 2.3 Backups & rollback prep

- [ ] **Database backup taken immediately before release** (`appdb` + `logdb`). **(gate)**
- [ ] Current `config.json` / `.env` backed up.
- [ ] Previous release recoverable: keep the prior Docker `IMAGE_TAG`, or the prior PM2 release/commit.
- [ ] Rollback trigger criteria written down (what failure means "roll back").

### 2.4 Schema & config compatibility

- [ ] If the schema changed: review the migration (`DBMIGRATOR` diffs the schema against the live DB). Capture the current state first with `MIGRATION_MODE=EXPORT` as a baseline. **(gate)**
- [ ] Confirm migrations are non-destructive, or that data loss is intended and backed up.
- [ ] Node version, transporter, and `NAMESPACE` unchanged (or a coordinated change planned for every node).
- [ ] Apply schema with `MIGRATION_MODE=IMPORT` against the target before/with the rollout.

### 2.5 Deploy (minimise downtime)

- [ ] Apply config/env changes to every node.
- [ ] **Docker:** roll out the new `IMAGE_TAG` (`docker compose up -d`); containers go healthy before traffic shifts.
- [ ] **PM2:** `pm2 reload ecosystem.config.js` for an instance-by-instance, zero-downtime restart of the gateway.
- [ ] Workers updated with rolling restarts; they drain on `SIGTERM` (in-flight calls finish) and re-register on reconnect.
- [ ] (Optional) Blue/green: bring up the new color (`WORKER_COLOR`), then cut over with the active-color switch once verified.

### 2.6 Verify

- [ ] Health endpoint passes on every gateway replica. **(gate)**
- [ ] Workers re-registered; service list complete.
- [ ] Smoke tests pass against production; logins and `/api` calls work.
- [ ] Logs and metrics watched for errors and latency for an agreed soak period.

### 2.7 Rollback procedure

- [ ] Re-deploy the previous `IMAGE_TAG` (Docker) or `pm2 reload` the previous release.
- [ ] Restore `config.json` / `.env` from backup if they changed.
- [ ] If a schema migration ran and is incompatible, restore the DB from the pre-release backup.
- [ ] Verify health and smoke tests on the restored version; record what happened.

### 2.8 Sign-off

- [ ] Release recorded; changelog published.
- [ ] Monitoring stable through the soak period.
- [ ] Backups from the release retained per policy.

---

## 3. Subsequent Plugin Release

For adding a new plugin or updating one on a running cluster. A plugin is a folder with a `logiks.json` in a Worker's `plugins/` directory ([§4](../04-microapps.md)); releasing one means updating that folder and reloading the Worker that hosts it.

### 3.1 Plan & versioning

- [ ] `logiks.json` `version` bumped; change documented.
- [ ] Scope clear: new plugin, or an update to an existing one.
- [ ] Identify which Worker(s) host the plugin.

### 3.2 Compatibility checks

- [ ] **pluginID (folder name) is unique** across the cluster — no clash with an existing service name. **(gate)**
- [ ] `logiks.json` `dependencies` reviewed; new npm deps will install (`ENABLE_PLUGINS_INSTALL_DEPS=true` on the Worker).
- [ ] `policies` keys don't collide with another plugin's; navigation entries are correct.
- [ ] **Action/event contracts:** if other plugins call this one's actions (`<plugin>.<fn>`) or subscribe to its events, signatures and topics are unchanged (or consumers updated in step). **(gate)**
- [ ] Routes resolve under `/api/services/<plugin>/…` without overlapping another plugin.

### 3.3 Plugin schema & data

- [ ] If the plugin owns tables: a new `dbschema/schema_*.json` is included and reviewed.
- [ ] Back up the affected database before a schema-bearing release.
- [ ] Migration applies on Worker boot when `ENABLE_DBMIGRATION=true` (`DBMIGRATOR.pluginMigration`); confirm it's non-destructive or backed up. **(gate)**

### 3.4 Staging test

- [ ] Load the plugin on a **staging** Worker and confirm it registers (no `Plugin not loaded …` in the log). **(gate)**
- [ ] Routes, `source`/`www`, events, RBAC policies, menus, and any dependent dropdowns / `datalists` all work.
- [ ] Cross-plugin calls it makes (and that other plugins make to it) still succeed.

### 3.5 Deploy / hot-plug

- [ ] Place the updated plugin folder in the target Worker's `plugins/`.
- [ ] Restart/reload that Worker so the plugin (and any `api.js` change) loads — `api.js` changes require a Worker restart.
- [ ] For zero user impact, roll one Worker at a time (others keep serving), or deploy to a spare Worker first.
- [ ] Confirm the Worker re-registers with the cluster after restart.

### 3.6 Verify

- [ ] Plugin is listed cluster-wide (`system.plugins` / the admin plugins view). **(gate)**
- [ ] Its routes respond; menus/navigation appear; access is correctly gated by policy.
- [ ] No errors in the Worker or gateway logs; event flows fire as expected.

### 3.7 Rollback

- [ ] Fast disable: rename the folder with a skipped prefix (`z_<plugin>` / `x_<plugin>`) and restart the Worker — the loader ignores it.
- [ ] Or restore the previous plugin folder version and restart.
- [ ] If a destructive migration ran, restore the database from the pre-release backup.
- [ ] Re-verify the cluster and dependent plugins.

### 3.8 Sign-off

- [ ] Plugin version and change recorded.
- [ ] Consumers of its contracts confirmed working.
- [ ] Backups retained per policy.

---

> Keep the completed checklist with each release.
