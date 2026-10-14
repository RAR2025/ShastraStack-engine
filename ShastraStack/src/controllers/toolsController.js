const registry = require('../services/toolRegistry');
const { executeTool } = require('../services/requestExecutor');
const { logEvent } = require('../services/auditLogger');

async function register(req, res, next) {
  try {
    const tool = await registry.registerTool(req.body);
    try {
      await logEvent({ actor: req.body.actor || 'api', action: 'tool.register', entity: 'tool', entity_id: tool.toolId, metadata: { version: tool.version } });
    } catch (_) { /* audit must not break registration */ }
    res.status(201).json({ data: tool });
  } catch (err) { next(err); }
}

async function list(req, res, next) {
  try {
    res.json(await registry.listTools({ page: req.query.page, pageSize: req.query.pageSize }));
  } catch (err) { next(err); }
}

async function get(req, res, next) {
  try {
    const tool = await registry.getTool(req.params.toolId);
    if (!tool) {
      const err = new Error(`Tool not found: ${req.params.toolId}`);
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }
    res.json({ data: tool });
  } catch (err) { next(err); }
}

async function patch(req, res, next) {
  try {
    const { expectedVersion, ...changes } = req.body || {};
    const tool = await registry.updateTool(req.params.toolId, changes, expectedVersion);
    if (!tool) {
      const err = new Error(`Tool not found: ${req.params.toolId}`);
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }
    try {
      await logEvent({ actor: 'api', action: 'tool.update', entity: 'tool', entity_id: tool.toolId, metadata: { version: tool.version } });
    } catch (_) { /* ignore */ }
    res.json({ data: tool });
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    const ok = await registry.deleteTool(req.params.toolId);
    if (!ok) {
      const err = new Error(`Tool not found: ${req.params.toolId}`);
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }
    res.status(204).end();
  } catch (err) { next(err); }
}

async function execute(req, res, next) {
  try {
    const result = await executeTool({
      toolId: req.params.toolId,
      input: req.body.input !== undefined ? req.body.input : {},
      headers: req.body.headers || {},
      idempotencyKey: req.body.idempotencyKey || req.get('x-idempotency-key') || null,
      actor: req.body.actor || 'client',
    });
    if (result.status === 'client_error') {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: result.error, details: result.details || [] }, executionId: result.executionId });
    }
    if (result.status === 'failed') {
      return res.status(502).json({
        error: { code: result.classification || 'EXECUTION_FAILED', message: result.error },
        executionId: result.executionId,
        classification: result.classification,
        downstreamStatus: result.downstreamStatus ?? null,
        downstreamBody: result.downstreamBody ?? null,
        retryAfterMs: result.retryAfterMs ?? null,
      });
    }
    // success | recovered
    const body = { data: result.data, executionId: result.executionId, status: result.status, durationMs: result.durationMs };
    if (result.status === 'recovered') body.recovery = result.recovery;
    if (result.classification) body.classification = result.classification;
    return res.json(body);
  } catch (err) { next(err); }
}

// Informed mode: authorized caller supplies the new known downstream schema.
async function updateSchema(req, res, next) {
  try {
    const tool = await registry.updateDownstreamSchema(req.params.toolId, {
      downstreamSchema: req.body.downstreamSchema,
      responseSchema: req.body.responseSchema,
      expectedDownstreamVersion: req.body.expectedDownstreamVersion,
    });
    if (!tool) {
      const err = new Error(`Tool not found: ${req.params.toolId}`);
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }
    try {
      await logEvent({
        actor: req.body.actor || 'api', action: 'tool.schema_update', entity: 'tool',
        entity_id: tool.toolId, metadata: { downstreamVersion: tool.downstreamVersion },
      });
    } catch (_) { /* ignore */ }
    res.json({ data: tool });
  } catch (err) { next(err); }
}

module.exports = { register, list, get, patch, remove, execute, updateSchema };
