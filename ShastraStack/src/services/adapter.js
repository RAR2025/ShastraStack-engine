// Deterministic adapter application. Pure functions only — no eval, no
// generated JavaScript. Operations are the four structured ops from patchPlanner.
const { getPath, setPath, deletePath, hasPath, deepClone } = require('../utils/paths');

function coerceValue(value, toType) {
  if (toType === 'string') {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    throw new Error(`Cannot convert ${typeof value} to string`);
  }
  if (toType === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) throw new Error(`Cannot convert to number: ${JSON.stringify(value)}`);
    return n;
  }
  if (toType === 'integer') {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(n)) throw new Error(`Cannot convert to integer: ${JSON.stringify(value)}`);
    return n;
  }
  if (toType === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`Cannot convert to boolean: ${JSON.stringify(value)}`);
  }
  throw new Error(`Unsupported target type: ${toType}`);
}

// Apply request/response-scoped ops to a payload clone.
function applyPayloadOperations(payload, operations, scope) {
  const out = deepClone(payload === undefined ? {} : payload);
  for (const op of operations || []) {
    if (op.op === 'ADD_HEADER') continue; // headers handled separately
    if (op.scope !== scope) continue;
    if (op.op === 'RENAME_FIELD') {
      if (hasPath(out, op.from)) {
        const v = getPath(out, op.from);
        deletePath(out, op.from);
        setPath(out, op.to, v);
      }
    } else if (op.op === 'MOVE_FIELD') {
      if (hasPath(out, op.fromPath)) {
        const v = getPath(out, op.fromPath);
        deletePath(out, op.fromPath);
        setPath(out, op.toPath, v);
      }
    } else if (op.op === 'CONVERT_TYPE') {
      if (hasPath(out, op.field)) {
        setPath(out, op.field, coerceValue(getPath(out, op.field), op.toType));
      }
    } else {
      throw new Error(`Unsupported operation in adapter: ${op.op}`);
    }
  }
  return out;
}

// Merge ADD_HEADER ops into a header map (header names lowercased for lookup,
// original casing preserved when set).
function applyHeaderOperations(baseHeaders, operations) {
  const out = { ...(baseHeaders || {}) };
  for (const op of operations || []) {
    if (op.op !== 'ADD_HEADER') continue;
    out[op.header] = op.value;
  }
  return out;
}

// Transform client input -> downstream request using active + candidate ops.
function adaptRequest(clientInput, activeOperations, candidateOperations) {
  return applyPayloadOperations(clientInput, [...(activeOperations || []), ...(candidateOperations || [])], 'request');
}

// Transform downstream response -> client-facing shape using response-scope ops.
function adaptResponse(downstreamBody, activeOperations, candidateOperations) {
  return applyPayloadOperations(downstreamBody, [...(activeOperations || []), ...(candidateOperations || [])], 'response');
}

module.exports = { applyPayloadOperations, applyHeaderOperations, adaptRequest, adaptResponse, coerceValue };
