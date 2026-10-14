// Structured patch proposals. Only four operations are supported:
// RENAME_FIELD, MOVE_FIELD, CONVERT_TYPE, ADD_HEADER.
// An LLM may propose operations, but this module + patchManager validation and
// policy checks control application. Arbitrary values are never invented:
// header values must come from the tool's registered static headers.
const Ajv = require('ajv');

const ajv = new Ajv({ allErrors: true });

const OP_SCHEMAS = {
  RENAME_FIELD: {
    type: 'object', required: ['op', 'scope', 'from', 'to'], additionalProperties: false,
    properties: {
      op: { const: 'RENAME_FIELD' },
      scope: { enum: ['request', 'response'] },
      from: { type: 'string', minLength: 1, maxLength: 300 },
      to: { type: 'string', minLength: 1, maxLength: 300 },
    },
  },
  MOVE_FIELD: {
    type: 'object', required: ['op', 'scope', 'fromPath', 'toPath'], additionalProperties: false,
    properties: {
      op: { const: 'MOVE_FIELD' },
      scope: { enum: ['request', 'response'] },
      fromPath: { type: 'string', minLength: 1, maxLength: 300 },
      toPath: { type: 'string', minLength: 1, maxLength: 300 },
    },
  },
  CONVERT_TYPE: {
    type: 'object', required: ['op', 'scope', 'field', 'toType'], additionalProperties: false,
    properties: {
      op: { const: 'CONVERT_TYPE' },
      scope: { enum: ['request', 'response'] },
      field: { type: 'string', minLength: 1, maxLength: 300 },
      toType: { enum: ['string', 'number', 'integer', 'boolean'] },
    },
  },
  ADD_HEADER: {
    type: 'object', required: ['op', 'header', 'value'], additionalProperties: false,
    properties: {
      op: { const: 'ADD_HEADER' },
      header: { type: 'string', minLength: 1, maxLength: 200 },
      value: { type: 'string', minLength: 1, maxLength: 2000 },
    },
  },
};

const validators = Object.fromEntries(
  Object.entries(OP_SCHEMAS).map(([op, schema]) => [op, ajv.compile(schema)])
);

function validateOperation(op) {
  if (!op || typeof op !== 'object' || typeof op.op !== 'string' || !validators[op.op]) {
    const err = new Error(`Unsupported patch operation: ${op && op.op}`);
    err.status = 400;
    err.code = 'UNSUPPORTED_OPERATION';
    throw err;
  }
  const valid = validators[op.op](op);
  if (!valid) {
    const err = new Error(`Invalid ${op.op} operation`);
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    err.details = validators[op.op].errors;
    throw err;
  }
  if ((op.op === 'RENAME_FIELD' && op.from === op.to) ||
      (op.op === 'MOVE_FIELD' && op.fromPath === op.toPath)) {
    const err = new Error('Patch source and target must differ');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  return true;
}

// Build a proposal from a diagnosis. `tool` supplies registered static headers
// for ADD_HEADER (values never invented).
function planFromDiagnosis(diagnosis, tool) {
  if (!diagnosis || !diagnosis.supported) {
    return { supported: false, operations: [], reason: (diagnosis && diagnosis.reason) || 'No supported diagnosis.' };
  }
  if (diagnosis.kind === 'rename') {
    const op = { op: 'RENAME_FIELD', scope: diagnosis.evidence.scope || 'request', from: diagnosis.rename.from, to: diagnosis.rename.to };
    validateOperation(op);
    return { supported: true, operations: [op] };
  }
  if (diagnosis.kind === 'move') {
    const op = { op: 'MOVE_FIELD', scope: diagnosis.evidence.scope || 'request', fromPath: diagnosis.move.fromPath, toPath: diagnosis.move.toPath };
    validateOperation(op);
    return { supported: true, operations: [op] };
  }
  if (diagnosis.kind === 'convert') {
    const op = { op: 'CONVERT_TYPE', scope: diagnosis.evidence.scope || 'request', field: diagnosis.convert.field, toType: diagnosis.convert.toType };
    validateOperation(op);
    return { supported: true, operations: [op] };
  }
  if (diagnosis.kind === 'add_header') {
    const name = diagnosis.evidence.headerName;
    const configured = tool && tool.headers ? tool.headers[name] || tool.headers[name.toLowerCase()] : undefined;
    if (typeof configured !== 'string' || configured.length === 0) {
      return {
        supported: false,
        operations: [],
        reason: `Downstream requires header "${name}" but the tool registration configures no static value for it; refusing to invent one.`,
      };
    }
    const op = { op: 'ADD_HEADER', header: name, value: configured };
    validateOperation(op);
    return { supported: true, operations: [op] };
  }
  return { supported: false, operations: [], reason: `Unsupported diagnosis kind: ${diagnosis.kind}` };
}

module.exports = { validateOperation, planFromDiagnosis, SUPPORTED_OPS: Object.keys(OP_SCHEMAS) };
