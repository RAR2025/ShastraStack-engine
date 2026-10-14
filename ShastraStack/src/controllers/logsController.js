const metrics = require('../services/metricsService');
const audit = require('../services/auditLogger');
const { query } = require('../db/pool');

// GET /v1/logs: execution log listing with filters + pagination.
// ?kind=audit switches to the audit-event stream.
async function list(req, res, next) {
  try {
    if (req.query.kind === 'audit') {
      const out = await audit.listEvents({
        page: req.query.page, pageSize: req.query.pageSize,
        action: req.query.action, executionRef: req.query.executionId,
      });
      return res.json(out);
    }
    const out = await metrics.listExecutions({
      toolId: req.query.toolId, status: req.query.status,
      page: req.query.page, pageSize: req.query.pageSize,
    });
    return res.json(out);
  } catch (err) { next(err); }
}

// GET /v1/logs/:executionId: full execution trace (execution + audit + patches).
async function trace(req, res, next) {
  try {
    const id = String(req.params.executionId || '');
    if (!id || id.length > 100) {
      const err = new Error('Invalid executionId');
      err.status = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    const found = await metrics.getExecutionTrace(id);
    if (!found) {
      const err = new Error(`Execution not found: ${id}`);
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }
    // Never leak secret header values in traces (stored headers are static config only).
    return res.json({ data: found });
  } catch (err) { next(err); }
}

async function patchesForExecution(req, res, next) {
  try {
    const { rows } = await query(
      'SELECT patch_id, tool_ref, operations, diagnosis, status, adapter_version_before, adapter_version_after, downstream_version, error, created_at FROM patch_history WHERE execution_ref = $1 ORDER BY id ASC',
      [String(req.params.executionId || '')]
    );
    return res.json({ data: rows });
  } catch (err) { next(err); }
}

module.exports = { list, trace, patchesForExecution };
