const express = require('express');
const { callEngine, forward, forwardError } = require('../engineClient');

const router = express.Router();

router.get('/health', async (req, res, next) => {
  try {
    forward(res, await callEngine({ method: 'GET', path: '/health' }));
  } catch (err) { forwardError(res, next, err); }
});

module.exports = router;
