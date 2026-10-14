# ShastraStack Engine: Self-Healing API Integration Under Runtime Schema Drift

ShastraStack sits between your application and a downstream API. You register a
tool once with a stable **client contract**; when the downstream API changes
its fields at runtime, the engine detects the drift from real error evidence,
proposes a small structured adapter patch, retries **once**, and commits the
patch only if the retry verifies. Anything ambiguous fails loudly instead of
guessing. Every attempt is persisted to PostgreSQL with full traces and metrics.

Three independently runnable projects, JavaScript only, no CSS frameworks:

| Service | Directory | Port | URL |
|---|---|---|---|
| ShastraStack engine | `ShastraStack` | 4000 | http://localhost:4000 |
| Application backend (judging API) | `Application/backend` | 3000 | http://localhost:3000 |
| Application frontend (judging console) | `Application/frontend` | 5173 | http://localhost:5173 |
| Mock API backend (drift simulator) | `Mock-LLM-Server/backend` | 5000 | http://localhost:5000 |
| Mock API Studio frontend | `Mock-LLM-Server/frontend` | 5174 | http://localhost:5174 |
| PostgreSQL 16 (Docker) | `docker-compose.yml` | 5432 | `localhost:5432` |
| RabbitMQ + management UI (Docker) | `docker-compose.yml` | 5672 / 15672 | http://localhost:15672 |

Engine health: `GET /health` (and `/ready`) on each backend. All ports and
service URLs are read from environment variables — no host or port is
hardcoded in source (only `.env.example` defaults).

Step-by-step UI checklists for both frontends live in [`docs/`](docs/) —
every button and field, with exact inputs and expected results.

## 1. Prerequisites

- **Node.js 20+** (`node --version`) and **npm 10+** (`npm --version`)
- **Docker + Docker Compose v2** (`docker compose version`; Docker Desktop must be running)
- Five free local ports: `3000`, `4000`, `5000`, `5173`, `5174`, plus `5432`,
  `5672` (AMQP) and `15672` (management UI)

## 2. Project architecture

```text
Browser :5173 ──▶ Application backend :3000 ──▶ ShastraStack engine :4000 ──▶ Mock API :5000
(Judging Console)      (thin proxy, no DB)        (recovery + PostgreSQL)        (contract chaos)
Browser :5174 ──▶ Mock API backend :5000 (admin + simulated routes)              ▲ also :5432

Audit pipeline (async): engine ──Pino events──▶ RabbitMQ :5672 ──▶ log consumer
worker ──▶ PostgreSQL ──▶ /v1/logs dashboard. Broker outages spill to a durable
PG outbox — no audit event is silently lost.
```

- **ShastraStack**: the self-healing middleware. Owns tool registrations,
  adapter versions, execution/patch/audit persistence, metrics.
- **Application backend**: thin judging API. Proxies to engine endpoints,
  aggregates the dashboard, validates input. No recovery logic, no database.
- **Application frontend**: judging console (Dashboard, API Registry, Schema
  Lab, Test & Recovery, Logs, Metrics, Settings).
- **Mock-LLM-Server**: downstream simulator. Versioned mock endpoints,
  runtime mutations, failure injection, informed/blind notification, scenarios.

```text
.
├── docker-compose.yml            # postgres:16-alpine, port 5432
├── .env.example                  # root defaults (used by compose on first start)
├── README.md                     # this file
├── Application/
│   ├── backend/                  # src/{app,server,engineClient.js,routes,middleware}, tests/
│   └── frontend/                 # src/{App,main,api,components,pages}, vite :5173
├── ShastraStack/
│   ├── src/{app,server}.js       # routes,controllers,services,recovery,db,middleware,utils
│   ├── src/logging/              # eventTypes,logEventSchema,logger,rabbitmqPublisher,outbox
│   ├── src/workers/logConsumer.js # standalone log consumer (`npm run worker`)
│   ├── migrations/               # 001_init.sql, 002_engine.sql, 003_logging.sql
│   └── tests/{engine.test.js,setup.js}
└── Mock-LLM-Server/
    ├── backend/                  # src/{app,server,store.js,routes,services,middleware}, tests/
    └── frontend/                 # Mock API Studio, vite :5174
```

## 3. Environment variables

