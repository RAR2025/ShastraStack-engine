const express = require('express');
const { validate } = require('../middleware/validate');
const { checkQuery, checkToolId } = require('../middleware/queryAllowlist');
const { callEngine, forward, forwardError } = require('../engineClient');

const router = express.Router();
const schemaObject = { type: 'object' };

const registerSchema = {
  type: 'object',
  required: ['toolId', 'baseUrl'],
  additionalProperties: true,
  properties: {
    toolId: { type: 'string', minLength: 1, maxLength: 64 },
    baseUrl: { type: 'string', minLength: 1, maxLength: 500 },
    method: { type: 'string' },
    path: { type: 'string' },
    clientSchema: schemaObject,
    downstreamSchema: schemaObject,
    responseSchema: schemaObject,
    timeoutMs: { type: 'integer' },
    headers: { type: 'object' },
    credentialRef: { type: ['string', 'null'] },
    recoveryPolicy: { type: 'object' },
    actor: { type: 'string', maxLength: 100 },
  },
};

const updateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    expectedVersion: { type: 'integer', minimum: 1 },
    baseUrl: { type: 'string', minLength: 1, maxLength: 500 },
    method: { type: 'string' },
    path: { type: 'string' },
    clientSchema: schemaObject,
    downstreamSchema: schemaObject,
    responseSchema: schemaObject,
    timeoutMs: { type: 'integer' },
    headers: { type: 'object' },
    credentialRef: { type: ['string', 'null'] },
    recoveryPolicy: { type: 'object' },
  },
};

const executeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    input: { type: 'object' },
    headers: { type: 'object' },
    idempotencyKey: { type: 'string', maxLength: 200 },
    actor: { type: 'string', maxLength: 100 },
  },
};

router.get('/', checkQuery(['page', 'pageSize']), async (req, res, next) => {
  try {
    forward(res, await callEngine({ method: 'GET', path: '/v1/tools', params: req.query }));
  } catch (err) { forwardError(res, next, err); }
});

router.post('/', validate(registerSchema), async (req, res, next) => {
  try {
    forward(res, await callEngine({ method: 'POST', path: '/v1/tools/register', data: req.body }));
  } catch (err) { forwardError(res, next, err); }
});

router.get('/:toolId', checkToolId, async (req, res, next) => {
  try {
    forward(res, await callEngine({ method: 'GET', path: `/v1/tools/${encodeURIComponent(req.params.toolId)}` }));
  } catch (err) { forwardError(res, next, err); }
});

router.patch('/:toolId', checkToolId, validate(updateSchema), async (req, res, next) => {
  try {
    forward(res, await callEngine({ method: 'PATCH', path: `/v1/tools/${encodeURIComponent(req.params.toolId)}`, data: req.body }));
  } catch (err) { forwardError(res, next, err); }
});

router.delete('/:toolId', checkToolId, async (req, res, next) => {
  try {
    forward(res, await callEngine({ method: 'DELETE', path: `/v1/tools/${encodeURIComponent(req.params.toolId)}` }));
  } catch (err) { forwardError(res, next, err); }
});

router.post('/:toolId/execute', checkToolId, validate(executeSchema), async (req, res, next) => {
  try {
    const data = { ...req.body };
    const idemHeader = req.get('x-idempotency-key');
    if (idemHeader && !data.idempotencyKey) data.idempotencyKey = idemHeader;
    forward(res, await callEngine({ method: 'POST', path: `/v1/tools/${encodeURIComponent(req.params.toolId)}/execute`, data }));
  } catch (err) { forwardError(res, next, err); }
});

module.exports = router;
