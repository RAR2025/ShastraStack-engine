const express = require('express');
const { callEngine } = require('../engineClient');

const router = express.Router();

// Aggregate engine health + recovery metrics for the judging dashboard.
// Both calls must succeed; a failed engine yields 503/504, never invented data.
router.get('/', async (req, res, next) => {
  try {
    const [health, metrics] = await Promise.all([
      callEngine({ method: 'GET', path: '/health' }),
      callEngine({ method: 'GET', path: '/v1/metrics/summary' }),
    ]);
    res.json({
      data: {
        engine: health.body,
        metrics: metrics.body && metrics.body.data !== undefined ? metrics.body.data : metrics.body,
        at: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