Each service reads its own `.env` (all values configurable; shown are the
repo defaults from each `.env.example`):

| Variable | Default | Used by |
|---|---|---|
| `PORT` | `4000` / `3000` / `5000` | engine, app backend, mock backend |
| `DATABASE_URL` | `postgres://shastra:change_me_local_only@localhost:5432/shastrastack` | engine |
| `TEST_DATABASE_URL` | `…/shastrastack_test` | engine tests only (never dev data) |
| `SHASTRASTACK_URL` | `http://localhost:4000` | app backend |
| `ENGINE_TIMEOUT_MS` | `15000` | app backend |
| `APP_API_TOKEN` | *(unset = open)* | app backend: when set, `POST`/`PATCH`/`DELETE /api/*` require `x-api-token`; `GET`s stay open |
| `CORS_ORIGINS` | service-specific localhost origins | all backends |
| `MOCK_API_URL` | `http://localhost:5000` | engine, app backend |
| `ADMIN_TOKEN` | `local-dev-token` | mock backend: guards all `/api/admin/*` via `x-admin-token` (never echoed) |
| `ENGINE_BASE_URL` | `http://localhost:4000` | mock backend: used **only** for explicit informed notification |
| `VITE_APP_BACKEND_URL` | `http://localhost:3000` | app frontend (single Axios client) |
| `VITE_SHASTRASTACK_URL` | `http://localhost:4000` | app frontend (display) |
| `VITE_MOCK_API_URL` | `http://localhost:5000` | both frontends |
| `VITE_MOCK_STUDIO_URL` | `http://localhost:5174` | app frontend studio links |
| `VITE_MOCK_ADMIN_TOKEN` | *(empty)* | app frontend Schema Lab mock controls (disabled honestly when empty) |
| `VITE_ADMIN_TOKEN` | `local-dev-token` | mock studio |
| `VITE_ENGINE_BASE_URL` | `http://localhost:4000` | mock studio |
| `RABBITMQ_URL` | `amqp://shastra:change_me_local_only@localhost:5672` | engine, worker |
| `RABBITMQ_LOG_QUEUE` / `RABBITMQ_LOG_EXCHANGE` | `shastrastack.logs` | engine, worker (durable) |
| `RABBITMQ_PREFETCH` | `10` | worker consumer prefetch |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD` / `RABBITMQ_PORT` / `RABBITMQ_MANAGEMENT_PORT` | `shastra` / `change_me_local_only` / `5672` / `15672` | compose only (never in app code) |
| `LOG_TRANSPORT` | `async` (`sync` in tests) | engine: `async` = RabbitMQ + PG outbox fallback; `sync` = direct PG inserts |

> **Password trap (read this once):** `docker compose` creates the database
> user password on **first** start only. The compose default is `shastra_pw`,
> while the service `.env.example` files use `change_me_local_only`. Pick one
> path: **(a)** for a fresh setup, `cp .env.example .env` at the repo root
> *before* the first `docker compose up` so the DB is created with
> `change_me_local_only` (matches every example `DATABASE_URL`); or
> **(b)** keep the compose default and set each service `DATABASE_URL` password
> to `shastra_pw`. If the `pgdata` volume already exists with the other
> password, either match it or wipe with `docker compose down -v` (deletes data).

## 4. Setup (beginner path, in order)

```bash
# 0. Repo root. Optional but recommended on fresh machines:
cp .env.example .env        # pins POSTGRES_PASSWORD before first DB start

# 1. Start PostgreSQL and RabbitMQ:
docker compose up -d postgres rabbitmq
docker compose ps           # STATUS should become "healthy" within ~30 s
# Management UI: http://localhost:15672 (RABBITMQ_USER / RABBITMQ_PASSWORD)

# 2. Install dependencies (run once per directory):
cd ShastraStack && npm install && cd ..
cd Application/backend && npm install && cd ../..
cd Application/frontend && npm install && cd ../..
cd Mock-LLM-Server/backend && npm install && cd ../..
cd Mock-LLM-Server/frontend && npm install && cd ../..

