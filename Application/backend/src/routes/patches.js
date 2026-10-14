const express = require('express');
const { checkQuery, checkIdParam } = require('../middleware/queryAllowlist');
const { callEngine, forward, forwardError } = require('../engineClient');

const router = express.Router();

router.get('/', checkQuery(['toolId', 'status', 'page', 'pageSize']), async (req, res, next) => {
  try {
    forward(res, await callEngine({ method: 'GET', path: '/v1/patches', params: req.query }));
  } catch (err) { forwardError(res, next, err); }
});

router.get('/:patchId', checkIdParam('patchId'), async (req, res, next) => {
  try {
    forward(res, await callEngine({ method: 'GET', path: `/v1/patches/${encodeURIComponent(req.params.patchId)}` }));
  } catch (err) { forwardError(res, next, err); }
});

module.exports = router;
