const express = require('express');
const { validate } = require('../middleware/validate');
const { buildResponse, BASE_SCHEMA } = require('../services/mockService');
const { listScenarios } = require('../mutations/driftScenarios');

const router = express.Router();

const chatSchema = {
  type: 'object',
  required: ['prompt'],
  additionalProperties: false,
  properties: {
    prompt: { type: 'string', minLength: 1, maxLength: 4000 },
    scenario: { type: 'string', maxLength: 50 },
  },
};

router.post('/chat', validate(chatSchema), (req, res, next) => {
  try {
    const { data } = buildResponse({ prompt: req.body.prompt, scenarioName: req.body.scenario || 'stable' });
    res.json({ data });
  } catch (err) { next(err); }
});

router.get('/schema', (req, res) => {
  res.json({ data: BASE_SCHEMA });
});

router.get('/scenarios', (req, res) => {
  res.json({ data: listScenarios() });
});

module.exports = router;