# 3. Per-service env files (only needed if you deviate from defaults):
cp ShastraStack/.env.example ShastraStack/.env
cp Application/backend/.env.example Application/backend/.env
cp Application/frontend/.env.example Application/frontend/.env
cp Mock-LLM-Server/backend/.env.example Mock-LLM-Server/backend/.env
cp Mock-LLM-Server/frontend/.env.example Mock-LLM-Server/frontend/.env

# 4. Database migrations (engine only; creates tool/execution/patch/audit/outbox tables):
cd ShastraStack && npm run migrate && cd ..

# 5. Start the three backends plus the log consumer worker
#    (separate terminals; each stops with Ctrl+C):
cd ShastraStack && npm run dev            # :4000 engine
cd ShastraStack && npm run dev:worker     # log consumer worker (no port)
cd Application/backend && npm run dev     # :3000
cd Mock-LLM-Server/backend && npm run dev # :5000

# 6. Start the two frontends (separate terminals):
cd Application/frontend && npm run dev    # :5173
cd Mock-LLM-Server/frontend && npm run dev # :5174

# 7. Sanity check (expect 200 on all three):
curl http://localhost:4000/health && echo
curl http://localhost:3000/health && echo
curl http://localhost:5000/health && echo
```

`npm start` (instead of `npm run dev`) runs the backends without file watching.
The worker has no `npm start` equivalent that also starts the engine — run
`npm run worker` (`dev:worker` for watch mode) as its own process; it restarts
independently of the Express server.
Frontend production builds: `npm run build` (+ `npm run preview` to serve).

## 4b. Async audit logging (how it works)

Execution and recovery never wait for logging, and logging never breaks
execution. Every finding is emitted once as a validated, redacted Pino JSON
event (`{eventId, eventType, timestamp, executionId?, toolId?, severity,
data}`), transported async, and persisted idempotently:

- **Event types:** `execution.started/completed/failed`,
  `execution.retry_attempted`, `schema.drift_detected`, `patch.proposed`,
  `patch.validated`, `patch.applied`, `patch.verified`, `patch.rolled_back`,
  `patch.rejected`, `recovery.completed/failed`, plus `tool.registered`,
  `tool.updated`, `tool.schema_updated`.
- **Transport:** durable exchange + durable queue (`RABBITMQ_LOG_EXCHANGE` /
  `RABBITMQ_LOG_QUEUE`), persistent messages, publisher confirms. Backpressure
  overflows to the store, never to unbounded memory (max 500 in-flight).
- **Broker down?** Events go to the durable PostgreSQL `outbox_events` table
  and are republished after reconnect (background drain every 30 s). HTTP
  responses are unaffected. If the outbox itself is unreachable, only
  error/critical events throw loudly — nothing is silently discarded.
- **Worker** (`ShastraStack/src/workers/logConsumer.js`, prefetch via
  `RABBITMQ_PREFETCH`): validates each event, inserts with parameterized SQL
  inside a transaction, acks **only after commit**. Duplicate deliveries are
  absorbed by `ON CONFLICT (event_id) DO NOTHING`. Transient DB failures retry
  up to 5 times (attempt header, no infinite loops); poison/failed events go to
  the dead-letter queue `shastrastack.logs.dlq` (durable, no TTL — inspect in
  the management UI and purge after triage).
- **Tables:** `audit_events` holds the complete redacted record (new
  `event_id UNIQUE`, `event_type`, `severity`, `occurred_at` columns);
  `executions` and `patch_history` stay synchronous query-friendly summaries;
  `patch_logs` is a view over `patch_history`. Migration `003_logging.sql` is
  additive — existing data is preserved.
- **Tests** run with `LOG_TRANSPORT=sync` (direct inserts, no broker needed);
  production uses `async`. The dashboards read the same `/v1/logs` endpoints
  either way — but note async persistence is *eventual* (usually < 1 s), while
  execution/patch summaries are immediate.

## 5. API reference

Conventions: JSON everywhere. Success bodies are resource-shaped
(`{ data, … }`, lists add `{ page, pageSize, total }`). Errors are always:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": […] } }
```

`toolId` must match `^[a-z0-9][a-z0-9-_]{0,63}$` (400 otherwise). Unknown query
parameters are rejected with 400. Unknown routes return 404 `NOT_FOUND`.

### 5.1 ShastraStack engine (`:4000`, no auth — local dev service)

