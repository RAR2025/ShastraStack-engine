// Tool registry: create / retrieve / update / version / persist tool registrations.
// PostgreSQL is durable storage; `activeTools` Map is the low-latency in-memory copy.
// Registration config (endpoint + schemas) is the only source of downstream truth —
// nothing about mock URLs, endpoints, or field names is hardcoded in the engine.
const { query } = require('../db/pool');
const { isValidToolId } = require('../utils/ids');

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const SECRET_HEADER_RE = /^(authorization|cookie|set-cookie|proxy-authorization|proxy-authenticate)$/i;

const activeTools = new Map();

function badRequest(message, details) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'VALIDATION_ERROR';
  if (details) err.details = details;
  return err;
}

function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  err.code = 'VERSION_CONFLICT';
  return err;
}

function assertValidRegistration(body) {
  if (!body || typeof body !== 'object') throw badRequest('Registration body must be an object');
  const { toolId, baseUrl, method, path: toolPath } = body;
  if (!isValidToolId(toolId)) {
    throw badRequest('toolId must match ^[a-z0-9][a-z0-9-_]{0,63}$', [{ path: '/toolId' }]);
  }
  if (typeof baseUrl !== 'string' || !/^https?:\/\/.+/i.test(baseUrl)) {
    throw badRequest('baseUrl must be an http(s) URL', [{ path: '/baseUrl' }]);
  }
  if (method !== undefined && !METHODS.has(String(method).toUpperCase())) {
    throw badRequest('method must be one of GET, POST, PUT, PATCH, DELETE', [{ path: '/method' }]);
  }
  if (toolPath !== undefined && (typeof toolPath !== 'string' || !toolPath.startsWith('/'))) {
    throw badRequest('path must start with /', [{ path: '/path' }]);
  }
  for (const key of ['clientSchema', 'downstreamSchema', 'responseSchema']) {
    if (body[key] !== undefined && (typeof body[key] !== 'object' || body[key] === null || Array.isArray(body[key]))) {
      throw badRequest(`${key} must be a JSON Schema object`, [{ path: `/${key}` }]);
    }
  }
  if (body.timeoutMs !== undefined && (!Number.isInteger(body.timeoutMs) || body.timeoutMs < 100 || body.timeoutMs > 120000)) {
    throw badRequest('timeoutMs must be an integer between 100 and 120000', [{ path: '/timeoutMs' }]);
  }
  assertSafeHeaders(body.headers);
  if (body.credentialRef !== undefined && body.credentialRef !== null && typeof body.credentialRef !== 'string') {
    throw badRequest('credentialRef must be a string reference name, never a secret value', [{ path: '/credentialRef' }]);
  }
  if (body.recoveryPolicy !== undefined) assertValidPolicy(body.recoveryPolicy);
}

function assertSafeHeaders(headers) {
  if (headers === undefined) return;
  if (typeof headers !== 'object' || headers === null || Array.isArray(headers)) {
    throw badRequest('headers must be an object of static non-secret headers', [{ path: '/headers' }]);
  }
  for (const [name, value] of Object.entries(headers)) {
    if (SECRET_HEADER_RE.test(name)) {
      throw badRequest(
        `Refusing to persist secret header "${name}". Store secrets outside the engine and pass a credentialRef name instead.`,
        [{ path: `/headers/${name}` }]
      );
    }
    if (typeof value !== 'string' || value.length > 2000) {
      throw badRequest(`Header "${name}" must be a string <= 2000 chars`, [{ path: `/headers/${name}` }]);
    }
  }
}

function assertValidPolicy(policy) {
  if (typeof policy !== 'object' || policy === null || Array.isArray(policy)) {
    throw badRequest('recoveryPolicy must be an object', [{ path: '/recoveryPolicy' }]);
  }
  if (policy.maxRetries !== undefined && (!Number.isInteger(policy.maxRetries) || policy.maxRetries < 0 || policy.maxRetries > 1)) {
    throw badRequest('recoveryPolicy.maxRetries must be 0 or 1 (MVP allows at most one retry)', [{ path: '/recoveryPolicy/maxRetries' }]);
  }
  if (policy.allowAutomaticPatch !== undefined && typeof policy.allowAutomaticPatch !== 'boolean') {
    throw badRequest('recoveryPolicy.allowAutomaticPatch must be boolean', [{ path: '/recoveryPolicy/allowAutomaticPatch' }]);
  }
}

