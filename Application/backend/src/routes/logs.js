const express = require('express');
const { checkQuery, checkIdParam } = require('../middleware/queryAllowlist');
const { callEngine, forward, forwardError } = require('../engineClient');

const router = express.Router();

router.get('/', checkQuery(['kind', 'toolId', 'status', 'action', 'executionId', 'page', 'pageSize']), async (req, res, next) => {
  try {
    forward(res, await callEngine({ method: 'GET', path: '/v1/logs', params: req.query }));
  } catch (err) { forwardError(res, next, err); }
});

router.get('/:executionId', checkIdParam('executionId'), async (req, res, next) => {
  try {
    forward(res, await callEngine({ method: 'GET', path: `/v1/logs/${encodeURIComponent(req.params.executionId)}` }));
  } catch (err) { forwardError(res, next, err); }
});

module.exports = router;
