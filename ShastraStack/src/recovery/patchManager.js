// Patch lifecycle: validate proposals, apply candidates in memory, commit only
// on verified retry success, otherwise roll back and record the failure.
// Persistence uses parameterized SQL; secrets are never written to patch rows.
const { query } = require('../db/pool');
const { newPatchId } = require('../utils/ids');
const { validateOperation } = require('./patchPlanner');
const registry = require('../services/toolRegistry');
const { logEvent } = require('../services/auditLogger');

// Best-effort lifecycle emission. Never throws: audit transport must not break
// patch decisions. Each call generates its own eventId exactly once.
async function emitLifecycle(eventType, { toolId, executionRef, data } = {}) {
  try {
    await logEvent({ eventType, toolId, executionRef, metadata: data || {} });
  } catch (_) { /* audit must not break patch decisions */ }
}

const SECRET_VALUE_RE = /bearer\s+[A-Za-z0-9\-._~+/=]+|sk-[A-Za-z0-9]+|secret|password/i;

function assertProposalValid(operations) {
  if (!Array.isArray(operations) || operations.length === 0) {
    const err = new Error('Patch proposal must be a non-empty operations array');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  if (operations.length > 5) {
    const err = new Error('Patch proposal exceeds MVP limit of 5 operations');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  for (const op of operations) {
    validateOperation(op);
    if (op.op === 'ADD_HEADER' && SECRET_VALUE_RE.test(op.value || '')) {
      const err = new Error(`Refusing to persist secret-looking header value for "${op.header}"`);
      err.status = 400;
      err.code = 'SECRET_VALUE_REJECTED';
      throw err;
    }
  }
  return true;
}

async function recordPatch({
  toolRef, executionRef, diagnosis = {}, operations = [], status,
  adapterVersionBefore = null, adapterVersionAfter = null, downstreamVersion = null, error = null,
}) {
  const patchId = newPatchId();
  await query(
    `INSERT INTO patch_history
       (patch_id, tool_id, tool_ref, execution_id, execution_ref, diagnosis, patch, operations,
        applied, status, adapter_version_before, adapter_version_after, downstream_version, error)
     VALUES ($1, NULL, $2, NULL, $3, $4::jsonb, $5::jsonb, $5::jsonb,
       $6, $7, $8, $9, $10, $11)`,
    [
      patchId, toolRef, executionRef,
      JSON.stringify(diagnosis || {}), JSON.stringify(operations || []),
      status === 'committed', status,
      adapterVersionBefore, adapterVersionAfter, downstreamVersion, error,
    ]
  );
  return patchId;
}

// Commit verified operations: bump adapter version durably + refresh cache.
async function commitPatch({ toolId, operations, executionRef, diagnosis, expectedVersion, downstreamVersion }) {
  await emitLifecycle('patch.proposed', { toolId, executionRef, data: { opCount: operations.length } });
  assertProposalValid(operations);
  await emitLifecycle('patch.validated', { toolId, executionRef, data: { opCount: operations.length } });
  const before = await registry.getTool(toolId);
  if (!before) {
    const err = new Error(`Tool not found: ${toolId}`);
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }
  const updated = await registry.commitAdapterOperations(toolId, operations, expectedVersion);
  await emitLifecycle('patch.applied', {
    toolId, executionRef,
    data: { adapterVersionBefore: before.version, adapterVersionAfter: updated.version },
  });
  const patchId = await recordPatch({
    toolRef: toolId,
    executionRef,
    diagnosis,
    operations,
    status: 'committed',
    adapterVersionBefore: before.version,
    adapterVersionAfter: updated.version,
    downstreamVersion: downstreamVersion !== undefined ? downstreamVersion : updated.downstreamVersion,
  });
  await emitLifecycle('patch.verified', {
    toolId, executionRef,
    data: { patchId, adapterVersionAfter: updated.version },
  });
  return { patchId, tool: updated };
}

async function recordRollback({ toolId, executionRef, diagnosis, operations, downstreamVersion, error }) {
  const before = await registry.getTool(toolId).catch(() => null);
  await emitLifecycle('patch.rolled_back', {
    toolId, executionRef,
    data: { error: String(error || 'rolled back').slice(0, 500) },
  });
  return recordPatch({
    toolRef: toolId,
    executionRef,
    diagnosis,
    operations,
    status: 'rolled_back',
    adapterVersionBefore: before ? before.version : null,
    adapterVersionAfter: before ? before.version : null,
    downstreamVersion: downstreamVersion !== undefined ? downstreamVersion : (before ? before.downstreamVersion : null),
    error,
  });
}

module.exports = { assertProposalValid, recordPatch, commitPatch, recordRollback };
