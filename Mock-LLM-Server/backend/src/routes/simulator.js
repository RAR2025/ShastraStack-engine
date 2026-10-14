// Safe dispatcher for configured mock business endpoints.
// Exact method+path matching only: no patterns, no traversal, no filesystem.
const Ajv = require('ajv');
const { state, logActivity } = require('../store');
const { findByRoute } = require('../services/endpointService');

const ajv = new Ajv({ allErrors: true, strict: false });

function getPathValue(obj, dotted) {
  return String(dotted).split('.').reduce((acc, k) => (acc && typeof acc === 'object' ? acc[k] : undefined), obj);
}

// Resolves "$body.a.b" / "$header.x-name" placeholders inside the configured
// response body. Anything else passes through untouched.
function renderTemplate(node, req) {
  if (typeof node === 'string') {
    if (node.startsWith('$body.')) {
      const v = getPathValue(req.body, node.slice(6));
      return v === undefined ? null : v;
    }
    if (node.startsWith('$header.')) {
      return req.get(node.slice(8)) || null;
    }
    return node;
  }
  if (Array.isArray(node)) return node.map((v) => renderTemplate(v, req));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, renderTemplate(v, req)]));
  }
  return node;
}

function missingHeader(req, requiredHeaders) {
  for (const name of requiredHeaders || []) {
    if (!req.get(name)) return name;
  }
  return null;
}

async function dispatch(req, res, next) {
  try {
    const rec = findByRoute(req.method, req.path);
    if (!rec) return next(); // not a simulated route -> 404 handler

    const started = Date.now();
    const fail = rec.failure || { mode: 'off' };

    // --- explicit failure injection first ---
    if (fail.mode === 'timeout') {
      await new Promise((r) => setTimeout(r, fail.delayMs || 2000));
      // fall through to the normal response after the delay
    } else if (fail.mode === 'auth') {
      logActivity({ type: 'mock_request', endpointId: rec.endpointId, appliedBy: 'simulator', summary: `${req.method} ${req.path} -> ${fail.status}` });
      return res.status(fail.status || 401).json(fail.body || { error: 'unauthorized (simulated)' });
    } else if (fail.mode === 'ratelimit') {
      logActivity({ type: 'mock_request', endpointId: rec.endpointId, appliedBy: 'simulator', summary: `${req.method} ${req.path} -> 429` });
      res.set('Retry-After', String(fail.retryAfterSec !== undefined ? fail.retryAfterSec : 2));
      return res.status(429).json(fail.body || { error: 'rate limit exceeded (simulated)' });
    } else if (fail.mode === 'server') {
      logActivity({ type: 'mock_request', endpointId: rec.endpointId, appliedBy: 'simulator', summary: `${req.method} ${req.path} -> ${fail.status}` });
      return res.status(fail.status || 500).json(fail.body || { error: 'upstream failure (simulated)' });
    }

    // --- required headers ---
    const missing = missingHeader(req, rec.requiredHeaders);
    if (missing) {
      logActivity({ type: 'mock_request', endpointId: rec.endpointId, appliedBy: 'simulator', summary: `${req.method} ${req.path} -> 400 missing header` });
      return res.status(400).json({
        error: {
          code: 'MISSING_HEADER',
          message: `missing required header: ${missing}`,
          details: [{ header: missing }],
        },
      });
    }

    // --- dynamic Ajv validation against the ACTIVE request schema ---
    let validateFn;
    try {
      validateFn = ajv.compile(rec.requestSchema);
    } catch (e) {
      return res.status(500).json({ error: { code: 'MOCK_SCHEMA_ERROR', message: `Stored mock schema is invalid: ${e.message}` } });
    }
    const body = req.method === 'GET' ? { ...req.query } : (req.body && typeof req.body === 'object' ? req.body : {});
    if (!validateFn(body)) {
      const details = (validateFn.errors || []).map((e) => ({
        path: e.instancePath || '/',
        keyword: e.keyword,
        message: e.message,
        params: e.params,
      }));
      // Realistic message naming the fields so blind detection has evidence.
      const extra = (validateFn.errors || []).find((e) => e.keyword === 'additionalProperties');
      const missingReq = (validateFn.errors || []).find((e) => e.keyword === 'required');
      const parts = [];
      if (extra && extra.params && extra.params.additionalProperty) {
        parts.push(`unknown field '${extra.params.additionalProperty}'`);
      }
      if (missingReq && missingReq.params && missingReq.params.missingProperty) {
        parts.push(`'${missingReq.params.missingProperty}' is required`);
      }
      logActivity({ type: 'mock_request', endpointId: rec.endpointId, appliedBy: 'simulator', summary: `${req.method} ${req.path} -> 400 validation` });
      return res.status(400).json({
        error: {
          code: 'REQUEST_VALIDATION_FAILED',
          message: `request validation failed${parts.length ? `: ${parts.join(', ')}` : ''}`,
          details,
        },
      });
    }

    const data = renderTemplate(rec.responseBody, { ...req, body });
    logActivity({
      type: 'mock_request', endpointId: rec.endpointId, appliedBy: 'simulator',
      summary: `${req.method} ${req.path} -> ${rec.responseStatus} (${Date.now() - started}ms)`,
    });
    return res.status(rec.responseStatus).json({ data });
  } catch (e) {
    return next(e);
  }
}

module.exports = { dispatch };
