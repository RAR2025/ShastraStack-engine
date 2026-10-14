## UI verification checklist (http://localhost:5173)

Tick through every control below. Each item names the exact button/field and
the expected result. All calls hit the real backend — nothing is mocked.

### Navigation bar
- [ ] All 7 tabs render: Dashboard, API Registry, Schema Lab, Test & Recovery,
      Logs, Metrics, Settings. Clicking each switches the view (URL changes to
      `/`, `/registry`, `/schemas`, `/test`, `/logs`, `/metrics`, `/settings`).

### Dashboard (`/`)
- [ ] **Refresh** button reloads all cards (numbers briefly show Loading…).
- [ ] `ENGINE HEALTH` card shows `ok` and `db: up`.
- [ ] `MOCK SERVER` card shows `reachable` (if it says `unreachable`, the mock
      backend is down or blocked — see Settings).
- [ ] `TOTAL EXECUTIONS`, `SUCCESSFUL RECOVERIES`, `FAILED RECOVERIES`,
      `ADAPTATION RATE`, `MTTR`, `RETRIES`, `ADDITIONAL LLM TOKENS` all show
      numbers (or honest “unavailable”, never sample data).

### API Registry (`/registry`)
- [ ] Tool list loads; each row shows toolId, method, baseUrl+path, version.
- [ ] **Inspect** opens the full tool JSON below the list.
- [ ] Register form → fill toolId `demo-check`, baseUrl
      `http://localhost:5000`, method `POST`, path `/api/customers`,
      clientSchema + downstreamSchema =
      `{"type":"object","required":["name","email"],"properties":{"name":{"type":"string"},"email":{"type":"string"}}}`,
      responseSchema =
      `{"type":"object","required":["data"],"properties":{"data":{"type":"object"}}}`,
      then **Register tool** → success message, row appears at version 1.
      ⚠️ Do not leave downstreamSchema empty — recovery needs the known contract.
- [ ] Register with an invalid toolId (`Bad ID!`) → clear 400 validation error.
- [ ] **Edit** a row → change timeoutMs → **Save** → version bumps by 1.
      **Cancel** closes the form without saving.
- [ ] **Remove** → confirm dialog → row disappears (204).

### Schema Lab (`/schemas`)
- [ ] Tool selector lists registered tools; picking one renders client vs
      downstream viewers plus the before/after diff (changed keys, required sets).
- [ ] Scenario dropdown + **Blind** mode → **Apply blind scenario on mock**
      → message states the engine was NOT notified.
- [ ] Mode **Informed** + toolId field → **Apply informed scenario** →
      message confirms engine notification.
- [ ] Without `VITE_MOCK_ADMIN_TOKEN`, scenario controls disable with an
      explanatory message (honest disabled state, not a dead button).
- [ ] **Open Mock API Studio ↗** link opens http://localhost:5174.

### Test & Recovery (`/test`)
- [ ] Tool selector → request payload textarea. Paste
      `{"name":"Ada","email":"ada@ex.com"}`, idempotency key `t1` →
      **Execute via ShastraStack** → `success` + execution ID + duration.
- [ ] Same payload with key `t2` after a mock rename (see Mock Studio
      checklist) → `recovered` with `RENAME_FIELD` operation, `retryCount: 1`.
- [ ] Re-run with key `t3` → `success` (committed adapter, no restart).
- [ ] Payload `{}` → 400 client error; downstream untouched.
- [ ] Payload with `"password":"secret123"` → open the trace → value renders
      as `[redacted]`, never plaintext.
- [ ] **Run baseline (direct mock)** → response panel labeled “direct mock
      path”, bypassing the engine, for controlled comparison.
- [ ] **Open full trace in Logs →** link jumps to `/logs/:executionId` showing
      original vs transformed request, classification, diagnosis, patch
      operations with committed/rolled-back status, retry count, durations.

### Logs (`/logs`)
- [ ] **Apply filters** with tool ID / status dropdown / classification
      substring / from–to dates → list narrows; unknown combinations show the
      empty state, not an error.
- [ ] **Prev/Next** pager walks pages (`Page x of y · N total` updates).
- [ ] Clicking an execution ID opens the trace: execution detail, audit-event
      list, and every patch record including `rolled_back`/rejected ones.

### Metrics (`/metrics`)
- [ ] **Refresh** reloads; measured cards (adaptation rate, MTTR, token
      overhead, outcome breakdown, classification badges) reflect real runs —
      execute something, refresh, watch totals move.
- [ ] Targets section is visually separate and labeled as targets.

### Settings (`/settings`)
- [ ] Backend/engine/mock URLs listed with live `up`/`down` badges.
- [ ] Policy box: `{"maxRetries": 5, …}` → **Validate policy** rejects it
      (max is 1); `{"maxRetries": 1, "allowAutomaticPatch": true}` → accepts.
      Validation only — applying happens per-tool in the Registry.
- [ ] No secret value appears anywhere on the screen.
