// Dynamic mock endpoint CRUD with strict route safety and version checking.
const Ajv = require('ajv');
const { state, clone, logActivity, toPublicEndpoint } = require('../store');

const ajv = new Ajv({ allErrors: true, strict: false });

const ENDPOINT_ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
// Simulated business routes only: must live under /api/ but never under /api/admin.
const PATH_RE = /^\/api\/[A-Za-z0-9/_-]{0,180}$/;

function err(status, code, message, details) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  if (details) e.details = details;
  return e;
}

function assertEndpointId(id) {
  if (typeof id !== 'string' || !ENDPOINT_ID_RE.test(id)) {
    throw err(400, 'VALIDATION_ERROR', 'endpointId must match ^[a-z0-9][a-z0-9-_]{0,63}$', [{ path: '/endpointId' }]);
  }
}

function assertSafePath(path) {
  if (typeof path !== 'string' || !PATH_RE.test(path)) {
    throw err(400, 'VALIDATION_ERROR', 'path must match ^/api/[A-Za-z0-9/_-]* (max ~185 chars)', [{ path: '/path' }]);
  }
  if (path.includes('..') || path.includes('\\') || path.includes(':') || path.includes('//')) {
    throw err(400, 'UNSAFE_PATH', 'path must not contain .., backslashes, colons, or empty segments', [{ path: '/path' }]);
  }
  if (path === '/api' || path === '/api/' || path.startsWith('/api/admin')) {
    throw err(400, 'RESERVED_PATH', 'path under /api/admin is reserved for administration', [{ path: '/path' }]);
  }
  if (['/api/chat', '/api/schema', '/api/scenarios'].includes(path)) {
    throw err(400, 'RESERVED_PATH', 'path collides with a built-in demo route', [{ path: '/path' }]);
  }
}

function assertSchemaObject(value, name) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw err(400, 'VALIDATION_ERROR', `${name} must be a JSON Schema object`, [{ path: `/${name}` }]);
  }
  if (value.type !== undefined && value.type !== 'object') {
    throw err(400, 'VALIDATION_ERROR', `${name}.type must be "object" for mock endpoints`, [{ path: `/${name}/type` }]);
  }
  try {
    ajv.compile(value);
  } catch (e) {
    throw err(400, 'INVALID_SCHEMA', `${name} is not a compilable JSON Schema: ${e.message}`, [{ path: `/${name}` }]);
  }
}

function assertStatus(status) {
  if (!Number.isInteger(status) || status < 200 || status > 599) {
    throw err(400, 'VALIDATION_ERROR', 'responseStatus must be an integer 200-599', [{ path: '/responseStatus' }]);
  }
}

function assertHeaders(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.some((h) => typeof h !== 'string' || h.length === 0 || h.length > 100)) {
    throw err(400, 'VALIDATION_ERROR', 'requiredHeaders must be an array of header-name strings', [{ path: '/requiredHeaders' }]);
  }
  const lowered = list.map((h) => h.toLowerCase());
  if (new Set(lowered).size !== lowered.length) {
    throw err(400, 'VALIDATION_ERROR', 'requiredHeaders must not contain duplicates', [{ path: '/requiredHeaders' }]);
  }
  return [...list];
}

function findByRoute(method, path) {
  for (const rec of state.endpoints.values()) {
    if (rec.method === method && rec.path === path) return rec;
  }
  return null;
}

