const express = require('express');
const { query } = require('../db/pool');

const router = express.Router();

router.get('/health', async (req, res) => {
  let db = 'up';
  try {
    await query('SELECT 1');
  } catch (_) {
    db = 'down';
  }
  res.json({
    status: db === 'up' ? 'ok' : 'degraded',
    service: 'shastrastack-engine',
    db,
    time: new Date().toISOString(),
  });
});

router.get('/ready', async (req, res, next) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ready', db: 'up' });
  } catch (err) {
    err.status = 503;
    err.code = 'DB_UNAVAILABLE';
    next(err);
  }
});

module.exports = router;
