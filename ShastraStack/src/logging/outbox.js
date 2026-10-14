// Durable PostgreSQL outbox for audit events that could not be published to
// RabbitMQ. Bounded by disk (not memory): pending rows survive engine restarts
// and are drained after reconnection. All SQL parameterized.
const { query } = require('../db/pool');

async function insertOutbox(event) {
  const { rows } = await query(
    `INSERT INTO outbox_events (event_id, event_type, event, status, attempts, next_retry_at)
     VALUES ($1, $2, $3::jsonb, 'pending', 0, NOW())
     ON CONFLICT (event_id) DO NOTHING
     RETURNING id`,
    [event.eventId, event.eventType, JSON.stringify(event)]
  );
  return { stored: rows.length > 0 };
}

async function claimDueOutbox(limit = 100) {
  const n = Math.min(Math.max(Number(limit) || 100, 1), 1000);
  const { rows } = await query(
    `UPDATE outbox_events SET status = 'sending'
     WHERE id IN (
       SELECT id FROM outbox_events
       WHERE status IN ('pending', 'failed') AND next_retry_at <= NOW()
       ORDER BY id ASC LIMIT $1
     )
     RETURNING id, event_id, event, attempts`,
    [n]
  );
  return rows;
}

async function markOutboxSent(id) {
  await query(`UPDATE outbox_events SET status = 'sent', sent_at = NOW() WHERE id = $1`, [id]);
}

async function markOutboxFailed(id, error, delayMs = 30000) {
  await query(
    `UPDATE outbox_events SET status = 'failed', attempts = attempts + 1,
       last_error = $2, next_retry_at = NOW() + ($3 || ' milliseconds')::interval
     WHERE id = $1`,
    [id, String((error && error.message) || error || 'publish failed').slice(0, 2000), Math.min(Math.max(Number(delayMs) || 30000, 1000), 3600000)]
  );
}

async function countPendingOutbox() {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS pending FROM outbox_events WHERE status IN ('pending', 'failed', 'sending')`
  );
  return rows[0].pending;
}

module.exports = { insertOutbox, claimDueOutbox, markOutboxSent, markOutboxFailed, countPendingOutbox };
