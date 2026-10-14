# Mock API Simulation Platform

Independent judging platform for ShastraStack: a Node.js + Express backend
(`backend/`, :5000) and a separate React + Vite + vanilla-CSS console
(`frontend/`, :5174). Simulates downstream contract changes at runtime —
no restarts.

## Startup

```bash
# backend :5000
cd Mock-LLM-Server/backend
cp .env.example .env   # set ADMIN_TOKEN (default local-dev-token)
npm install
npm run dev            # or: npm start
curl http://localhost:5000/health

# frontend :5174
cd Mock-LLM-Server/frontend
cp .env.example .env   # VITE_MOCK_API_URL, VITE_ADMIN_TOKEN, VITE_ENGINE_BASE_URL
npm install
npm run dev            # open http://localhost:5174

# tests
cd ../backend && npm test
```

Env: `PORT`, `CORS_ORIGINS`, `ADMIN_TOKEN` (guards `/api/admin/*`,
never echoed in responses), `ENGINE_BASE_URL` (used only for explicit
informed-mode notification).

## Judging workflow

1. Register the mock endpoint in ShastraStack (`POST /v1/tools/register`
   with the mock's `baseUrl` + current schemas from `GET /api/admin/endpoints/customers/schema`).
2. **Blind mode**: apply a mutation/scenario with no `notify` — the engine
   must detect drift from execution errors/response validation. The mock
   never contacts the engine in this mode.
3. **Informed mode**: pass `notify: { toolId }` — the mock POSTs the active
   schemas to the engine's documented `POST /v1/tools/:toolId/schema`.
4. Check the engine's `/v1/logs`, `/v1/patches`, `/v1/metrics/summary`;
   then `POST /api/admin/endpoints/:id/reset` and repeat (deterministic).

Seeded example: `POST /api/customers` (`{name, email}` → `201 {id, name, email}`).

## Backend APIs

Admin routes require `x-admin-token: <ADMIN_TOKEN>`. Errors are
`{ error: { code, message, details? } }`. The token never appears in responses.

| Method & path | Purpose |
|---|---|
| `GET /health` | Backend liveness (public) |
| `GET /api/admin/endpoints` | List configured mock endpoints |
| `POST /api/admin/endpoints` | Create `{endpointId, method, path, requestSchema, responseSchema, responseStatus?, responseBody?, requiredHeaders?}` → 201 |
| `GET /api/admin/endpoints/:id` | Endpoint configuration |
| `PATCH /api/admin/endpoints/:id` | Update with `{expectedVersion, ...}` → 409 on conflict |
| `DELETE /api/admin/endpoints/:id` | Delete → 204 |
| `GET /api/admin/endpoints/:id/schema` | Active + baseline request/response schemas and versions |
| `POST /api/admin/endpoints/:id/mutations` | Apply `{op, ...args, appliedBy?, notify?}` → 201 `{mutation, schemaVersion, notification}` |
| `POST /api/admin/endpoints/:id/reset` | Restore baseline (clears failure too) |
| `PUT /api/admin/endpoints/:id/response` | Configure `{responseStatus?, responseBody?}` |
| `PUT /api/admin/endpoints/:id/failure` | Inject `{mode: off\|auth\|ratelimit\|timeout\|server, ...}` |
| `GET /api/admin/scenarios` | List presets |
| `POST /api/admin/scenarios/:id/apply` | Reset-to-baseline + apply preset `{endpointId?, notify?}` |
| `GET /api/admin/activity?limit=` | Recent mock requests + admin events |
| `GET /api/admin/mutations?endpointId=&limit=` | Mutation history (actor, versions, timestamps) |
| `GET /api/admin/ops` | Supported mutation ops + failure modes |

Simulated business routes (public, exact method+path match): required-header
check → 400 `MISSING_HEADER`; Ajv validation → 400
`REQUEST_VALIDATION_FAILED` with structured details and field-naming messages;
otherwise the configured status + templated body (`$body.a.b`, `$header.name`).

```bash
TOKEN=local-dev-token
# create a custom endpoint (judges define their own schemas)
curl -X POST http://localhost:5000/api/admin/endpoints -H "x-admin-token: $TOKEN" -H 'Content-Type: application/json' -d '{
  "endpointId": "orders", "method": "POST", "path": "/api/orders",
  "requestSchema": {"type":"object","required":["sku"],"properties":{"sku":{"type":"string"}}},
  "responseSchema": {"type":"object","required":["orderId"],"properties":{"orderId":{"type":"string"}}},
  "responseStatus": 201, "responseBody": {"orderId": "ord_1"}
}'
# blind rename
curl -X POST http://localhost:5000/api/admin/endpoints/orders/mutations -H "x-admin-token: $TOKEN" -H 'Content-Type: application/json' -d '{
  "op": "RENAME_FIELD", "scope": "request", "from": "sku", "to": "stockKeepingUnit"
}'
# informed rename (explicit opt-in only)
curl -X POST http://localhost:5000/api/admin/endpoints/orders/mutations -H "x-admin-token: $TOKEN" -H 'Content-Type: application/json' -d '{
  "op": "RENAME_FIELD", "scope": "request", "from": "sku", "to": "stockKeepingUnit",
  "notify": {"toolId": "orders-api"}
}'
# scenario + reset
curl -X POST http://localhost:5000/api/admin/scenarios/response-drift/apply -H "x-admin-token: $TOKEN" -H 'Content-Type: application/json' -d '{"endpointId":"customers"}'
curl -X POST http://localhost:5000/api/admin/endpoints/customers/reset -H "x-admin-token: $TOKEN" -H 'Content-Type: application/json' -d '{}'
```

## Mutation ops

`RENAME_FIELD {scope, from, to}`, `MOVE_FIELD {scope, fromPath, toPath}`,
`CONVERT_TYPE {scope, field, toType}`, `ADD_REQUIRED_FIELD {scope, field, fieldSchema?}`,
`ADD_HEADER {header}`, `CHANGE_RESPONSE_SCHEMA {responseSchema}`.
Each is validated before activation (unknown fields, collisions, compilability);
failures leave versions untouched. History records op, args, actor, timestamp,
`prevVersion` → `newVersion`.

## Failure injection

`auth` → 401/403 · `ratelimit` → 429 + `Retry-After` · `timeout` → delayed
response (`delayMs`) · `server` → configurable 5xx. Explicit, visible in
activity, cleared by endpoint reset. Test simulations only.

## Scenario presets

`field-rename`, `type-conversion`, `nesting`, `required-header`,
`multiple-changes` (ambiguous), `response-drift`, `unsupported-change`
(safe-rejection demo). All reset-to-baseline first: repeatable.

## Frontend console (:5174, single `src/api.js` client)

Endpoint Manager (CRUD + reset), Schema Editor (JSON edit + baseline/active
comparison + changed keys), Mutation Lab (all 6 ops + blind/informed toggle),
Response Simulator (live try-it + status/body config), Failure Injection,
Scenario Presets (+ reset-all), Activity & Mutation History. Loading, empty,
success, and error states throughout; every button hits the backend.
Legacy `/api/chat` playground routes are retained for compatibility.


## Console click-through checklist

Moved to [docs/mock-studio-checklist.md](../../docs/mock-studio-checklist.md).
