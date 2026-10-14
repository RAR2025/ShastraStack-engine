# ShastraStack Engine

Reusable middleware between any client application and an external API.
Per tool it keeps two schemas: `clientSchema` (stable client contract) and
`downstreamSchema` (currently known external contract), plus adapter rules that
transform client requests into downstream requests. The client contract never
changes when the downstream API drifts.

Nothing about downstream URLs, endpoints, or field names is hardcoded: every
tool's `baseUrl`, `path`, `method`, and schemas come from its registration.

## Run

```bash
npm install
npm run migrate          # applies migrations/001_init.sql + 002_engine.sql + 003_logging.sql
npm run dev              # :4000  (npm start for production)
npm run worker           # log consumer worker (separate process; dev:worker for watch mode)
npm test                 # isolated shastrastack_test database (never touches dev)
```

Env (`ShastraStack/.env`, see `.env.example`): `PORT`, `DATABASE_URL`,
`CORS_ORIGINS`, `LOG_LEVEL`. Tests use `TEST_DATABASE_URL` /
`shastrastack_test` and refuse to run against a non-`test` database.

## Registration format

```json
{
  "toolId": "customer-api",
  "baseUrl": "http://localhost:5000",
  "method": "POST",
  "path": "/api/customers",
  "clientSchema": { "type": "object", "required": ["email"], "properties": { "email": { "type": "string" } } },
  "downstreamSchema": { "type": "object", "required": ["email"], "properties": { "email": { "type": "string" } } },
  "responseSchema": { "type": "object", "required": ["ok"], "properties": { "ok": { "type": "boolean" } } },
  "timeoutMs": 5000,
  "headers": { "x-tenant-id": "acme" },
  "credentialRef": "prod-api-key-name",
  "recoveryPolicy": { "maxRetries": 1, "allowAutomaticPatch": true }
}
```

- `toolId`: `^[a-z0-9][a-z0-9-_]{0,63}$`. `method`: GET/POST/PUT/PATCH/DELETE.
- `clientSchema`: validates caller input. `downstreamSchema`: validates the
  adapted request. `responseSchema`: validates downstream 2xx bodies.
- `headers`: static non-secret headers only. `authorization`/`cookie` values
  are rejected with 400 — pass `credentialRef` (a reference NAME, never the
  secret) and resolve secrets outside the engine.
- `recoveryPolicy.maxRetries`: 0 or 1 (MVP retries at most once).
  `allowAutomaticPatch: false` disables all auto-recovery.
- Secrets are never persisted in schemas/logs and never logged (Pino redaction).

## Endpoints (all JSON; errors are `{ error: { code, message, details? } }`)

### GET /health — engine + database health
```bash
curl http://localhost:4000/health
# {"status":"ok","service":"shastrastack-engine","db":"up","time":"..."}
```

### POST /v1/tools/register — register a tool
```bash
curl -X POST http://localhost:4000/v1/tools/register -H 'Content-Type: application/json' -d '{
  "toolId": "customer-api", "baseUrl": "http://localhost:5000",
  "method": "POST", "path": "/api/customers",
  "clientSchema": {"type":"object","required":["email"],"properties":{"email":{"type":"string"}}},
  "downstreamSchema": {"type":"object","required":["email"],"properties":{"email":{"type":"string"}}},
  "responseSchema": {"type":"object","required":["ok"],"properties":{"ok":{"type":"boolean"}}}
}'
# 201 {"data":{"toolId":"customer-api","version":1,"downstreamVersion":1,"adapterRules":{"operations":[]},"..."}}
# 409 {"error":{"code":"TOOL_EXISTS",...}} on duplicates
```

### GET /v1/tools — list (paginated)
```bash
curl 'http://localhost:4000/v1/tools?page=1&pageSize=20'
# {"data":[...],"page":1,"pageSize":20,"total":3}
```

### GET /v1/tools/:toolId — retrieve
```bash
curl http://localhost:4000/v1/tools/customer-api
# 200 {"data":{...}} · 404 {"error":{"code":"NOT_FOUND",...}}
```

### PATCH /v1/tools/:toolId — update config/schemas (version-checked)
```bash
curl -X PATCH http://localhost:4000/v1/tools/customer-api -H 'Content-Type: application/json' -d '{
  "expectedVersion": 1, "timeoutMs": 8000, "headers": {"x-tenant-id": "acme"}
}'
# 200 {"data":{"version":2,...}} · 409 {"error":{"code":"VERSION_CONFLICT",...}}
```

### DELETE /v1/tools/:toolId — unregister
```bash
curl -X DELETE http://localhost:4000/v1/tools/customer-api
# 204 (empty) · 404 if unknown
```

