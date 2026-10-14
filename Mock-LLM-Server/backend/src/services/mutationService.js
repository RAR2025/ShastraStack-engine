// Runtime contract mutations. Every mutation is validated BEFORE activation,
// versioned, applied immediately in memory, and recorded with actor + timestamp.
// Baseline schemas are never overwritten except by endpoint reconfiguration;
// reset restores them deterministically.
const Ajv = require('ajv');
const { state, clone, logActivity } = require('../store');
const { getRecord, assertSchemaObject } = require('./endpointService');

const ajv = new Ajv({ allErrors: true, strict: false });

const OPS = new Set([
  'RENAME_FIELD', 'MOVE_FIELD', 'CONVERT_TYPE',
  'ADD_REQUIRED_FIELD', 'ADD_HEADER', 'CHANGE_RESPONSE_SCHEMA',
]);

function err(status, code, message, details) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  if (details) e.details = details;
  return e;
}

function propsOf(schema) {
  return schema && typeof schema === 'object' && schema.properties && typeof schema.properties === 'object'
    ? schema.properties
    : {};
}

function assertCompiles(schema) {
  try {
    ajv.compile(schema);
  } catch (e) {
    throw err(400, 'INVALID_SCHEMA', `Mutation would leave an uncompilable schema: ${e.message}`);
  }
}

function parseFieldRef(ref) {
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > 200) {
    throw err(400, 'VALIDATION_ERROR', 'Field reference must be a non-empty string <= 200 chars');
  }
  if (ref.includes('..') || ref.includes('__proto__') || ref.includes('constructor') || ref.includes('prototype')) {
    throw err(400, 'UNSAFE_PATH', 'Field reference uses a forbidden segment');
  }
  return ref.split('.').filter(Boolean);
}

function parentOf(schema, parts, create) {
  let node = schema;
  for (const p of parts) {
    if (!node.properties || typeof node.properties !== 'object') node.properties = {};
    if (!node.properties[p]) {
      if (!create) return null;
      node.properties[p] = { type: 'object', properties: {} };
    }
    node = node.properties[p];
    if (typeof node !== 'object' || node === null) return null;
  }
  if (!node.properties || typeof node.properties !== 'object') {
    if (!create) return null;
    node.properties = {};
  }
  return node;
}

function removeRequired(schema, field) {
  if (Array.isArray(schema.required)) {
    schema.required = schema.required.filter((r) => r !== field);
  }
}

function applyRename(schema, from, to) {
  const fromParts = parseFieldRef(from);
  const toParts = parseFieldRef(to);
  const fromParent = parentOf(schema, fromParts.slice(0, -1), false);
  const fromLeaf = fromParts[fromParts.length - 1];
  if (!fromParent || !fromParent.properties || !Object.prototype.hasOwnProperty.call(fromParent.properties, fromLeaf)) {
    throw err(400, 'UNKNOWN_FIELD', `Cannot rename: '${from}' does not exist in the active schema`);
  }
  const toParent = parentOf(schema, toParts.slice(0, -1), false);
  const toLeaf = toParts[toParts.length - 1];
  if (!toParent) throw err(400, 'VALIDATION_ERROR', `Cannot rename: target parent of '${to}' does not exist (use MOVE_FIELD across objects)`);
  if (Object.prototype.hasOwnProperty.call(toParent.properties, toLeaf)) {
    throw err(400, 'FIELD_EXISTS', `Cannot rename: '${to}' already exists in the active schema`);
  }
  toParent.properties[toLeaf] = fromParent.properties[fromLeaf];
  delete fromParent.properties[fromLeaf];
  if (Array.isArray(fromParent.required)) {
    const i = fromParent.required.indexOf(fromLeaf);
    if (i >= 0) fromParent.required[i] = toLeaf;
  }
}

