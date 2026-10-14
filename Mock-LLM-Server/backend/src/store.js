// In-memory simulation state. No database: the mock server is a judging tool,
// so configuration lives in memory, applies immediately, and resets on demand.
const { randomUUID } = require('crypto');

const CUSTOMERS_BASELINE = {
  endpointId: 'customers',
  method: 'POST',
  path: '/api/customers',
  requestSchema: {
    type: 'object',
    required: ['name', 'email'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1 },
      email: { type: 'string', minLength: 3 },
    },
  },
  responseSchema: {
    type: 'object',
    required: ['id', 'name', 'email'],
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      email: { type: 'string' },
    },
  },
  responseStatus: 201,
  responseBody: { id: 'cus_demo123', name: '$body.name', email: '$body.email' },
  requiredHeaders: [],
  failure: { mode: 'off' },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const state = {
  endpoints: new Map(), // endpointId -> endpoint record
  mutations: [], // {mutationId, endpointId, op, args, prevVersion, newVersion, appliedBy, appliedAt, scenarioId?}
  activity: [], // ring buffer, cap 200
  seq: 0,
};

function nextId(prefix) {
  state.seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${state.seq}_${randomUUID().slice(0, 6)}`;
}

function logActivity(entry) {
  state.activity.unshift({ id: nextId('act'), at: new Date().toISOString(), ...entry });
  if (state.activity.length > 200) state.activity.length = 200;
  return state.activity[0];
}

function toPublicEndpoint(rec) {
  return {
    endpointId: rec.endpointId,
    method: rec.method,
    path: rec.path,
    requestSchema: rec.requestSchema,
    responseSchema: rec.responseSchema,
    responseStatus: rec.responseStatus,
    responseBody: rec.responseBody,
    requiredHeaders: rec.requiredHeaders,
    failure: rec.failure,
    version: rec.version,
    schemaVersion: rec.schemaVersion,
    baselineVersion: rec.baselineVersion,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

function seed() {
  state.endpoints.clear();
  state.mutations = [];
  state.activity = [];
  const now = new Date().toISOString();
  state.endpoints.set(CUSTOMERS_BASELINE.endpointId, {
    ...clone(CUSTOMERS_BASELINE),
    baseline: clone({
      requestSchema: CUSTOMERS_BASELINE.requestSchema,
      responseSchema: CUSTOMERS_BASELINE.responseSchema,
      responseStatus: CUSTOMERS_BASELINE.responseStatus,
      responseBody: CUSTOMERS_BASELINE.responseBody,
      requiredHeaders: CUSTOMERS_BASELINE.requiredHeaders,
    }),
    version: 1,
    schemaVersion: 1,
    baselineVersion: 1,
    createdAt: now,
    updatedAt: now,
  });
}

seed();

module.exports = { state, clone, nextId, logActivity, toPublicEndpoint, seed, CUSTOMERS_BASELINE };
