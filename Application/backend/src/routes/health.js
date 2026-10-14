const express = require('express');
const { callEngine } = require('../engineClient');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'application-backend', time: new Date().toISOString() });
});

// Readiness checks the engine URL from env (configurable, never hardcoded)
// through the shared client so timeouts map consistently.
router.get('/ready', async (req, res, next) => {
  try {
    const r = await callEngine({ method: 'GET', path: '/health' });
    res.json({ status: 'ready', engine: r.body });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