### POST /v1/tools/:toolId/execute — execute with self-healing
```bash
curl -X POST http://localhost:4000/v1/tools/customer-api/execute -H 'Content-Type: application/json' -d '{
  "input": {"email": "a@b.c"}, "idempotencyKey": "order-123"
}'
# success:   200 {"data":{...},"executionId":"ex_...","status":"success","durationMs":12}
# recovered: 200 {"data":{...},"executionId":"ex_...","status":"recovered",
#              "classification":"SCHEMA_DRIFT",
#              "recovery":{"patchId":"pt_...","operations":[{"op":"RENAME_FIELD","scope":"request","from":"email","to":"emailAddress"}],"retryCount":1,"adapterVersion":2}}
# bad input: 400 {"error":{"code":"VALIDATION_ERROR",...},"executionId":"ex_..."}
# drift fail: 502 {"error":{"code":"SCHEMA_DRIFT_AMBIGUOUS","message":"..."},"executionId":"ex_...","classification":"...","downstreamStatus":400}
```
`idempotencyKey` (or `x-idempotency-key` header) is required before the engine
will resend a non-idempotent write (POST/PUT/PATCH/DELETE).

### POST /v1/tools/:toolId/schema — informed downstream-schema update
```bash
curl -X POST http://localhost:4000/v1/tools/customer-api/schema -H 'Content-Type: application/json' -d '{
  "downstreamSchema": {"type":"object","required":["emailAddress"],"properties":{"emailAddress":{"type":"string"}}},
  "expectedDownstreamVersion": 1
}'
# 200 {"data":{"downstreamVersion":2,...}} · 409 on version conflict
```

### GET /v1/logs — execution/audit logs (filters + pagination)
```bash
curl 'http://localhost:4000/v1/logs?toolId=customer-api&status=recovered&page=1&pageSize=20'
curl 'http://localhost:4000/v1/logs?kind=audit&pageSize=20'
# {"data":[...],"page":1,"pageSize":20,"total":N}
```

### GET /v1/logs/:executionId — full trace (execution + audit events + patches)
```bash
curl http://localhost:4000/v1/logs/ex_abc123
# 200 {"data":{"execution":{...},"auditEvents":[...],"patches":[...]}} · 404
```

### GET /v1/patches — patch history
```bash
curl 'http://localhost:4000/v1/patches?toolId=customer-api&status=committed'
# {"data":[{"patch_id":"pt_...","operations":[...],"status":"committed",...}],"page":1,"pageSize":20,"total":N}
```

### GET /v1/patches/:patchId — patch details
```bash
curl http://localhost:4000/v1/patches/pt_abc123
# 200 {"data":{...}} · 404
```

### GET /v1/metrics/summary — aggregates
```bash
curl http://localhost:4000/v1/metrics/summary
# {"data":{"totalExecutions":42,"succeeded":30,"recovered":8,"failed":4,"retries":8,
#   "byStatus":{...},"byClassification":{...},"avgDurationMs":23,"mttrMs":61,
#   "zeroTouchAdaptationRate":88.89,"tokenOverhead":0,"llmTokensRecovery":0}}
```

### GET /v1/metrics/executions — per-execution metrics
```bash
curl 'http://localhost:4000/v1/metrics/executions?toolId=customer-api&status=recovered&page=1&pageSize=20'
```

## Recovery pipeline (deterministic, evidence-only)

1. Validate caller input vs `clientSchema` → 400, downstream untouched.
2. Apply committed adapter rules (in-memory) → adapted request.
3. Validate adapted request vs known `downstreamSchema` (only when no adapter
   is active; a committed adapter is trusted and judged by downstream evidence).
4. Send via Axios with per-tool `timeoutMs` (GET uses query params).
5. Validate 2xx bodies vs `responseSchema`.
6. Classify: `USER_INPUT_ERROR`, `AUTH_ERROR` (401/403 — never patched),
   `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED` (honors `Retry-After`, never patched),
   `NETWORK_ERROR`, `TIMEOUT`, `SERVER_ERROR` (never auto-patched),
   `SCHEMA_DRIFT_CANDIDATE` (400/422 with schema signals, or response mismatch).
7. Diagnose only single-evidence changes: rename, nesting move, safe type
   coercion, or a required header whose value is already configured.
   Anything else → `ambiguous` → truthful 502 + `rolled_back` record.
8. Plan one of `RENAME_FIELD`, `MOVE_FIELD`, `CONVERT_TYPE`, `ADD_HEADER`
   (Ajv-validated; header values only from registration, never invented).
9. Retry at most once (non-idempotent writes need an idempotency key).
10. Commit (adapter version bump + `committed` patch row) only on verified
    success; otherwise roll back (adapter untouched + `rolled_back` row).

Informed mode (`POST /:toolId/schema`) and blind mode (runtime evidence) are
independent; neither requires a full registration update per request.

## Metrics definitions

- **Zero-Touch Adaptation Rate** = autonomous `recovered` drift executions /
  all drift-classified executions × 100.
- **MTTR** = average `duration_ms` of recovered executions.
- **Token overhead** = extra LLM tokens for recovery vs baseline. The engine is
  deterministic and reports **0** unless real provider usage metadata is attached.
- Also tracked: total/success/recovered/failed counts, retries, per-status and
  per-classification breakdowns.
