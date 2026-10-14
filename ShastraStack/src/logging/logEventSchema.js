// Ajv validation for the structured log-event envelope. Applied both before
// publishing (engine side) and before database persistence (worker side), so a
// malformed event can never corrupt the audit trail from either direction.
const Ajv = require('ajv');
const { EVENT_TYPES, SEVERITIES } = require('./eventTypes');

const ajv = new Ajv({ allErrors: true, strict: false });

const envelopeSchema = {
  type: 'object',
  required: ['eventId', 'eventType', 'timestamp', 'severity', 'data'],
  additionalProperties: false,
  properties: {
    eventId: { type: 'string', minLength: 1, maxLength: 100 },
    eventType: { type: 'string', enum: Object.keys(EVENT_TYPES) },
    timestamp: { type: 'string', minLength: 1, maxLength: 40 },
    executionId: { type: ['string', 'null'], maxLength: 100 },
    toolId: { type: ['string', 'null'], maxLength: 100 },
    severity: { type: 'string', enum: SEVERITIES },
    actor: { type: 'string', maxLength: 100 },
    data: { type: 'object' },
  },
};

const validateEnvelope = ajv.compile(envelopeSchema);

function assertValidEvent(event) {
  const valid = validateEnvelope(event);
  if (!valid) {
    const err = new Error('Invalid log event envelope');
    err.status = 400;
    err.code = 'INVALID_LOG_EVENT';
    err.details = (validateEnvelope.errors || []).map((e) => ({
      path: e.instancePath || '/',
      message: e.message,
    }));
    throw err;
  }
  return true;
}

module.exports = { envelopeSchema, validateEnvelope, assertValidEvent };
