// Deterministic, repeatable judging presets. Applying a scenario RESETS the
// target endpoint to its baseline first, then applies the preset mutations in
// order — running it twice yields the same active schema every time.
const { getRecord, resetEndpoint } = require('./endpointService');
const { applyMutation } = require('./mutationService');

function err(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

// Presets describe mutations only; they never name engine fields.
const SCENARIOS = {
  'field-rename': {
    title: 'Field rename',
    description: 'Request renames email -> emailAddress. Engine should RENAME_FIELD + retry once.',
    mutations: [{ op: 'RENAME_FIELD', scope: 'request', from: 'email', to: 'emailAddress' }],
  },
  'type-conversion': {
    title: 'Type conversion',
    description: 'Adds required integer age. A client sending age as a string should trigger CONVERT_TYPE recovery.',
    mutations: [
      { op: 'ADD_REQUIRED_FIELD', scope: 'request', field: 'age', fieldSchema: { type: 'integer' } },
    ],
  },
  nesting: {
    title: 'Nesting',
    description: 'Flat name moves under customer.name. Engine should MOVE_FIELD.',
    mutations: [{ op: 'MOVE_FIELD', scope: 'request', fromPath: 'name', toPath: 'customer.name' }],
  },
  'required-header': {
    title: 'Required header',
    description: 'Adds required header x-tenant-id. Engine must not invent the value.',
    mutations: [{ op: 'ADD_HEADER', header: 'x-tenant-id' }],
  },
  'multiple-changes': {
    title: 'Multiple changes',
    description: 'Rename + new required field together (ambiguous for blind recovery).',
    mutations: [
      { op: 'RENAME_FIELD', scope: 'request', from: 'email', to: 'emailAddress' },
      { op: 'ADD_REQUIRED_FIELD', scope: 'request', field: 'phone', fieldSchema: { type: 'string' } },
    ],
  },
  'response-drift': {
    title: 'Response drift',
    description: 'Response renames answer/name shape; engine should adapt the response.',
    mutations: [
      {
        op: 'CHANGE_RESPONSE_SCHEMA', responseSchema: {
          type: 'object', required: ['customerId', 'name'],
          properties: { customerId: { type: 'string' }, name: { type: 'string' } },
        },
      },
    ],
  },
  'unsupported-change': {
    title: 'Unsupported change',
    description: 'Adds required loyaltyTier with no evidence trail. Engine must safely reject.',
    mutations: [
      { op: 'ADD_REQUIRED_FIELD', scope: 'request', field: 'loyaltyTier', fieldSchema: { type: 'string', enum: ['gold', 'silver'] } },
      { op: 'CONVERT_TYPE', scope: 'request', field: 'name', toType: 'integer' },
    ],
  },
};

function listScenarios() {
  return Object.entries(SCENARIOS).map(([id, s]) => ({ scenarioId: id, ...s }));
}

function applyScenario(scenarioId, { endpointId = 'customers', appliedBy = 'judge' } = {}) {
  const preset = SCENARIOS[scenarioId];
  if (!preset) throw err(404, 'UNKNOWN_SCENARIO', `Unknown scenario: ${scenarioId}`);
  const rec = getRecord(endpointId);
  if (!rec) throw err(404, 'NOT_FOUND', `Endpoint not found: ${endpointId}`);
  resetEndpoint(endpointId, appliedBy);
  const applied = [];
  for (const m of preset.mutations) {
    applied.push(applyMutation(endpointId, { ...m, appliedBy, scenarioId }));
  }
  return { scenarioId, endpointId, applied };
}

module.exports = { SCENARIOS, listScenarios, applyScenario };
