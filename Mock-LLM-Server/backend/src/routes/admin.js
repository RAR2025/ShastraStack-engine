const express = require('express');
const { validate } = require('../middleware/validate');
const { adminAuth } = require('../middleware/adminAuth');
const { state, toPublicEndpoint } = require('../store');
const endpoints = require('../services/endpointService');
const { applyMutation, listMutations, SUPPORTED_OPS } = require('../services/mutationService');
const { setFailure, FAILURE_MODES } = require('../services/failureService');
const { listScenarios, applyScenario } = require('../services/scenarioService');
const { notifyEngine, notifySpecFrom } = require('../services/notifyService');

const router = express.Router();
router.use(adminAuth);

const schemaObject = { type: 'object' };

const createSchema = {
  type: 'object', required: ['endpointId', 'path', 'requestSchema'], additionalProperties: true,
  properties: {
    endpointId: { type: 'string', minLength: 1, maxLength: 64 },
    method: { type: 'string' },
    path: { type: 'string', minLength: 1, maxLength: 200 },
    requestSchema: schemaObject,
    responseSchema: schemaObject,
    responseStatus: { type: 'integer' },
    responseBody: { type: 'object' },
    requiredHeaders: { type: 'array' },
  },
};

const patchSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    expectedVersion: { type: 'integer', minimum: 1 },
    method: { type: 'string' },
    path: { type: 'string' },
    requestSchema: schemaObject,
    responseSchema: schemaObject,
    responseStatus: { type: 'integer' },
    responseBody: { type: 'object' },
    requiredHeaders: { type: 'array' },
  },
};

const mutationSchema = {
  type: 'object', required: ['op'], additionalProperties: true,
  properties: {
    op: { type: 'string' },
    scope: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    fromPath: { type: 'string' },
    toPath: { type: 'string' },
    field: { type: 'string' },
    toType: { type: 'string' },
    fieldSchema: { type: 'object' },
    header: { type: 'string' },
    responseSchema: schemaObject,
    appliedBy: { type: 'string', maxLength: 100 },
    notify: { type: 'object' },
  },
};

const responseSchemaValidator = {
  type: 'object', additionalProperties: false,
  properties: {
    responseStatus: { type: 'integer', minimum: 200, maximum: 599 },
    responseBody: { type: 'object' },
    appliedBy: { type: 'string', maxLength: 100 },
  },
};

const failureSchema = {
  type: 'object', additionalProperties: true,
  properties: {
    mode: { type: 'string' },
    status: { type: 'integer' },
    retryAfterSec: { type: 'integer' },
    delayMs: { type: 'integer' },
    appliedBy: { type: 'string', maxLength: 100 },
  },
};

function needEndpoint(req, res) {
  const rec = endpoints.getRecord(req.params.endpointId);
  if (!rec) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `Endpoint not found: ${req.params.endpointId}` } });
    return null;
  }
  return rec;
}

async function maybeNotify(rec, notifySpec) {
  if (!notifySpec.toolId) return { notified: false, mode: 'blind' };
  return notifyEngine({
    toolId: notifySpec.toolId,
    requestSchema: rec.requestSchema,
    responseSchema: rec.responseSchema,
    engineUrl: notifySpec.engineUrl,
  });
}

// ---- endpoints ----
router.get('/endpoints', (req, res) => {
  res.json({ data: endpoints.listEndpoints() });
});

router.post('/endpoints', validate(createSchema), (req, res, next) => {
  try {
    res.status(201).json({ data: endpoints.createEndpoint(req.body, req.body.appliedBy) });
  } catch (e) { next(e); }
});

router.get('/endpoints/:endpointId', (req, res, next) => {
  try {
    const found = endpoints.getEndpoint(req.params.endpointId);
    if (!found) return res.status(404).json({ error: { code: 'NOT_FOUND', message: `Endpoint not found: ${req.params.endpointId}` } });
    res.json({ data: found });
  } catch (e) { next(e); }
});

router.patch('/endpoints/:endpointId', validate(patchSchema), (req, res, next) => {
  try {
    const updated = endpoints.updateEndpoint(req.params.endpointId, req.body, req.body.appliedBy);
    if (!updated) return res.status(404).json({ error: { code: 'NOT_FOUND', message: `Endpoint not found: ${req.params.endpointId}` } });
    res.json({ data: updated });
  } catch (e) { next(e); }
});

router.delete('/endpoints/:endpointId', (req, res, next) => {
  try {
    const ok = endpoints.deleteEndpoint(req.params.endpointId, req.query.appliedBy || 'judge');
    if (!ok) return res.status(404).json({ error: { code: 'NOT_FOUND', message: `Endpoint not found: ${req.params.endpointId}` } });
    res.status(204).end();
  } catch (e) { next(e); }
});

