// Execution timing + recovery metrics, all derived from persisted executions.
// Deterministic recovery uses zero LLM tokens: token columns are populated from
// actual provider usage metadata only (always 0 when no LLM is called).
const { query } = require('../db/pool');

async function getSummary() {
  const [{ rows: totals }, { rows: byStatus }, { rows: byClass }, { rows: timing }, { rows: tokens }] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'recovered')::int AS recovered,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE status = 'success')::int AS succeeded,
        COALESCE(SUM(retry_count), 0)::int AS retries
      FROM executions WHERE execution_id IS NOT NULL`),
    query(`SELECT status, COUNT(*)::int AS count FROM executions WHERE execution_id IS NOT NULL GROUP BY status`),
    query(`SELECT classification, COUNT(*)::int AS count FROM executions WHERE execution_id IS NOT NULL GROUP BY classification`),
    query(`SELECT COALESCE(AVG(duration_ms), 0)::float AS avg_duration_ms,
        COALESCE(AVG(duration_ms) FILTER (WHERE status = 'recovered'), 0)::float AS mttr_ms
      FROM executions WHERE execution_id IS NOT NULL`),
    query(`SELECT COALESCE(SUM(token_overhead), 0)::int AS token_overhead,
        COALESCE(SUM(llm_tokens_recovery), 0)::int AS llm_tokens_recovery
      FROM executions WHERE execution_id IS NOT NULL`),
  ]);
  const t = totals[0];
  const driftDenom = (byClass.find((r) => r.classification === 'SCHEMA_DRIFT')?.count || 0)
    + (byClass.find((r) => r.classification === 'SCHEMA_DRIFT_UNRECOVERED')?.count || 0)
    + (byClass.find((r) => r.classification === 'SCHEMA_DRIFT_AMBIGUOUS')?.count || 0);
  const recoveredDrift = byStatus.find((r) => r.status === 'recovered')?.count || 0;
  return {
    totalExecutions: t.total,
    succeeded: t.succeeded,
    recovered: t.recovered,
    failed: t.failed,
    retries: t.retries,
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.count])),
    byClassification: Object.fromEntries(byClass.map((r) => [r.classification || 'null', r.count])),
    avgDurationMs: Math.round(timing[0].avg_duration_ms),
    // MTTR: average elapsed time from a schema-related failure to verified recovery.
    mttrMs: Math.round(timing[0].mttr_ms),
    // Zero-Touch Adaptation Rate = autonomous recoveries / supported drift cases x 100.
    zeroTouchAdaptationRate: driftDenom === 0 ? 0 : Math.round((recoveredDrift / driftDenom) * 10000) / 100,
    // Token overhead = extra LLM tokens for diagnosis/recovery vs baseline (0 when deterministic).
    tokenOverhead: tokens[0].token_overhead,
    llmTokensRecovery: tokens[0].llm_tokens_recovery,
  };
}

async function listExecutions({ toolId, status, page = 1, pageSize = 20 } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const conds = ['execution_id IS NOT NULL'];
  const params = [];
  if (toolId) {
    params.push(toolId);
    conds.push(`tool_ref = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conds.push(`status = $${params.length}`);
  }
  const where = `WHERE ${conds.join(' AND ')}`;
  const [{ rows: countRows }, { rows }] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total FROM executions ${where}`, params),
    query(
      `SELECT execution_id, tool_ref, status, classification, recovery_result, retry_count,
        duration_ms, patch_operations, client_schema_version, downstream_schema_version,
        adapter_version, failure_at, llm_tokens_baseline, llm_tokens_recovery, token_overhead,
        created_at, finished_at
       FROM executions ${where} ORDER BY id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, ps, (p - 1) * ps]
    ),
  ]);
  return { data: rows, page: p, pageSize: ps, total: countRows[0].total };
}

async function getExecutionTrace(executionId) {
  const { rows } = await query(
    `SELECT execution_id, tool_id, tool_ref, status, classification, patch_operations,
      client_schema_version, downstream_schema_version, adapter_version,
      retry_count, recovery_result, failure_at, duration_ms,
      request_body, downstream_request, downstream_response, response_body, error,
      llm_tokens_baseline, llm_tokens_recovery, token_overhead, created_at, finished_at
     FROM executions WHERE execution_id = $1`,
    [executionId]
  );
  if (!rows[0]) return null;
  const execution = rows[0];
  const [{ rows: audits }, { rows: patches }] = await Promise.all([
    query('SELECT id, actor, action, entity, entity_id, metadata, created_at FROM audit_events WHERE execution_ref = $1 ORDER BY id ASC', [executionId]),
    query('SELECT patch_id, tool_ref, operations, diagnosis, status, adapter_version_before, adapter_version_after, downstream_version, error, created_at FROM patch_history WHERE execution_ref = $1 ORDER BY id ASC', [executionId]),
  ]);
  return { execution, auditEvents: audits, patches };
}

module.exports = { getSummary, listExecutions, getExecutionTrace };
