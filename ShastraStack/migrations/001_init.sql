-- ShastraStack foundation tables (PostgreSQL). All writes use parameterized queries in code.
CREATE TABLE IF NOT EXISTS tool_registrations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  base_url TEXT NOT NULL,
  endpoint TEXT NOT NULL DEFAULT '/',
  method TEXT NOT NULL DEFAULT 'POST',
  input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS executions (
  id SERIAL PRIMARY KEY,
  tool_id INTEGER REFERENCES tool_registrations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'started',
  duration_ms INTEGER,
  request_body JSONB,
  response_body JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_executions_tool_id ON executions(tool_id);
CREATE INDEX IF NOT EXISTS idx_executions_created_at ON executions(created_at);

CREATE TABLE IF NOT EXISTS patch_history (
  id SERIAL PRIMARY KEY,
  tool_id INTEGER REFERENCES tool_registrations(id) ON DELETE SET NULL,
  execution_id INTEGER REFERENCES executions(id) ON DELETE SET NULL,
  diagnosis JSONB NOT NULL DEFAULT '{}'::jsonb,
  patch JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_patch_history_tool_id ON patch_history(tool_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id SERIAL PRIMARY KEY,
  actor TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action);
