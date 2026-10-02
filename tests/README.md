# Test framework

Two independent suites, meant for periodically revalidating the system -
run the whole thing, or just the part you're touching.

- **`tests/unit/`** - pure logic and structural checks. No DB, cache,
  transporter, or HTTP server involved. Runs anywhere, in a few seconds.
  - `misc.test.js`, `uniqueid.test.js` - pure helper functions.
  - `services-schema.test.js` - requires every `api/services/**/*.service.js`
    file directly and checks it still exports a valid Moleculer schema
    (a `name`, and action defs with a real `handler`). Cheap full-repo
    regression check - catches a broken require or malformed action before
    it would otherwise only surface as a 500 at request time.
  - `public-service.broker.test.js` - boots a bare, DB-less
    `ServiceBroker` and calls a real service's actions with `broker.call()`
    directly, skipping the HTTP gateway entirely. The pattern (see
    `helpers/brokerHarness.js`) only works for services whose code paths
    under test don't touch DB/cache - most don't, so that's the ceiling
    of this tier; anything else belongs in `tests/http`.

- **`tests/http/`** - hits a *live* AppServer instance over HTTP, the same
  way a real client would: login, bearer token, real routes. This is the
  tier that actually revalidates "does the running system work" - DB,
  cache, auth, the gateway's own routing/whitelisting, all included.
  It's a client, not a bootstrapper: point it at whatever's running
  (your local dev server by default, or a staging box) via `TEST_BASE_URL`
  rather than having it spawn a new instance.

## Running it

```sh
npm test                          # everything
npm test -- --selectProjects unit # just the DB-less tier
npm test -- --selectProjects http # just the live-HTTP tier (needs a running server)

npx jest tests/unit/misc.test.js        # a single file
npx jest -t "slugify"                   # by test name, across files
```

## Configuring the HTTP tier

The `tests/http` project needs a reachable AppServer. By default it polls
`http://localhost:${PORT}/health` (from `.env`, so your local dev server via
`npm start`); if nothing answers within 30s it fails with a clear message
instead of hanging.

To point it at something else (staging, a different port, a non-default
test account), copy `.env.test.sample` to `.env.test` and load it before
running tests, eg:

```sh
env $(grep -v '^#' .env.test | xargs) npm test -- --selectProjects http
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `TEST_BASE_URL` | `http://localhost:${PORT}` | Instance the HTTP suite targets |
| `TEST_USERNAME` | `admin` | Login used by `auth`/`me` suites |
| `TEST_PASSWORD` | `admin123` | " |

`.env.test` is gitignored - don't put real staging/prod credentials in
`.env.test.sample`.

## Writing data-touching HTTP tests

The target DB is whatever `TEST_BASE_URL` happens to be pointed at (by
default, your own dev DB) - not a disposable test schema. Any test that
creates data (a dbops row, an uploaded file, ...) must register its own
teardown with `tests/http/helpers/cleanup.js` right after creating the
resource, and call `runCleanup()` in an `afterAll`:

```js
const { registerCleanup, runCleanup } = require("./helpers/cleanup");

afterAll(runCleanup);

test("creates and cleans up a thing", async () => {
	const created = await client.post("/api/...", { ... });
	registerCleanup(() => client.post("/api/.../delete", { id: created.data.id }));
	// ...assertions...
});
```

Prefer read-only/idempotent checks (the existing suites are all read-only)
wherever a domain doesn't actually need to be exercised end-to-end.

## Adding a new domain suite

`dbops`, `admin`, `files` (upload), `tasks`, `agents` etc. aren't covered
yet - their actions need real module/table/workflow names that only you
know for this deployment, so fabricating example calls for them risked
shipping tests that silently assert the wrong thing. Follow the pattern in
`tests/http/me.test.js` (login once in `beforeAll`, assert on status +
shape) and add cleanup per the section above if the test creates anything.
