// Pino-backed structured event builder. This module generates validated,
// redacted JSON log events — it never touches the network or the database.
// Transport (RabbitMQ vs direct PostgreSQL) is decided by auditLogger via the
// publisher, so emission points stay transport-agnostic.
const pino = require('pino');
const { newEventId } = require('../utils/ids');
const { redactSensitive } = require('../utils/redact');
const { eventMeta } = require('./eventTypes');
const { assertValidEvent } = require('./logEventSchema');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

function buildEvent({ eventType, executionId = null, toolId = null, severity, data = {}, actor = 'system' }) {
  if (!eventMeta(eventType)) {
    throw new Error(`Unknown log event type: ${eventType}`);
  }
  const event = {
    eventId: newEventId(),
    eventType,
    timestamp: new Date().toISOString(),
    executionId: executionId || null,
    toolId: toolId || null,
    severity: severity || eventMeta(eventType).severity,
    actor,
    data: redactSensitive(data || {}),
  };
  assertValidEvent(event);
  return event;
}

function logLocal(level, event) {
  if (typeof logger[level] === 'function') logger[level]({ logEvent: event });
  else logger.info({ logEvent: event });
}

module.exports = { logger, buildEvent, logLocal };