| Method & path | Purpose |
|---|---|
| `GET /health` | Liveness + DB state (`{status, service, db, time}`) |
| `GET /ready` | Readiness probe (503 `DB_UNAVAILABLE` when PG is down) |
| `POST /v1/tools/register` | Register a tool (below). → 201 |
| `GET /v1/tools?page=&pageSize=` | List tools (paginated) |
| `GET /v1/tools/:toolId` | Retrieve registration incl. `adapterRules`, `version`, `downstreamVersion` |
| `PATCH /v1/tools/:toolId` | Update config/schemas; `expectedVersion` enforced (409 `VERSION_CONFLICT`) |
| `DELETE /v1/tools/:toolId` | Unregister → 204 (execution/patch history is kept) |
| `POST /v1/tools/:toolId/execute` | Execute with self-healing (below) |
| `POST /v1/tools/:toolId/schema` | **Informed** downstream-schema update (below) |
| `GET /v1/logs?toolId=&status=&page=&pageSize=` (+ `kind=audit&action=&executionId=`) | Execution or audit listing |
| `GET /v1/logs/:executionId` | Full trace: execution + audit events + patches |
| `GET /v1/patches?toolId=&status=&page=&pageSize=` | Patch history (`committed` / `rolled_back`) |
| `GET /v1/patches/:patchId` | Patch detail (operations, diagnosis, versions, error) |
| `GET /v1/metrics/summary` | Aggregate metrics (formulas in §8) |
| `GET /v1/metrics/executions?toolId=&status=&page=&pageSize=` | Per-execution rows |

**Register** (`POST /v1/tools/register`, `toolId` + `baseUrl` required):

```bash
curl -X POST http://localhost:4000/v1/tools/register \
  -H 'Content-Type: application/json' -d '{
    "toolId": "demo-customers",
    "baseUrl": "http://localhost:5000",
    "method": "POST",
    "path": "/api/customers",
    "clientSchema": {"type":"object","required":["name","email"],
      "properties":{"name":{"type":"string"},"email":{"type":"string"}}},
    "downstreamSchema": {"type":"object","required":["name","email"],
      "properties":{"name":{"type":"string"},"email":{"type":"string"}}},
    "responseSchema": {"type":"object","required":["data"],
      "properties":{"data":{"type":"object"}}},
    "timeoutMs": 8000,
    "headers": {},
    "credentialRef": null,
    "recoveryPolicy": {"maxRetries": 1, "allowAutomaticPatch": true}
  }'
# → 201 {"data":{"toolId":"demo-customers","version":1,"downstreamVersion":1,
#     "adapterRules":{"operations":[]},…}}
```

Notes: `method` ∈ `GET/POST/PUT/PATCH/DELETE`; `timeoutMs` 100–120000;
`headers` accepts static non-secret headers only — `authorization`/`cookie`
values are rejected (400) with a pointer to `credentialRef` (a reference
*name*, never the secret); `recoveryPolicy.maxRetries` ∈ {0,1};
`allowAutomaticPatch: false` disables all auto-recovery. Duplicate `toolId` →
409 `TOOL_EXISTS`.

**Execute** (`POST /v1/tools/:toolId/execute`, body
`{input?, headers?, idempotencyKey?, actor?}`):

```bash
curl -X POST http://localhost:4000/v1/tools/demo-customers/execute \
  -H 'Content-Type: application/json' -d '{
    "input": {"name":"Ada","email":"ada@ex.com"}, "idempotencyKey": "demo-1"
  }'
# success:   200 {"data":{…},"executionId":"ex_…","status":"success","durationMs":9}
# recovered: 200 {…,"status":"recovered","classification":"SCHEMA_DRIFT",
#   "recovery":{"patchId":"pt_…","operations":[{"op":"RENAME_FIELD","scope":"request",
#   "from":"email","to":"emailAddress"}],"retryCount":1,"adapterVersion":2}}
# bad input: 400 {"error":{"code":"VALIDATION_ERROR",…},"executionId":"ex_…"}
# failed:    502 {"error":{"code":"SCHEMA_DRIFT_AMBIGUOUS","message":"…"},
#   "executionId":"ex_…","classification":"…",
#   "downstreamStatus":400,"downstreamBody":{…},"retryAfterMs":null}
```