function normalizeRow(row) {
  if (!row) return null;
  return {
    toolId: row.tool_id,
    baseUrl: row.base_url,
    method: row.method,
    path: row.path,
    clientSchema: row.client_schema || {},
    downstreamSchema: row.downstream_schema || {},
    responseSchema: row.response_schema || {},
    adapterRules: row.adapter_rules && typeof row.adapter_rules === 'object' ? row.adapter_rules : { operations: [] },
    version: row.version,
    downstreamVersion: row.downstream_version,
    timeoutMs: row.timeout_ms,
    headers: row.headers || {},
    credentialRef: row.credential_ref || null,
    recoveryPolicy: row.recovery_policy || { maxRetries: 1, allowAutomaticPatch: true },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function registerTool(body) {
  assertValidRegistration(body);
  const method = (body.method || 'POST').toUpperCase();
  const toolPath = body.path || '/';
  const policy = {
    maxRetries: body.recoveryPolicy && body.recoveryPolicy.maxRetries !== undefined ? body.recoveryPolicy.maxRetries : 1,
    allowAutomaticPatch: body.recoveryPolicy && body.recoveryPolicy.allowAutomaticPatch !== undefined
      ? body.recoveryPolicy.allowAutomaticPatch
      : true,
  };
  try {
    const { rows } = await query(
      `INSERT INTO tool_registrations
        (tool_id, name, base_url, endpoint, path, method, client_schema, downstream_schema, response_schema,
         adapter_rules, version, downstream_version, timeout_ms, headers, credential_ref, recovery_policy,
         input_schema, output_schema)
       VALUES ($1, $1, $2, $3, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb,
         '{"operations":[]}'::jsonb, 1, 1, $8, $9::jsonb, $10, $11::jsonb,
         $5::jsonb, $7::jsonb)
       RETURNING *`,
      [
        body.toolId,
        body.baseUrl,
        toolPath,
        method,
        JSON.stringify(body.clientSchema || {}),
        JSON.stringify(body.downstreamSchema || {}),
        JSON.stringify(body.responseSchema || {}),
        body.timeoutMs || 5000,
        JSON.stringify(body.headers || {}),
        body.credentialRef || null,
        JSON.stringify(policy),
      ]
    );
    const tool = normalizeRow(rows[0]);
    activeTools.set(tool.toolId, tool);
    return tool;
  } catch (err) {
    if (err && err.code === '23505') {
      const e = new Error(`Tool already registered: ${body.toolId}`);
      e.status = 409;
      e.code = 'TOOL_EXISTS';
      throw e;
    }
    throw err;
  }
}

async function getTool(toolId) {
  if (!isValidToolId(toolId)) {
    const err = new Error('Invalid toolId');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  if (activeTools.has(toolId)) return activeTools.get(toolId);
  const { rows } = await query('SELECT * FROM tool_registrations WHERE tool_id = $1', [toolId]);
  const tool = normalizeRow(rows[0] || null);
  if (tool) activeTools.set(toolId, tool);
  return tool;
}

async function listTools({ page = 1, pageSize = 20 } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const offset = (p - 1) * ps;
  const [{ rows: countRows }, { rows }] = await Promise.all([
    query('SELECT COUNT(*)::int AS total FROM tool_registrations WHERE tool_id IS NOT NULL'),
    query('SELECT * FROM tool_registrations WHERE tool_id IS NOT NULL ORDER BY tool_id ASC LIMIT $1 OFFSET $2', [ps, offset]),
  ]);
  return { data: rows.map(normalizeRow), page: p, pageSize: ps, total: countRows[0].total };
}

const UPDATABLE = new Set([
  'baseUrl', 'method', 'path', 'clientSchema', 'downstreamSchema', 'responseSchema',
  'timeoutMs', 'headers', 'credentialRef', 'recoveryPolicy',
]);

async function updateTool(toolId, changes, expectedVersion) {
  const current = await getTool(toolId);
  if (!current) return null;
  if (expectedVersion !== undefined && Number(expectedVersion) !== current.version) {
    throw conflict(`Version conflict: expected ${expectedVersion} but current is ${current.version}`);
  }
  if (!changes || typeof changes !== 'object') throw badRequest('Update body must be an object');
  const keys = Object.keys(changes).filter((k) => k !== 'expectedVersion');
  if (keys.length === 0) throw badRequest('No updatable fields supplied');
  for (const k of keys) {
    if (!UPDATABLE.has(k)) throw badRequest(`Field not updatable: ${k}`, [{ path: `/${k}` }]);
  }
  // Reuse registration assertions on the merged object.
  assertValidRegistration({ ...current, ...changes, toolId, baseUrl: changes.baseUrl || current.baseUrl });
  const downstreamChanged = changes.downstreamSchema !== undefined || changes.responseSchema !== undefined;
  const { rows } = await query(
    `UPDATE tool_registrations SET
       base_url = $2, method = $3, endpoint = $4, path = $4,
       client_schema = $5::jsonb, downstream_schema = $6::jsonb, response_schema = $7::jsonb,
       timeout_ms = $8, headers = $9::jsonb, credential_ref = $10, recovery_policy = $11::jsonb,
       version = version + 1,
       downstream_version = downstream_version + $12,
       updated_at = NOW()
     WHERE tool_id = $1
     RETURNING *`,
    [
      toolId,
      changes.baseUrl || current.baseUrl,
      (changes.method || current.method).toUpperCase(),
      changes.path || current.path,
      JSON.stringify(changes.clientSchema || current.clientSchema),
      JSON.stringify(changes.downstreamSchema || current.downstreamSchema),
      JSON.stringify(changes.responseSchema || current.responseSchema),
      changes.timeoutMs || current.timeoutMs,
      JSON.stringify(changes.headers || current.headers),
      changes.credentialRef !== undefined ? changes.credentialRef : current.credentialRef,
      JSON.stringify(changes.recoveryPolicy || current.recoveryPolicy),
      downstreamChanged ? 1 : 0,
    ]
  );
  const tool = normalizeRow(rows[0]);
  activeTools.set(toolId, tool);
  return tool;
}

// Informed mode: authorized caller supplies the new known downstream schema.
// Bumps downstream_version without requiring a full registration update.
async function updateDownstreamSchema(toolId, { downstreamSchema, responseSchema, expectedDownstreamVersion }) {
  const current = await getTool(toolId);
  if (!current) return null;
  if (downstreamSchema !== undefined && (typeof downstreamSchema !== 'object' || downstreamSchema === null || Array.isArray(downstreamSchema))) {
    throw badRequest('downstreamSchema must be a JSON Schema object', [{ path: '/downstreamSchema' }]);
  }
  if (responseSchema !== undefined && (typeof responseSchema !== 'object' || responseSchema === null || Array.isArray(responseSchema))) {
    throw badRequest('responseSchema must be a JSON Schema object', [{ path: '/responseSchema' }]);
  }
  if (downstreamSchema === undefined && responseSchema === undefined) {
    throw badRequest('Supply downstreamSchema and/or responseSchema');
  }
  if (expectedDownstreamVersion !== undefined && Number(expectedDownstreamVersion) !== current.downstreamVersion) {
    throw conflict(`Downstream version conflict: expected ${expectedDownstreamVersion} but current is ${current.downstreamVersion}`);
  }
  const { rows } = await query(
    `UPDATE tool_registrations SET
       downstream_schema = $2::jsonb, response_schema = $3::jsonb,
       downstream_version = downstream_version + 1, updated_at = NOW()
     WHERE tool_id = $1 RETURNING *`,
    [
      toolId,
      JSON.stringify(downstreamSchema || current.downstreamSchema),
      JSON.stringify(responseSchema || current.responseSchema),
    ]
  );
  const tool = normalizeRow(rows[0]);
  activeTools.set(toolId, tool);
  return tool;
}

async function deleteTool(toolId) {
  if (!isValidToolId(toolId)) {
    const err = new Error('Invalid toolId');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  const { rowCount } = await query('DELETE FROM tool_registrations WHERE tool_id = $1', [toolId]);
  activeTools.delete(toolId);
  return rowCount > 0;
}

// Commit path: append verified operations and bump the adapter version.
async function commitAdapterOperations(toolId, operations, expectedVersion) {
  const current = await getTool(toolId);
  if (!current) return null;
  if (expectedVersion !== undefined && Number(expectedVersion) !== current.version) {
    throw conflict(`Version conflict on commit: expected ${expectedVersion} but current is ${current.version}`);
  }
  const merged = [...(current.adapterRules.operations || []), ...operations];
  const { rows } = await query(
    `UPDATE tool_registrations SET adapter_rules = $2::jsonb, version = version + 1, updated_at = NOW()
     WHERE tool_id = $1 RETURNING *`,
    [toolId, JSON.stringify({ operations: merged })]
  );
  const tool = normalizeRow(rows[0]);
  activeTools.set(toolId, tool);
  return tool;
}

async function loadActiveAdapters() {
  const { rows } = await query('SELECT * FROM tool_registrations WHERE tool_id IS NOT NULL');
  activeTools.clear();
  for (const row of rows) {
    const tool = normalizeRow(row);
    activeTools.set(tool.toolId, tool);
  }
  return activeTools.size;
}

function getActive(toolId) {
  return activeTools.get(toolId) || null;
}

function _clearCacheForTests() {
  activeTools.clear();
}

module.exports = {
  registerTool,
  getTool,
  listTools,
  updateTool,
  updateDownstreamSchema,
  deleteTool,
  commitAdapterOperations,
  loadActiveAdapters,
  getActive,
  _clearCacheForTests,
  _normalizeRow: normalizeRow,
};