function createEndpoint(body, appliedBy = 'judge') {
  const { endpointId, method = 'POST', path, requestSchema, responseSchema } = body || {};
  assertEndpointId(endpointId);
  if (state.endpoints.has(endpointId)) throw err(409, 'ENDPOINT_EXISTS', `Endpoint already configured: ${endpointId}`);
  if (!METHODS.has(String(method).toUpperCase())) throw err(400, 'VALIDATION_ERROR', 'method must be GET, POST, PUT, PATCH, or DELETE');
  assertSafePath(path);
  assertSchemaObject(requestSchema, 'requestSchema');
  assertSchemaObject(responseSchema || { type: 'object' }, 'responseSchema');
  if (body.responseStatus !== undefined) assertStatus(body.responseStatus);
  if (body.responseBody !== undefined && (typeof body.responseBody !== 'object' || body.responseBody === null)) {
    throw err(400, 'VALIDATION_ERROR', 'responseBody must be a JSON object', [{ path: '/responseBody' }]);
  }
  if (findByRoute(String(method).toUpperCase(), path)) {
    throw err(409, 'ROUTE_CONFLICT', `Another endpoint already simulates ${String(method).toUpperCase()} ${path}`);
  }
  const now = new Date().toISOString();
  const rec = {
    endpointId,
    method: String(method).toUpperCase(),
    path,
    requestSchema: clone(requestSchema),
    responseSchema: clone(responseSchema || { type: 'object' }),
    responseStatus: body.responseStatus !== undefined ? body.responseStatus : 200,
    responseBody: body.responseBody !== undefined ? clone(body.responseBody) : {},
    requiredHeaders: assertHeaders(body.requiredHeaders),
    failure: { mode: 'off' },
    baseline: clone({
      requestSchema, responseSchema: responseSchema || { type: 'object' },
      responseStatus: body.responseStatus !== undefined ? body.responseStatus : 200,
      responseBody: body.responseBody !== undefined ? body.responseBody : {},
      requiredHeaders: body.requiredHeaders || [],
    }),
    version: 1,
    schemaVersion: 1,
    baselineVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
  state.endpoints.set(endpointId, rec);
  logActivity({ type: 'endpoint_created', endpointId, appliedBy, summary: `${rec.method} ${rec.path}` });
  return toPublicEndpoint(rec);
}

function listEndpoints() {
  return [...state.endpoints.values()].map(toPublicEndpoint).sort((a, b) => a.endpointId.localeCompare(b.endpointId));
}

function getEndpoint(endpointId) {
  assertEndpointId(endpointId);
  const rec = state.endpoints.get(endpointId);
  return rec ? toPublicEndpoint(rec) : null;
}

function getRecord(endpointId) {
  assertEndpointId(endpointId);
  return state.endpoints.get(endpointId) || null;
}

function updateEndpoint(endpointId, changes, appliedBy = 'judge') {
  const rec = getRecord(endpointId);
  if (!rec) return null;
  const { expectedVersion, ...rest } = changes || {};
  if (expectedVersion !== undefined && Number(expectedVersion) !== rec.version) {
    throw err(409, 'VERSION_CONFLICT', `Version conflict: expected ${expectedVersion} but current is ${rec.version}`);
  }
  const allowed = new Set(['method', 'path', 'requestSchema', 'responseSchema', 'responseStatus', 'responseBody', 'requiredHeaders']);
  const keys = Object.keys(rest);
  if (keys.length === 0) throw err(400, 'VALIDATION_ERROR', 'No updatable fields supplied');
  for (const k of keys) {
    if (!allowed.has(k)) throw err(400, 'VALIDATION_ERROR', `Field not updatable: ${k}`, [{ path: `/${k}` }]);
  }
  if (rest.method !== undefined && !METHODS.has(String(rest.method).toUpperCase())) {
    throw err(400, 'VALIDATION_ERROR', 'method must be GET, POST, PUT, PATCH, or DELETE');
  }
  if (rest.path !== undefined) assertSafePath(rest.path);
  if (rest.requestSchema !== undefined) assertSchemaObject(rest.requestSchema, 'requestSchema');
  if (rest.responseSchema !== undefined) assertSchemaObject(rest.responseSchema, 'responseSchema');
  if (rest.responseStatus !== undefined) assertStatus(rest.responseStatus);
  if (rest.responseBody !== undefined && (typeof rest.responseBody !== 'object' || rest.responseBody === null)) {
    throw err(400, 'VALIDATION_ERROR', 'responseBody must be a JSON object');
  }
  const newMethod = rest.method !== undefined ? String(rest.method).toUpperCase() : rec.method;
  const newPath = rest.path !== undefined ? rest.path : rec.path;
  const clash = findByRoute(newMethod, newPath);
  if (clash && clash.endpointId !== endpointId) {
    throw err(409, 'ROUTE_CONFLICT', `Another endpoint already simulates ${newMethod} ${newPath}`);
  }
  const schemaChanged = rest.requestSchema !== undefined || rest.responseSchema !== undefined;
  Object.assign(rec, {
    method: newMethod,
    path: newPath,
    requestSchema: rest.requestSchema !== undefined ? clone(rest.requestSchema) : rec.requestSchema,
    responseSchema: rest.responseSchema !== undefined ? clone(rest.responseSchema) : rec.responseSchema,
    responseStatus: rest.responseStatus !== undefined ? rest.responseStatus : rec.responseStatus,
    responseBody: rest.responseBody !== undefined ? clone(rest.responseBody) : rec.responseBody,
    requiredHeaders: rest.requiredHeaders !== undefined ? assertHeaders(rest.requiredHeaders) : rec.requiredHeaders,
    version: rec.version + 1,
    schemaVersion: rec.schemaVersion + (schemaChanged ? 1 : 0),
    updatedAt: new Date().toISOString(),
  });
  logActivity({ type: 'endpoint_updated', endpointId, appliedBy, summary: `v${rec.version} schemaV${rec.schemaVersion}` });
  return toPublicEndpoint(rec);
}

function deleteEndpoint(endpointId, appliedBy = 'judge') {
  assertEndpointId(endpointId);
  const ok = state.endpoints.delete(endpointId);
  if (ok) logActivity({ type: 'endpoint_deleted', endpointId, appliedBy, summary: endpointId });
  return ok;
}

function resetEndpoint(endpointId, appliedBy = 'judge') {
  const rec = getRecord(endpointId);
  if (!rec) return null;
  const prevVersion = rec.schemaVersion;
  rec.requestSchema = clone(rec.baseline.requestSchema);
  rec.responseSchema = clone(rec.baseline.responseSchema);
  rec.responseStatus = rec.baseline.responseStatus;
  rec.responseBody = clone(rec.baseline.responseBody);
  rec.requiredHeaders = clone(rec.baseline.requiredHeaders);
  rec.failure = { mode: 'off' };
  rec.schemaVersion += 1;
  rec.updatedAt = new Date().toISOString();
  const entry = {
    mutationId: `mut_reset_${Date.now().toString(36)}`,
    endpointId, op: 'RESET', args: {}, prevVersion, newVersion: rec.schemaVersion,
    appliedBy, appliedAt: new Date().toISOString(), scenarioId: null,
  };
  state.mutations.unshift(entry);
  logActivity({ type: 'endpoint_reset', endpointId, appliedBy, summary: `schema v${prevVersion} -> v${rec.schemaVersion} (baseline)` });
  return { endpoint: toPublicEndpoint(rec), reset: entry };
}

module.exports = {
  createEndpoint, listEndpoints, getEndpoint, getRecord,
  updateEndpoint, deleteEndpoint, resetEndpoint, findByRoute,
  assertSchemaObject, assertEndpointId,
};