function applyMove(schema, fromPath, toPath) {
  const fromParts = parseFieldRef(fromPath);
  const toParts = parseFieldRef(toPath);
  const fromParent = parentOf(schema, fromParts.slice(0, -1), false);
  const fromLeaf = fromParts[fromParts.length - 1];
  if (!fromParent || !fromParent.properties || !Object.prototype.hasOwnProperty.call(fromParent.properties, fromLeaf)) {
    throw err(400, 'UNKNOWN_FIELD', `Cannot move: '${fromPath}' does not exist in the active schema`);
  }
  const toParent = parentOf(schema, toParts.slice(0, -1), true);
  const toLeaf = toParts[toParts.length - 1];
  if (Object.prototype.hasOwnProperty.call(toParent.properties, toLeaf)) {
    throw err(400, 'FIELD_EXISTS', `Cannot move: '${toPath}' already exists in the active schema`);
  }
  toParent.properties[toLeaf] = fromParent.properties[fromLeaf];
  delete fromParent.properties[fromLeaf];
  removeRequired(fromParent, fromLeaf);
  if (toParent.required === undefined && toParent !== schema) toParent.required = [toLeaf];
  else if (Array.isArray(toParent.required) && !toParent.required.includes(toLeaf)) toParent.required.push(toLeaf);
}

function applyConvert(schema, field, toType) {
  const allowed = new Set(['string', 'number', 'integer', 'boolean']);
  if (!allowed.has(toType)) throw err(400, 'VALIDATION_ERROR', `toType must be one of ${[...allowed].join(', ')}`);
  const parts = parseFieldRef(field);
  const parent = parentOf(schema, parts.slice(0, -1), false);
  const leaf = parts[parts.length - 1];
  if (!parent || !parent.properties || !Object.prototype.hasOwnProperty.call(parent.properties, leaf)) {
    throw err(400, 'UNKNOWN_FIELD', `Cannot convert: '${field}' does not exist in the active schema`);
  }
  parent.properties[leaf] = { ...(typeof parent.properties[leaf] === 'object' ? parent.properties[leaf] : {}), type: toType };
}

function applyAddRequired(schema, field, fieldSchema) {
  const parts = parseFieldRef(field);
  if (parts.length !== 1) throw err(400, 'VALIDATION_ERROR', 'ADD_REQUIRED_FIELD supports top-level fields only in this MVP');
  const leaf = parts[0];
  if (propsOf(schema)[leaf]) throw err(400, 'FIELD_EXISTS', `Cannot add: '${leaf}' already exists in the active schema`);
  if (fieldSchema !== undefined) {
    if (typeof fieldSchema !== 'object' || fieldSchema === null || Array.isArray(fieldSchema)) {
      throw err(400, 'VALIDATION_ERROR', 'fieldSchema must be a JSON Schema object');
    }
    try {
      ajv.compile({ type: 'object', properties: { [leaf]: fieldSchema } });
    } catch (e) {
      throw err(400, 'INVALID_SCHEMA', `fieldSchema is not compilable: ${e.message}`);
    }
  }
  schema.properties = schema.properties || {};
  schema.properties[leaf] = fieldSchema ? clone(fieldSchema) : { type: 'string' };
  schema.required = Array.isArray(schema.required) ? [...schema.required, leaf] : [leaf];
}

