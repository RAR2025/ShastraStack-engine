// Explicit, resettable failure injection for judging recovery behavior.
// These are TEST SIMULATIONS, not real security behavior. Every mode is set by
// a judge action, visible in activity, and cleared by reset.
const { getRecord } = require('./endpointService');
const { logActivity } = require('../store');

const MODES = new Set(['off', 'auth', 'ratelimit', 'timeout', 'server']);

function err(status, code, message, details) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  if (details) e.details = details;
  return e;
}

function setFailure(endpointId, cfg = {}, appliedBy = 'judge') {
  const rec = getRecord(endpointId);
  if (!rec) return null;
  const { mode = 'off' } = cfg;
  if (!MODES.has(mode)) throw err(400, 'VALIDATION_ERROR', `mode must be one of ${[...MODES].join(', ')}`);
  const failure = { mode };
  if (mode === 'auth') {
    failure.status = cfg.status === 403 ? 403 : 401;
    failure.body = { error: 'invalid or missing api key (simulated)' };
  } else if (mode === 'ratelimit') {
    failure.status = 429;
    failure.retryAfterSec = Number.isInteger(cfg.retryAfterSec) && cfg.retryAfterSec >= 0 ? Math.min(cfg.retryAfterSec, 3600) : 2;
    failure.body = { error: 'rate limit exceeded (simulated)' };
  } else if (mode === 'timeout') {
    failure.delayMs = Number.isInteger(cfg.delayMs) && cfg.delayMs > 0 ? Math.min(cfg.delayMs, 30000) : 2000;
  } else if (mode === 'server') {
    failure.status = cfg.status && cfg.status >= 500 && cfg.status <= 599 ? cfg.status : 500;
    failure.body = { error: 'upstream failure (simulated)' };
  }
  rec.failure = failure;
  rec.updatedAt = new Date().toISOString();
  logActivity({ type: 'failure_configured', endpointId, appliedBy, summary: `mode=${mode}` });
  return { ...failure };
}

function getFailure(endpointId) {
  const rec = getRecord(endpointId);
  return rec ? { ...rec.failure } : null;
}

module.exports = { setFailure, getFailure, FAILURE_MODES: [...MODES] };
