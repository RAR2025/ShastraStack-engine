# Application Backend — ShastraStack Judging Interface

Express backend (`:3000`) serving the judging frontend. It is a **thin client
of the ShastraStack Engine**: every `/api/*` route proxies to a real engine
endpoint through one shared Axios client. It implements **no
schema-recovery logic**, keeps **no audit-log copies**, and writes **nothing
to PostgreSQL** (there is no `pg` dependency here by design).

## Startup

```bash
cd Application/backend
cp .env.example .env
npm install
npm run dev     # or: npm start
curl http://localhost:3000/health
npm test        # mocked engine client, no live engine needed
```

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Local listen port |
| `SHASTRASTACK_URL` | `http://localhost:4000` | Engine base URL (never hardcoded) |
| `ENGINE_TIMEOUT_MS` | `15000` | Engine call timeout (clamped 1s–120s) |
| `APP_API_TOKEN` | *(unset = open)* | Optional local token; when set, `POST`/`PATCH`/`DELETE` under `/api` require `x-api-token`. `GET`s stay open |
| `CORS_ORIGINS` | `http://localhost:5173` | Allowed frontend origin(s) |
| `LOG_LEVEL` | `info` | Pino level |

Secrets and sensitive bodies (`authorization`, `password`, `token`, `secret`,
`apiKey`, …) are redacted from logs; request validation rejects unknown query
params and malformed `toolId`s locally before any engine call.

## API map (all JSON; engine shapes pass through untouched)

| App route | Engine call |
|---|---|
| `GET /health` | local (no engine call) |
| `GET /ready` | `GET /health` |
| `GET /api/engine/health` | `GET /health` |
| `GET /api/dashboard` | `GET /health` + `GET /v1/metrics/summary` → `{ data: { engine, metrics, at } }` |
| `GET /api/tools?page=&pageSize=` | `GET /v1/tools` |
| `POST /api/tools` `{toolId*, baseUrl*, method?, path?, clientSchema?, downstreamSchema?, responseSchema?, timeoutMs?, headers?, credentialRef?, recoveryPolicy?, actor?}` | `POST /v1/tools/register` → 201 |
| `GET /api/tools/:toolId` | `GET /v1/tools/:toolId` |
| `PATCH /api/tools/:toolId` `{expectedVersion?, ...fields}` | `PATCH /v1/tools/:toolId` |
| `DELETE /api/tools/:toolId` | `DELETE /v1/tools/:toolId` → 204 |
| `POST /api/tools/:toolId/execute` `{input?, headers?, idempotencyKey?, actor?}` (`x-idempotency-key` header also accepted) | `POST /v1/tools/:toolId/execute` |
| `GET /api/logs?kind=&toolId=&status=&action=&executionId=&page=&pageSize=` | `GET /v1/logs` |
| `GET /api/logs/:executionId` | `GET /v1/logs/:executionId` (execution + audit + patches) |
| `GET /api/patches?toolId=&status=&page=&pageSize=` | `GET /v1/patches` |
| `GET /api/patches/:patchId` | `GET /v1/patches/:patchId` |
| `GET /api/metrics/summary` | `GET /v1/metrics/summary` |
| `GET /api/metrics/executions?toolId=&status=&page=&pageSize=` | `GET /v1/metrics/executions` |

`*` = required. Unknown query parameters → `400 VALIDATION_ERROR`; bad
`toolId` → `400`; unknown routes → `404 NOT_FOUND`.

## Error behavior (never fabricated)

- Engine error responses (validation 400s, drift 502s with `executionId` /
  `classification`, 404s) are forwarded with their **exact status and body**.
- Engine timeout → `504 { error: { code: ENGINE_TIMEOUT } }`.
- Engine unreachable → `503 { error: { code: ENGINE_UNAVAILABLE } }`
  (dashboard included — no invented metrics).
- Local failures → `{ error: { code, message, details? } }`.

## Tests

`tests/` use `jest.mock('../src/engineClient')` (real `forward`/`forwardError`,
mocked `callEngine`), so no live engine or database is needed: health/readiness,
tool CRUD + execute shapes + exact error forwarding, logs/patches/metrics +
query allowlist + 504 mapping, dashboard aggregation + outage honesty, and the
optional token guard. `23 passed`.