// Applies one mutation op to a cloned schema set; returns the mutated {requestSchema, responseSchema}.
function buildMutated(rec, op, args) {
  const working = { requestSchema: clone(rec.requestSchema), responseSchema: clone(rec.responseSchema) };
  const scope = args.scope || 'request';
  if (!['request', 'response'].includes(scope) && op !== 'ADD_HEADER' && op !== 'CHANGE_RESPONSE_SCHEMA') {
    throw err(400, 'VALIDATION_ERROR', "scope must be 'request' or 'response'");
  }
  switch (op) {
    case 'RENAME_FIELD': {
      if (!args.from || !args.to) throw err(400, 'VALIDATION_ERROR', 'RENAME_FIELD requires from and to');
      const target = scope === 'request' ? working.requestSchema : working.responseSchema;
      applyRename(target, args.from, args.to);
      break;
    }
    case 'MOVE_FIELD': {
      if (!args.fromPath || !args.toPath) throw err(400, 'VALIDATION_ERROR', 'MOVE_FIELD requires fromPath and toPath');
      const target = scope === 'request' ? working.requestSchema : working.responseSchema;
      applyMove(target, args.fromPath, args.toPath);
      break;
    }
    case 'CONVERT_TYPE': {
      if (!args.field || !args.toType) throw err(400, 'VALIDATION_ERROR', 'CONVERT_TYPE requires field and toType');
      const target = scope === 'request' ? working.requestSchema : working.responseSchema;
      applyConvert(target, args.field, args.toType);
      break;
    }
    case 'ADD_REQUIRED_FIELD': {
      if (!args.field) throw err(400, 'VALIDATION_ERROR', 'ADD_REQUIRED_FIELD requires field');
      const target = scope === 'request' ? working.requestSchema : working.responseSchema;
      applyAddRequired(target, args.field, args.fieldSchema);
      break;
    }
    case 'ADD_HEADER': {
      if (!args.header || typeof args.header !== 'string') throw err(400, 'VALIDATION_ERROR', 'ADD_HEADER requires header');
      const name = args.header;
      if (rec.requiredHeaders.map((h) => h.toLowerCase()).includes(name.toLowerCase())) {
        throw err(400, 'FIELD_EXISTS', `Header '${name}' is already required`);
      }
      break;
    }
    case 'CHANGE_RESPONSE_SCHEMA': {
      if (!args.responseSchema) throw err(400, 'VALIDATION_ERROR', 'CHANGE_RESPONSE_SCHEMA requires responseSchema');
      assertSchemaObject(args.responseSchema, 'responseSchema');
      working.responseSchema = clone(args.responseSchema);
      break;
    }
    default:
      throw err(400, 'UNSUPPORTED_OPERATION', `Unsupported mutation op: ${op}`);
  }
  assertCompiles(working.requestSchema);
  assertCompiles(working.responseSchema);
  return working;
}

function applyMutation(endpointId, { op, scope, from, to, fromPath, toPath, field, toType, fieldSchema, header, responseSchema, appliedBy = 'judge', scenarioId = null }) {
  if (!op || !OPS.has(op)) throw err(400, 'UNSUPPORTED_OPERATION', `op must be one of ${[...OPS].join(', ')}`);
  const rec = getRecord(endpointId);
  if (!rec) return null;
  const args = { scope, from, to, fromPath, toPath, field, toType, fieldSchema, header, responseSchema };
  Object.keys(args).forEach((k) => args[k] === undefined && delete args[k]);
  const prevVersion = rec.schemaVersion;
  const working = buildMutated(rec, op, args); // throws before any state change
  rec.requestSchema = working.requestSchema;
  rec.responseSchema = working.responseSchema;
  if (op === 'ADD_HEADER') rec.requiredHeaders = [...rec.requiredHeaders, args.header];
  rec.schemaVersion += 1;
  rec.updatedAt = new Date().toISOString();
  const entry = {
    mutationId: `mut_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`,
    endpointId, op, args, prevVersion, newVersion: rec.schemaVersion,
    appliedBy, appliedAt: new Date().toISOString(), scenarioId,
  };
  state.mutations.unshift(entry);
  logActivity({ type: 'mutation_applied', endpointId, appliedBy, summary: `${op} v${prevVersion} -> v${rec.schemaVersion}${scenarioId ? ` (${scenarioId})` : ''}` });
  return entry;
}

function listMutations({ endpointId, limit = 50 } = {}) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const all = endpointId ? state.mutations.filter((m) => m.endpointId === endpointId) : state.mutations;
  return all.slice(0, n);
}

module.exports = { applyMutation, listMutations, SUPPORTED_OPS: [...OPS] };
