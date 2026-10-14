// Structured audit event types for the async logging pipeline.
// severity drives handling: error/critical events are never silently dropped —
// if both RabbitMQ and the PostgreSQL outbox are unavailable, emitting them
// throws instead of returning a false success.
const EVENT_TYPES = {
  'execution.started': { severity: 'info', critical: false },
  'execution.completed': { severity: 'info', critical: false },
  'execution.failed': { severity: 'error', critical: true },
  'execution.retry_attempted': { severity: 'info', critical: false },
  'schema.drift_detected': { severity: 'warn', critical: false },
  'patch.proposed': { severity: 'info', critical: false },
  'patch.validated': { severity: 'info', critical: false },
  'patch.applied': { severity: 'info', critical: false },
  'patch.verified': { severity: 'info', critical: false },
  'patch.rolled_back': { severity: 'warn', critical: true },
  'patch.rejected': { severity: 'warn', critical: false },
  'recovery.completed': { severity: 'info', critical: false },
  'recovery.failed': { severity: 'error', critical: true },
  // Tool lifecycle (kept for the existing audit actions; same envelope).
  'tool.registered': { severity: 'info', critical: false },
  'tool.updated': { severity: 'info', critical: false },
  'tool.schema_updated': { severity: 'info', critical: false },
};

const SEVERITIES = ['debug', 'info', 'warn', 'error', 'critical'];

function eventMeta(eventType) {
  return EVENT_TYPES[eventType] || null;
}

function isCritical(eventType, severity) {
  const meta = eventMeta(eventType);
  if (severity === 'critical' || severity === 'error') return true;
  return !!(meta && meta.critical);
}

module.exports = { EVENT_TYPES, SEVERITIES, eventMeta, isCritical };