router.get('/endpoints/:endpointId/schema', (req, res) => {
  const rec = needEndpoint(req, res);
  if (!rec) return;
  res.json({
    data: {
      endpointId: rec.endpointId,
      requestSchema: rec.requestSchema,
      responseSchema: rec.responseSchema,
      baselineRequestSchema: rec.baseline.requestSchema,
      baselineResponseSchema: rec.baseline.responseSchema,
      schemaVersion: rec.schemaVersion,
      baselineVersion: rec.baselineVersion,
    },
  });
});

// ---- mutations ----
router.post('/endpoints/:endpointId/mutations', validate(mutationSchema), async (req, res, next) => {
  try {
    const entry = applyMutation(req.params.endpointId, { ...req.body, appliedBy: req.body.appliedBy || 'judge' });
    if (!entry) return res.status(404).json({ error: { code: 'NOT_FOUND', message: `Endpoint not found: ${req.params.endpointId}` } });
    const rec = endpoints.getRecord(req.params.endpointId);
    let notification = { notified: false, mode: 'blind' };
    try {
      notification = await maybeNotify(rec, notifySpecFrom(req.body));
    } catch (e) { return next(e); }
    res.status(201).json({ data: { mutation: entry, schemaVersion: rec.schemaVersion, notification } });
  } catch (e) { next(e); }
});

router.post('/endpoints/:endpointId/reset', async (req, res, next) => {
  try {
    const out = endpoints.resetEndpoint(req.params.endpointId, (req.body && req.body.appliedBy) || 'judge');
    if (!out) return res.status(404).json({ error: { code: 'NOT_FOUND', message: `Endpoint not found: ${req.params.endpointId}` } });
    let notification = { notified: false, mode: 'blind' };
    try {
      notification = await maybeNotify(out.endpoint, notifySpecFrom(req.body));
    } catch (e) { return next(e); }
    res.json({ data: { ...out, notification } });
  } catch (e) { next(e); }
});

// ---- response simulator + failure injection ----
router.put('/endpoints/:endpointId/response', validate(responseSchemaValidator), (req, res, next) => {
  try {
    const rec = endpoints.getRecord(req.params.endpointId);
    if (!rec) return res.status(404).json({ error: { code: 'NOT_FOUND', message: `Endpoint not found: ${req.params.endpointId}` } });
    if (req.body.responseStatus !== undefined) {
      const s = req.body.responseStatus;
      if (!Number.isInteger(s) || s < 200 || s > 599) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'responseStatus must be 200-599' } });
      }
      rec.responseStatus = s;
    }
    if (req.body.responseBody !== undefined) rec.responseBody = JSON.parse(JSON.stringify(req.body.responseBody));
    rec.updatedAt = new Date().toISOString();
    res.json({ data: toPublicEndpoint(rec) });
  } catch (e) { next(e); }
});

router.put('/endpoints/:endpointId/failure', validate(failureSchema), (req, res, next) => {
  try {
    const out = setFailure(req.params.endpointId, req.body, req.body.appliedBy || 'judge');
    if (!out) return res.status(404).json({ error: { code: 'NOT_FOUND', message: `Endpoint not found: ${req.params.endpointId}` } });
    res.json({ data: { endpointId: req.params.endpointId, failure: out } });
  } catch (e) { next(e); }
});

// ---- scenarios ----
router.get('/scenarios', (req, res) => {
  res.json({ data: listScenarios() });
});

router.post('/scenarios/:scenarioId/apply', async (req, res, next) => {
  try {
    const out = applyScenario(req.params.scenarioId, {
      endpointId: (req.body && req.body.endpointId) || 'customers',
      appliedBy: (req.body && req.body.appliedBy) || 'judge',
    });
    const rec = endpoints.getRecord(out.endpointId);
    let notification = { notified: false, mode: 'blind' };
    try {
      notification = await maybeNotify(rec, notifySpecFrom(req.body));
    } catch (e) { return next(e); }
    res.json({ data: { ...out, schemaVersion: rec.schemaVersion, notification } });
  } catch (e) { next(e); }
});

// ---- history ----
router.get('/activity', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  res.json({ data: state.activity.slice(0, limit), total: state.activity.length });
});

router.get('/mutations', (req, res) => {
  res.json({ data: listMutations({ endpointId: req.query.endpointId, limit: req.query.limit }) });
});

router.get('/ops', (req, res) => {
  res.json({ data: { mutationOps: SUPPORTED_OPS, failureModes: ['off', 'auth', 'ratelimit', 'timeout', 'server'] } });
});

module.exports = router;
