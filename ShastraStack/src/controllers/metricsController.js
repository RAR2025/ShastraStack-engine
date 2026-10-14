const metrics = require('../services/metricsService');

async function summary(req, res, next) {
  try {
    res.json({ data: await metrics.getSummary() });
  } catch (err) {
    err.status = err.status || 503;
    err.code = err.code || 'DB_UNAVAILABLE';
    next(err);
  }
}

async function executions(req, res, next) {
  try {
    res.json(await metrics.listExecutions({
      toolId: req.query.toolId, status: req.query.status,
      page: req.query.page, pageSize: req.query.pageSize,
    }));
  } catch (err) {
    err.status = err.status || 503;
    err.code = err.code || 'DB_UNAVAILABLE';
    next(err);
  }
}

module.exports = { summary, executions };
