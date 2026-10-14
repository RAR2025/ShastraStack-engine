const express = require('express');
const { validate } = require('../middleware/validate');
const { isValidToolId } = require('../utils/ids');
const ctrl = require('../controllers/toolsController');

const router = express.Router();

function checkToolId(req, res, next) {
  if (!isValidToolId(req.params.toolId)) {
    const err = new Error('Invalid toolId; must match ^[a-z0-9][a-z0-9-_]{0,63}$');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    return next(err);
  }
  return next();
}

const schemaObject = { type: 'object' };

const registerSchema = {
  type: 'object',
  required: ['toolId', 'baseUrl'],
  additionalProperties: true,
  properties: {
    toolId: { type: 'string', minLength: 1, maxLength: 64 },
    baseUrl: { type: 'string', minLength: 1, maxLength: 500 },
    method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
    path: { type: 'string', minLength: 1, maxLength: 500 },
    clientSchema: schemaObject,
    downstreamSchema: schemaObject,
    responseSchema: schemaObject,
    timeoutMs: { type: 'integer', minimum: 100, maximum: 120000 },
    headers: { type: 'object' },
    credentialRef: { type: ['string', 'null'] },
    recoveryPolicy: {
      type: 'object',
      properties: {
        maxRetries: { type: 'integer', minimum: 0, maximum: 1 },
        allowAutomaticPatch: { type: 'boolean' },
        duplicateProtectionMechanism: { type: 'string', maxLength: 200 },
      },
      additionalProperties: true,
    },
    actor: { type: 'string', maxLength: 100 },
  },
};

const updateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    expectedVersion: { type: 'integer', minimum: 1 },
    baseUrl: { type: 'string', minLength: 1, maxLength: 500 },
    method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
    path: { type: 'string', minLength: 1, maxLength: 500 },
    clientSchema: schemaObject,
    downstreamSchema: schemaObject,
    responseSchema: schemaObject,
    timeoutMs: { type: 'integer', minimum: 100, maximum: 120000 },
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

const schemaUpdateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    downstreamSchema: schemaObject,
    responseSchema: schemaObject,
    expectedDownstreamVersion: { type: 'integer', minimum: 1 },
    actor: { type: 'string', maxLength: 100 },
  },
};

router.post('/register', validate(registerSchema), ctrl.register);
router.get('/', ctrl.list);
router.get('/:toolId', checkToolId, ctrl.get);
router.patch('/:toolId', checkToolId, validate(updateSchema), ctrl.patch);
router.delete('/:toolId', checkToolId, ctrl.remove);
router.post('/:toolId/execute', checkToolId, validate(executeSchema), ctrl.execute);
router.post('/:toolId/schema', checkToolId, validate(schemaUpdateSchema), ctrl.updateSchema);

module.exports = router;