The engine wraps the downstream payload in its own `data` envelope, so
`response.data.data` is the downstream body. `idempotencyKey` (or the
`x-idempotency-key` header) is required before a non-idempotent write
(`POST/PUT/PATCH/DELETE`) is ever resent — without it the engine refuses the
blind retry and rolls back.

**Informed schema update** (`POST /v1/tools/:toolId/schema`,
`{downstreamSchema?, responseSchema?, expectedDownstreamVersion?, actor?}` —
at least one schema required; version conflict → 409):

```bash
curl -X POST http://localhost:4000/v1/tools/demo-customers/schema \
  -H 'Content-Type: application/json' -d '{
    "downstreamSchema": {"type":"object","required":["name","emailAddress"],
      "properties":{"name":{"type":"string"},"emailAddress":{"type":"string"}}},
    "expectedDownstreamVersion": 1
  }'
# → 200 {"data":{…,"downstreamVersion":2,…}}
```

**Logs / patches / metrics:**

```bash
curl 'http://localhost:4000/v1/logs?toolId=demo-customers&status=recovered&page=1&pageSize=10'
curl http://localhost:4000/v1/logs/ex_01763c535ea74293ba99dc43
curl 'http://localhost:4000/v1/patches?toolId=demo-customers&status=committed'
curl http://localhost:4000/v1/metrics/summary
# → {"data":{"totalExecutions":…,"succeeded":…,"recovered":…,"failed":…,
#     "retries":…,"byStatus":{…},"byClassification":{…},"avgDurationMs":…,
#     "mttrMs":…,"zeroTouchAdaptationRate":…,"tokenOverhead":0,"llmTokensRecovery":0}}
```

### 5.2 Application backend (`:3000`)

Thin proxy: same shapes as §5.1, forwarded untouched (engine errors keep their
exact status/body/`executionId`). Auth: none by default; when `APP_API_TOKEN`
is set, `POST`/`PATCH`/`DELETE /api/*` require `x-api-token` (GETs stay open).

| Method & path | Engine call |
|---|---|
| `GET /health`, `GET /ready` | local / `GET /health` |
| `GET /api/engine/health` | `GET /health` |
| `GET /api/dashboard` | `GET /health` + `GET /v1/metrics/summary` → `{data:{engine, metrics, at}}` (503, never invented, when engine is down) |
| `GET /api/tools?page=&pageSize=` | `GET /v1/tools` |
| `POST /api/tools` | `POST /v1/tools/register` → 201 |
| `GET / PATCH / DELETE /api/tools/:toolId` | matching `/v1/tools/:toolId` (DELETE → 204) |
| `POST /api/tools/:toolId/execute` | `POST /v1/tools/:toolId/execute` |
| `GET /api/logs?…` / `GET /api/logs/:executionId` | `GET /v1/logs…` |
| `GET /api/patches?…` / `GET /api/patches/:patchId` | `GET /v1/patches…` |
| `GET /api/metrics/summary`, `GET /api/metrics/executions?…` | matching `/v1/metrics…` |

Engine outage maps to `503 ENGINE_UNAVAILABLE`, timeouts to `504
ENGINE_TIMEOUT`. Example: replace host `4000`→`3000` and prefix paths with
`/api` in any §5.1 curl (e.g. `POST http://localhost:3000/api/tools`).

### 5.3 Mock API backend (`:5000`)

Admin routes require header `x-admin-token: <ADMIN_TOKEN>` (default
`local-dev-token`); without it → 401 `ADMIN_UNAUTHORIZED`. Simulated business
routes are public and live at each endpoint's configured `method` + `path`
(exact match only; `/api/admin/*` and unsafe paths can never be simulated).
Validation failures return 400 `REQUEST_VALIDATION_FAILED` naming the fields
plus structured `details`.

