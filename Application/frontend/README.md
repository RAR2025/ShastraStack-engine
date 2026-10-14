# Application Frontend — ShastraStack Judging Console

React + Vite + React Router DOM + Axios + vanilla CSS dashboard (`:5173`).
No Tailwind, Bootstrap, Material UI, or other CSS frameworks.

## Setup

```bash
cd Application/frontend
cp .env.example .env   # point at your services (defaults below are local dev)
npm install
npm run dev            # http://localhost:5173 (strict port)
npm run build          # production bundle -> dist/
npm run preview        # serve the bundle locally
```

Requires the Application backend (`:3000`) running; the backend in turn calls
the ShastraStack engine (`:4000`). Schema Lab extras (scenario apply, mock
schema view, direct-mock baseline) additionally call the Mock API (`:5000`).

## Environment (`VITE_*`, build-time)

| Variable | Default | Used by |
|---|---|---|
| `VITE_APP_BACKEND_URL` | `http://localhost:3000` | All judging data (single Axios client in `src/api/client.js`) |
| `VITE_SHASTRASTACK_URL` | `http://localhost:4000` | Display only (Settings) |
| `VITE_MOCK_API_URL` | `http://localhost:5000` | Mock reachability, schemas, scenarios, direct baseline |
| `VITE_MOCK_STUDIO_URL` | `http://localhost:5174` | “Open Mock API Studio” links |
| `VITE_MOCK_ADMIN_TOKEN` | *(empty)* | `x-admin-token` for mock admin calls; scenario/mutation controls disable honestly without it |

## Navigation & features

1. **Dashboard** (`/`) — live engine health + mock reachability, total
   executions, recoveries, failures, adaptation rate, MTTR, retries, LLM
   tokens via `GET /api/dashboard`. Unavailable values render as
   “unavailable”; engine outage shows the error, never sample data.
2. **API Registry** (`/registry`) — paginated tool list; register form
   (toolId, baseUrl, method, path, client/downstream/response schemas,
   timeoutMs, headers, credentialRef name, recoveryPolicy) with JSON + field
   validation and server errors shown verbatim; inspect, version-checked edit,
   remove with confirm.
3. **Schema Lab** (`/schemas`) — tool selector, client vs downstream viewers
   with before/after diff (changed props, required sets), scenario dropdown,
   **blind** (applies on the mock, reports `notified: false`) vs **informed**
   (notifies the engine toolId) indicators, mock active-schema view, link to
   the separate Mock API Studio. Blind mode never claims a notification.
4. **Test & Recovery** (`/test`) — JSON payload + optional idempotency key,
   execute via ShastraStack; shows execution ID, client/engine durations,
   classification, original vs transformed request (secrets redacted),
   downstream response, recorded diagnosis, patch operations with
   committed/rolled-back status and adapter versions, retry count, rollback
   outcome, link to the Logs trace; plus a clearly-labeled **direct-mock
   baseline** comparison path.
5. **Logs** (`/logs`, `/logs/:executionId`) — server-paginated executions
   with tool/status/classification-substring/date filters; trace view with
   execution detail, audit events, and all patch records (committed,
   rolled_back, rejected). Payloads displayed redacted.
6. **Metrics** (`/metrics`) — measured Zero-Touch Adaptation Rate, MTTR,
   token overhead, outcome + classification breakdowns; a separate,
   explicitly-labeled **targets** section (never mixed with live numbers).
7. **Settings** (`/settings`) — service URLs + live health badges, timeout
   field, recovery-policy JSON validator (validates only; policies are
   applied per-tool in the Registry). No secrets displayed anywhere.

## Quality notes

- `src/api/` is the only layer that knows service URLs; components never
  hardcode hosts. Every button triggers a real backend/mock call.
- Loading / empty / error(+retry) / success states on every data view.
- Fully responsive vanilla CSS (`src/styles.css`), dark topbar + card layout.
- Secret redaction is display-wide (`src/components/redact.js`).
- Verified: `npm run build` succeeds, backend suite 23/23 green, and the
  backend was exercised live (dashboard/tools/execute/trace/metrics/allowlist
  rejection/engine-down honesty) against a stubbed engine contract.


## UI verification checklist

Moved to [docs/frontend-checklist.md](../../docs/frontend-checklist.md).
