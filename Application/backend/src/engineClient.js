// Single Axios client for all ShastraStack Engine calls.
// Base URL + timeout come from env; errors are mapped centrally so routes can
// forward real engine responses without fabricating success data.
const axios = require('axios');

function engineBaseUrl() {
  return String(process.env.SHASTRASTACK_URL || 'http://localhost:4000').replace(/\/+$/, '');
}

function engineTimeoutMs() {
  const n = Number(process.env.ENGINE_TIMEOUT_MS || 15000);
  if (!Number.isFinite(n)) return 15000;
  return Math.min(Math.max(n, 1000), 120000);
}

let instance = null;
function http() {
  if (!instance) {
    instance = axios.create({ timeout: engineTimeoutMs() });
  }
  return instance;
}

function mapEngineError(err) {
  if (err && err.response) {
    const data = err.response.data;
    const e = new Error(
      (data && data.error && data.error.message) || `Engine request failed with status ${err.response.status}`
    );
    e.status = err.response.status;
    e.code = (data && data.error && data.error.code) || 'ENGINE_ERROR';
    e.details = data && data.error && data.error.details;
    e.engineBody = data; // lets routes forward the engine's exact shape
    throw e;
  }
  if (err && (err.code === 'ECONNABORTED' || /timeout/i.test(err.message || ''))) {
    const e = new Error(`Engine request timed out after ${engineTimeoutMs()}ms`);
    e.status = 504;
    e.code = 'ENGINE_TIMEOUT';
    throw e;
  }
  const e = new Error(`ShastraStack engine unreachable at ${engineBaseUrl()}`);
  e.status = 503;
  e.code = 'ENGINE_UNAVAILABLE';
  throw e;
}

// Returns { status, body } on success; throws a mapped error otherwise.
async function callEngine({ method, path, data, params }) {
  try {
    const res = await http().request({
      method,
      url: `${engineBaseUrl()}${path}`,
      data,
      params,
      timeout: engineTimeoutMs(),
    });
    return { status: res.status, body: res.data };
  } catch (err) {
    mapEngineError(err);
    throw err; // unreachable; keeps linters honest
  }
}

// Forward an engine result untouched (status + body), including 204 empties.
function forward(res, result) {
  if (result.status === 204 || result.body === undefined || result.body === null || result.body === '') {
    return res.status(result.status === 204 ? 204 : result.status).end();
  }
  return res.status(result.status).json(result.body);
}

// Forward a caught engine error preserving its exact body when available.
function forwardError(res, next, err) {
  if (err && err.engineBody !== undefined) {
    return res.status(err.status || 502).json(err.engineBody);
  }
  return next(err);
}

module.exports = { callEngine, forward, forwardError, engineBaseUrl, engineTimeoutMs, _mapEngineError: mapEngineError };