| Method & path | Purpose |
|---|---|
| `GET /health` | Liveness (public) |
| `GET /api/admin/endpoints` | List mock endpoints |
| `POST /api/admin/endpoints` | Create `{endpointId, method, path, requestSchema, responseSchema, responseStatus?, responseBody?, requiredHeaders?}` → 201 (path must be under `/api/`; schemas must be object Schemas) |
| `GET /api/admin/endpoints/:id` | Endpoint config |
| `PATCH /api/admin/endpoints/:id` | Edit (`expectedVersion` checked → 409 on conflict) |
| `DELETE /api/admin/endpoints/:id` | Delete → 204 |
| `GET /api/admin/endpoints/:id/schema` | Active + baseline request/response schemas and versions |
| `POST /api/admin/endpoints/:id/mutations` | Apply `{op, …args, appliedBy?, notify?}` → 201 `{mutation, schemaVersion, notification}` |
| `POST /api/admin/endpoints/:id/reset` | Restore baseline (also clears failure injection) |
| `PUT /api/admin/endpoints/:id/response` | Configure `{responseStatus?, responseBody?}` (`$body.a.b` / `$header.name` templating) |
| `PUT /api/admin/endpoints/:id/failure` | Inject `{mode: off\|auth\|ratelimit\|timeout\|server, …}` |
| `GET /api/admin/scenarios` | List presets |
| `POST /api/admin/scenarios/:id/apply` | Reset-to-baseline + apply preset `{endpointId?, notify?}` (deterministic) |
| `GET /api/admin/activity?limit=` | Recent mock requests + admin events |
| `GET /api/admin/mutations?endpointId=&limit=` | Mutation history (actor, versions, timestamps) |
| `GET /api/admin/ops` | Supported ops + failure modes |
| `POST /api/chat`, `GET /api/schema`, `GET /api/scenarios` | Legacy deterministic demo (kept for compatibility) |

```bash
T=local-dev-token
# blind rename on the seeded customers endpoint (no notify ⇒ engine must detect):
curl -X POST http://localhost:5000/api/admin/endpoints/customers/mutations \
  -H "x-admin-token: $T" -H 'Content-Type: application/json' -d '{
    "op": "RENAME_FIELD", "scope": "request", "from": "email", "to": "emailAddress"
  }'
# → 201 {"data":{"mutation":{…,"prevVersion":1,"newVersion":2,…},
#     "notification":{"notified":false,"mode":"blind"}}}
# informed variant: add "notify": {"toolId": "demo-customers"}
#   → mock POSTs active schemas to the engine schema API, returns notified:true
```

Seeded example: `POST /api/customers` with `{name, email}` → `201
{data:{id, name, email}}`.

## 6. How recovery works (and its limits)

**Pipeline per execution:** validate caller input vs `clientSchema` (400, downstream
untouched) → apply committed adapter rules in memory → validate against known
`downstreamSchema` → send via Axios with per-tool timeout → validate 2xx bodies
vs `responseSchema` → on drift evidence, classify → diagnose → propose ops →
validate proposal + dry-run → **retry at most once** → commit only on verified
success, else roll back (adapter untouched, `rolled_back` row).

**Informed vs blind mode.** *Informed*: a judge explicitly supplies the new
contract — mock `notify: {toolId}` or engine `POST /v1/tools/:toolId/schema`
(downstream version bump, no adapter change). *Blind*: the mock mutates
silently; the engine must detect drift from 400/422 evidence or response
mismatches. Blind mode never notifies — a `notified:false` receipt proves it.

**Supported mutation ops** (mock) and engine counterparts: `RENAME_FIELD`,
`MOVE_FIELD`, `CONVERT_TYPE`, `ADD_REQUIRED_FIELD`, `ADD_HEADER`,
`CHANGE_RESPONSE_SCHEMA` (mock-side; engine adapts responses via
request/response-scoped rename/move/convert). Engine patch ops are limited to
`RENAME_FIELD`, `MOVE_FIELD`, `CONVERT_TYPE`, `ADD_HEADER` — header values only
from registration, never invented.

**Retry limits:** `maxRetries` ∈ {0, 1}; exactly one in-memory retry ever.
Non-idempotent resends require an idempotency key (body `idempotencyKey` or
`x-idempotency-key` header) or a configured `duplicateProtectionMechanism`;
`GET` is always safe. Response-side adaptation resends nothing.

**Rollback:** failed verification records `rolled_back` with the reason and
leaves the adapter version unchanged — verified live (version identical before
and after).

