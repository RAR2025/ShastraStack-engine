const express = require('express');
const { checkQuery } = require('../middleware/queryAllowlist');
const { callEngine, forward, forwardError } = require('../engineClient');

const router = express.Router();

router.get('/summary', checkQuery([]), async (req, res, next) => {
  try {
    forward(res, await callEngine({ method: 'GET', path: '/v1/metrics/summary' }));
  } catch (err) { forwardError(res, next, err); }
});

router.get('/executions', checkQuery(['toolId', 'status', 'page', 'pageSize']), async (req, res, next) => {
  try {
    forward(res, await callEngine({ method: 'GET', path: '/v1/metrics/executions', params: req.query }));
  } catch (err) { forwardError(res, next, err); }
});

module.exports = router;
