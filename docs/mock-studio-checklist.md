## Console click-through checklist (http://localhost:5174)

Six tabs, every button below performs a real backend call. Start on
**Endpoints** with the seeded `customers` row selected.

### Endpoints tab
- [ ] `customers` row shows method, path, config + schema versions.
- [ ] Clicking the `POST /api/customers` link loads its detail JSON.
- [ ] **Reset** on a row restores its baseline (schema version bumps, failure
      cleared); **Delete** asks for confirmation, then removes the row.
- [ ] Create form → endpointId `try-me`, method `POST`, path `/api/try-me`,
      requestSchema
      `{"type":"object","required":["sku"],"properties":{"sku":{"type":"string"}}}`,
      responseSchema
      `{"type":"object","required":["orderId"],"properties":{"orderId":{"type":"string"}}}`,
      responseStatus `201`, responseBody `{"orderId":"ord_1"}` →
      **Create endpoint** → success message + new row in the list.
- [ ] Create with a bad path (`/api/admin/hack`) or bad schema
      (`{"type":"array"}`) → clear 400 error, nothing created.

### Schemas tab
- [ ] Select an endpoint → baseline vs active request schemas side by side,
      changed top-level keys listed, then baseline vs active response schemas.
- [ ] Edit either textarea to invalid JSON → **Save schemas** reports the JSON
      error; edit to a valid change → save succeeds with a version bump.

### Mutation Lab tab
- [ ] Target shows the selected endpoint; engine URL displayed for reference.
- [ ] Op `RENAME_FIELD` scope `request`, from `email`, to `emailAddress`,
      mode **Blind** → **Apply mutation now** → record shows versions and
      `mode: blind` (engine not notified).
- [ ] Same form, mode **Informed** + toolId → result shows the engine
      notification outcome.
- [ ] Op `ADD_HEADER`, header `x-tenant-id` → applies; op `DROP_TABLE` (or any
      unknown op) → 400, version unchanged.
- [ ] Each op shows only its relevant argument fields (from/to, fromPath/toPath,
      field/toType, field(+fieldSchema), header, responseSchema).

### Simulator tab
- [ ] Try-it form: method `POST`, path `/api/customers`, body
      `{"name":"Ada","email":"a@b.c"}` → **Send request** → `201` with the
      templated body. Body `{}` → `400` with structured field details.
- [ ] Extra headers box accepts JSON, e.g. `{"x-tenant-id":"acme"}`.
- [ ] Response config: change status/body → **Save response config** → try-it
      reflects it immediately.
- [ ] Failure injection: mode `auth failure (401)` → **Apply failure mode** →
      try-it returns `401`; `rate limit` → `429` + `Retry-After`;
      `timeout` → delayed response; `server error` → `5xx`. Mode `off`
      restores normal behavior.

### Scenarios tab
- [ ] All 7 presets listed with descriptions; target endpoint field defaults
      to the selection.
- [ ] **Apply preset** on `field-rename` → success message with mutation count
      and schema version; applying twice yields the same schema (deterministic).
- [ ] `unsupported-change` applies cleanly on the mock side (it is the engine
      that must reject it — verify from the :5173 Test & Recovery page).
- [ ] Unknown scenario handling: backend returns 404 `UNKNOWN_SCENARIO`.
- [ ] **Reset ALL endpoints to baselines** → confirmation of the reset.

### Activity tab
- [ ] Endpoint filter + **Refresh** → mock-request and admin-event entries with
      timestamps; mutation history shows op, actor, `prevVersion → newVersion`,
      scenario id when applicable; latest mutation detail JSON renders.
- [ ] Empty filter match shows the empty state, backend outage shows the error
      state with retry.