**Failure behavior (never patched as drift):** 401/403 (`AUTH_ERROR`, no
credentials invented, zero patches), 404, 409, 429 (honors `Retry-After`,
returns `retryAfterMs`), 5xx, timeouts, network errors. Ambiguous or
multi-difference drift → 502 + truthful reason, no guessing.

**Limits of automatic recovery (verified, by design):** flat→nested blind moves
are indistinguishable from renames without an LLM, so only the flatten
direction auto-recovers (the other fails truthfully); combined simultaneous
request+response drift may exhaust the single retry; a retry whose response
stops matching the registered contract is rolled back; recovery needs an
idempotency key for writes.

## 7. Judge demo script (copy-paste, ~5 minutes)

Assumes §4 running. The seeded mock endpoint is `POST /api/customers`
(`{name, email}` → `{data:{id, name, email}}`).

```bash
# 0. Normal execution: register + run (expect success)
curl -X POST http://localhost:3000/api/tools -H 'Content-Type: application/json' -d '{
  "toolId":"demo-customers","baseUrl":"http://localhost:5000","method":"POST",
  "path":"/api/customers",
  "clientSchema":{"type":"object","required":["name","email"],
    "properties":{"name":{"type":"string"},"email":{"type":"string"}}},
  "downstreamSchema":{"type":"object","required":["name","email"],
    "properties":{"name":{"type":"string"},"email":{"type":"string"}}},
  "responseSchema":{"type":"object","required":["data"],
    "properties":{"data":{"type":"object"}}},
  "timeoutMs":8000,"recoveryPolicy":{"maxRetries":1,"allowAutomaticPatch":true}}'
curl -X POST http://localhost:3000/api/tools/demo-customers/execute \
  -H 'Content-Type: application/json' \
  -d '{"input":{"name":"Ada","email":"ada@ex.com"},"idempotencyKey":"demo-1"}'
# → 200 "status":"success"

# 1. Runtime mutation (blind): downstream renames email → emailAddress.
#    Keep the canned response coherent (explicit judge action):
T=local-dev-token
curl -X POST http://localhost:5000/api/admin/endpoints/customers/mutations \
  -H "x-admin-token: $T" -H 'Content-Type: application/json' \
  -d '{"op":"RENAME_FIELD","scope":"request","from":"email","to":"emailAddress"}'
curl -X PUT http://localhost:5000/api/admin/endpoints/customers/response \
  -H "x-admin-token: $T" -H 'Content-Type: application/json' \
  -d '{"responseBody":{"id":"cus_demo123","name":"$body.name","email":"$body.emailAddress"}}'

# 2. Same stable client request → automatic recovery, no restart:
curl -X POST http://localhost:3000/api/tools/demo-customers/execute \
  -H 'Content-Type: application/json' \
  -d '{"input":{"name":"Ada","email":"ada@ex.com"},"idempotencyKey":"demo-2"}'
# → 200 "status":"recovered", recovery.operations=[RENAME_FIELD],
#   retryCount:1, classification SCHEMA_DRIFT. Re-run → "success" via committed adapter.

# 3. Unsupported change → safe rejection (adds required phone; no value exists anywhere):
curl -X POST http://localhost:5000/api/admin/endpoints/customers/mutations \
  -H "x-admin-token: $T" -H 'Content-Type: application/json' \
  -d '{"op":"ADD_REQUIRED_FIELD","scope":"request","field":"phone","fieldSchema":{"type":"string"}}'
curl -X POST http://localhost:3000/api/tools/demo-customers/execute \
  -H 'Content-Type: application/json' \
  -d '{"input":{"name":"Ada","email":"ada@ex.com"},"idempotencyKey":"demo-3"}'
# → 502 SCHEMA_DRIFT_AMBIGUOUS, no committed patch.

# 4. Persistent logs, patches, metrics (all from PostgreSQL):
curl 'http://localhost:3000/api/logs?toolId=demo-customers&page=1&pageSize=5'
curl http://localhost:3000/api/logs/<executionId-from-step-2>   # execution + audit + patches
curl 'http://localhost:3000/api/patches?toolId=demo-customers&status=committed'
curl http://localhost:3000/api/metrics/summary

# 5. Baseline comparison (direct mock call, bypassing the engine):
curl -X POST http://localhost:5000/api/admin/endpoints/customers/reset \
  -H "x-admin-token: $T" -H 'Content-Type: application/json' -d '{}'
curl -X POST http://localhost:5000/api/customers \
  -H 'Content-Type: application/json' -d '{"name":"Ada","email":"ada@ex.com"}'
# → 201 {"data":{…}} — compare payload with the engine's data.data from step 0/2.
#    (Engine wraps downstream payloads in its own data envelope by contract.)

# 6. Tidy up (history rows stay as the audit trail):
curl -X DELETE http://localhost:3000/api/tools/demo-customers  # → 204
```

