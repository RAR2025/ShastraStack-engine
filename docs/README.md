# ShastraStack docs

Start with the [root README](../README.md) (setup, architecture, API
reference, demo script, metrics, security, tests). The checklists below cover
every control in both frontends — each item names the exact button/field and
the expected result, verified against the UI code. All calls hit the real
backends; nothing is mocked.

| Guide | What it covers |
|---|---|
| [Judging-console checklist](frontend-checklist.md) | All 7 tabs of http://localhost:5173 — nav, Dashboard, API Registry, Schema Lab, Test & Recovery, Logs, Metrics, Settings |
| [Mock-studio checklist](mock-studio-checklist.md) | All 6 tabs of http://localhost:5174 — Endpoints, Schemas, Mutation Lab, Simulator, Scenarios, Activity |

Related references:

- [Root README](../README.md) — setup, env vars, full API reference, judge
  demo script, metric formulas, security notes, test commands
- [ShastraStack README](../ShastraStack/README.md) — engine run/test,
  registration format, endpoint examples
- [Application backend README](../Application/backend/README.md) — judging
  API routes and shapes
- [Mock server README](../Mock-LLM-Server/README.md) — judging workflow,
  admin APIs, mutation ops, failure injection, scenario presets

Known gotcha (from live debugging): a tool registered with an empty
`downstreamSchema` (`{}`) can never recover from request drift — the engine
has no baseline to diff against and truthfully returns
`SCHEMA_DRIFT_AMBIGUOUS`. Always register both schemas (Registry checklist
flags this), and keep the mock's canned response template coherent with
renamed request fields.
