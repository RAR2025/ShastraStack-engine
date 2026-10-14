-- Async audit pipeline (RabbitMQ -> log consumer -> PostgreSQL).
-- Additive only: existing rows and data are preserved. Nullable new columns so
-- pre-existing audit/patch rows stay valid.

-- audit_events carries the complete redacted structured event record.
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS event_id TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'info';
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_events_event_id_key') THEN
    -- Idempotent consumer retries: same eventId inserts exactly once.
    ALTER TABLE audit_events ADD CONSTRAINT audit_events_event_id_key UNIQUE (event_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_audit_events_event_type ON audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_events_execution_ref ON audit_events(execution_ref);

-- Durable outbox for events that could not reach RabbitMQ. Bounded by disk,
-- drained after reconnection; rows survive engine restarts.
CREATE TABLE IF NOT EXISTS outbox_events (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbox_events_event_id_key') THEN
    ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_event_id_key UNIQUE (event_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_outbox_status_retry ON outbox_events(status, next_retry_at);

-- patch_history gains an optional event link; the table itself remains the
-- query-friendly patch summary store (no duplicate patch_logs table — the
-- complete event record lives in audit_events). patch_logs is provided as a
-- view for the specified name.
ALTER TABLE patch_history ADD COLUMN IF NOT EXISTS event_id TEXT;
CREATE OR REPLACE VIEW patch_logs AS
  SELECT patch_id, tool_ref, execution_ref, operations, diagnosis, status,
         adapter_version_before, adapter_version_after, downstream_version,
         error, event_id, created_at
  FROM patch_history;