The same flow is clickable in the UIs: judging console http://localhost:5173
(Test & Recovery, Logs, Metrics) and Mock API Studio http://localhost:5174
(Mutation Lab, scenarios, reset).

## 8. Metrics: formulas, observations vs targets

All aggregates are computed live from the `executions` table — no sampling, no
fixtures. `tokenOverhead` and `llmTokensRecovery` are sums of stored columns
populated only from real provider usage metadata, so deterministic (LLM-free)
recovery reports **0**.

| Metric | Formula (code-verified) | Type |
|---|---|---|
| `totalExecutions` | `COUNT(*)` of executions | **observed** |
| `succeeded` / `recovered` / `failed` | `COUNT(*) FILTER (WHERE status=…)` | **observed** |
| `retries` | `SUM(retry_count)` | **observed** |
| `byStatus`, `byClassification` | `GROUP BY` counts | **observed** |
| `zeroTouchAdaptationRate` | `100 × recovered(status) ÷ drift cases`, where drift cases = classifications `SCHEMA_DRIFT` + `SCHEMA_DRIFT_UNRECOVERED` + `SCHEMA_DRIFT_AMBIGUOUS` (0 when denominator is 0) | **observed** |
| `mttrMs` | `AVG(duration_ms)` over `status='recovered'` rows (0 when none) | **observed** |
| `avgDurationMs` | `AVG(duration_ms)` over all executions | **observed** |
| `tokenOverhead` | `SUM(token_overhead)` | **observed** (0 = deterministic) |
| Adaptation ≥ 80 %, MTTR ≤ 2 s, 0-token overhead | shown on the Metrics page | **targets, not measurements** — labeled as targets, never mixed with live values |

## 9. Security & integrity notes (all verified live)

- Secrets: request/response bodies are deep-redacted before persistence
  (`password`, `token`, `secret`, `apiKey`, `authorization`, … → `[redacted]`);
  traces audited to contain zero secret occurrences. Registration refuses to
  persist `authorization`/`cookie` header values (400 + `credentialRef` hint).
- Unsafe retries: `POST` without an idempotency key is never blindly resent
  (verified: `SCHEMA_DRIFT_UNRECOVERED` + rollback).
- Admin surface: mock `/api/admin/*` returns 401 without `x-admin-token`;
  the token is redacted from logs and never echoed in bodies.
- SQL: every user value is a `$n` parameter (audited `query(` call sites);
  dynamic `WHERE` clauses use only static fragments. Malformed schemas are
  rejected with 400 on both engine and mock sides.
- Tests run against an isolated `shastrastack_test` database; the harness
  refuses to run against (or truncate) anything without `test` in its URL.

## 10. Tests

```bash
cd ShastraStack && npm test                 # 34 passed — recovery, rollback, limits,
                                            # persistence + logging pipeline (envelope,
                                            # outbox fallback, consumer idempotency/DLQ)
cd Application/backend && npm test          # 23 passed — proxy shapes, allowlists, outage honesty
cd Mock-LLM-Server/backend && npm test      # 15 passed — CRUD, mutations, scenarios, failures, notify
cd Application/frontend && npm run build    # production bundle must compile
```

Integration status: full end-to-end verified across all five services plus
PostgreSQL (register → success → blind rename → committed recovery →
convert/move/header/response drift → ambiguous/auth/rollback/retry-limit →
restart persistence → PG-backed logs → baseline equivalence → metrics≡SQL),
plus the RabbitMQ pipeline (publish → consume → persist, broker-outage outbox
with zero loss and post-reconnect drain, poison-message DLQ routing).
Remaining work is out of scope, not broken: flat→nested blind moves fail
truthfully (see §6), frontends have no unit suites (verified via build + live
wiring instead).
