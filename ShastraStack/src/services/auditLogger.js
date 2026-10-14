// Audit logging entry point (existing service, adapted — not duplicated).
// Sync mode (LOG_TRANSPORT=sync, used by tests): validated envelope persisted
// with a direct parameterized INSERT, exactly as before, plus the new columns.
// Async mode (default): the envelope goes through the RabbitMQ publisher with
// a durable PostgreSQL outbox fallback, and the log consumer worker persists
// it. HTTP responses never wait for the pipeline; critical events are never
// silently dropped (outbox first, throw only if the outbox itself is down).
const { query } = require('../db/pool');
const { buildEvent } = require('../logging/logger');
const { isCritical } = require('../logging/eventTypes');

// Legacy audit action -> structured event type. data keeps the original fields
// so existing dashboards and traces read unchanged.
function toEventType(action) {
  if (!action || typeof action !== 'string') return 'execution.completed';
  if (action === 'execution.client_error' || action === 'execution.failed') return 'execution.failed';
  if (action === 'execution.recovered') return 'recovery.completed';
  if (action === 'execution.success') return 'execution.completed';
  if (action === 'execution.adapter_bypass') return 'execution.started';
  if (action === 'tool.register') return 'tool.registered';
  if (action === 'tool.update') return 'tool.updated';
  if (action === 'tool.schema_update') return 'tool.schema_updated';
  return 'execution.completed';
}

function transportMode() {
  return (process.env.LOG_TRANSPORT || 'async').toLowerCase() === 'sync' ? 'sync' : 'async';
}

async function insertAuditRow(event, data) {
  const { rows } = await query(
    `INSERT INTO audit_events
       (event_id, event_type, severity, occurred_at, actor, action, entity, entity_id, metadata, execution_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING id, created_at`,
    [
      event.eventId,
      event.eventType,
      event.severity,
      event.timestamp,
      event.actor || 'system',
      data.action || event.eventType,
      data.entity || '',
      String(data.entity_id || data.toolId || event.executionId || ''),
      JSON.stringify(data),
      event.executionId || null,
    ]
  );
  return rows[0] || { id: null, created_at: null, duplicate: true };
}

async function logEvent({ actor = 'system', action, entity = '', entity_id = '', metadata = {}, executionRef = null, eventType, severity, toolId } = {}) {
  if (!action && !eventType) throw new Error('audit action is required');
  const type = eventType || toEventType(action);
  const data = { action: action || type, entity, entity_id: String(entity_id), toolId: toolId || metadata.toolId || null, ...metadata };
  const event = buildEvent({
    eventType: type,
    executionId: executionRef,
    toolId: data.toolId,
    severity,
    data,
    actor,
  });
  if (transportMode() === 'sync') {
    return insertAuditRow(event, data);
  }
  // Lazy require: no broker touch unless async mode actually emits.
  const { publishEvent } = require('../logging/rabbitmqPublisher');
  try {
    const res = await publishEvent(event);
    return { eventId: event.eventId, transport: res.transport, durable: res.durable };
  } catch (err) {
    // Only reachable for critical events when broker AND outbox are down.
    // Re-throw loudly; callers already guard execution flow with try/catch.
    err.eventId = event.eventId;
    throw err;
  }
}

async function listEvents({ page = 1, pageSize = 20, action, executionRef } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(Math.max(Number(pageSize) || 20, 1), 200);
  const conds = [];
  const params = [];
  if (action) {
    params.push(action);
    // Matches both legacy action values and structured event types.
    conds.push(`(action = $${params.length} OR event_type = $${params.length})`);
  }
  if (executionRef) {
    params.push(executionRef);
    conds.push(`execution_ref = $${params.length}`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const [{ rows: countRows }, { rows }] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total FROM audit_events ${where}`, params),
    query(
      `SELECT id, event_id, event_type, severity, occurred_at, actor, action, entity, entity_id, metadata, execution_ref, created_at
       FROM audit_events ${where} ORDER BY id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, ps, (p - 1) * ps]
    ),
  ]);
  return { data: rows, page: p, pageSize: ps, total: countRows[0].total };
}

module.exports = { logEvent, listEvents, toEventType, transportMode, insertAuditRow };
