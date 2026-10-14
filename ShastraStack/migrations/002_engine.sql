-- ShastraStack engine: client/downstream schema split, adapter rules, versioning,
-- execution trace fields, patch history, metrics. All writes use parameterized queries.
-- Idempotent: safe to run multiple times.

-- ---------- tool_registrations ----------
ALTER TABLE tool_registrations ADD COLUMN IF NOT EXISTS tool_id TEXT;
ALTER TABLE tool_registrations ADD COLUMN IF NOT EXISTS client_schema JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tool_registrations ADD COLUMN IF NOT EXISTS downstream_schema JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tool_registrations ADD COLUMN IF NOT EXISTS response_schema JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tool_registrations ADD COLUMN IF NOT EXISTS adapter_rules JSONB NOT NULL DEFAULT '{"operations":[]}'::jsonb;
ALTER TABLE tool_registrations ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tool_registrations ADD COLUMN IF NOT EXISTS downstream_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tool_registrations ADD COLUMN IF NOT EXISTS path TEXT NOT NULL DEFAULT '/';
ALTER TABLE tool_registrations ADD COLUMN IF NOT EXISTS timeout_ms INTEGER NOT NULL DEFAULT 5000;
ALTER TABLE tool_registrations ADD COLUMN IF NOT EXISTS headers JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tool_registrations ADD COLUMN IF NOT EXISTS credential_ref TEXT;
ALTER TABLE tool_registrations ADD COLUMN IF NOT EXISTS recovery_policy JSONB NOT NULL DEFAULT '{"maxRetries":1,"allowAutomaticPatch":true}'::jsonb;

-- Backfill new columns from foundation columns for existing rows.
UPDATE tool_registrations SET tool_id = name WHERE tool_id IS NULL;
UPDATE tool_registrations SET path = endpoint WHERE path = '/' AND endpoint IS NOT NULL AND endpoint <> '/';
UPDATE tool_registrations SET client_schema = input_schema WHERE client_schema = '{}'::jsonb AND input_schema IS NOT NULL AND input_schema <> '{}'::jsonb;
UPDATE tool_registrations SET downstream_schema = input_schema WHERE downstream_schema = '{}'::jsonb AND input_schema IS NOT NULL AND input_schema <> '{}'::jsonb;
UPDATE tool_registrations SET response_schema = output_schema WHERE response_schema = '{}'::jsonb AND output_schema IS NOT NULL AND output_schema <> '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tool_registrations_tool_id_key') THEN
    ALTER TABLE tool_registrations ADD CONSTRAINT tool_registrations_tool_id_key UNIQUE (tool_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_tool_registrations_tool_id ON tool_registrations(tool_id);

-- ---------- executions ----------
ALTER TABLE executions ADD COLUMN IF NOT EXISTS execution_id TEXT;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS tool_ref TEXT;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS classification TEXT;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS patch_operations JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS client_schema_version INTEGER;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS downstream_schema_version INTEGER;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS adapter_version INTEGER;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS recovery_result TEXT;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS failure_at TEXT;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS downstream_request JSONB;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS downstream_response JSONB;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS llm_tokens_baseline INTEGER NOT NULL DEFAULT 0;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS llm_tokens_recovery INTEGER NOT NULL DEFAULT 0;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS token_overhead INTEGER NOT NULL DEFAULT 0;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'executions_execution_id_key') THEN
    ALTER TABLE executions ADD CONSTRAINT executions_execution_id_key UNIQUE (execution_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_executions_tool_ref ON executions(tool_ref);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_classification ON executions(classification);

-- ---------- patch_history ----------
ALTER TABLE patch_history ADD COLUMN IF NOT EXISTS patch_id TEXT;
ALTER TABLE patch_history ADD COLUMN IF NOT EXISTS tool_ref TEXT;
ALTER TABLE patch_history ADD COLUMN IF NOT EXISTS execution_ref TEXT;
ALTER TABLE patch_history ADD COLUMN IF NOT EXISTS operations JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE patch_history ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'committed';
ALTER TABLE patch_history ADD COLUMN IF NOT EXISTS adapter_version_before INTEGER;
ALTER TABLE patch_history ADD COLUMN IF NOT EXISTS adapter_version_after INTEGER;
ALTER TABLE patch_history ADD COLUMN IF NOT EXISTS downstream_version INTEGER;
ALTER TABLE patch_history ADD COLUMN IF NOT EXISTS error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patch_history_patch_id_key') THEN
    ALTER TABLE patch_history ADD CONSTRAINT patch_history_patch_id_key UNIQUE (patch_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_patch_history_tool_ref ON patch_history(tool_ref);
CREATE INDEX IF NOT EXISTS idx_patch_history_status ON patch_history(status);

-- ---------- audit_events ----------
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS execution_ref TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_events_execution_ref ON audit_events(execution_ref);
