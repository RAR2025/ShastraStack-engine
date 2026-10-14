const { randomUUID } = require('crypto');

const TOOL_ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;

function isValidToolId(value) {
  return typeof value === 'string' && TOOL_ID_RE.test(value);
}

function newExecutionId() {
  return `ex_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function newPatchId() {
  return `pt_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function newEventId() {
  return `ev_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

module.exports = { TOOL_ID_RE, isValidToolId, newExecutionId, newPatchId, newEventId };
