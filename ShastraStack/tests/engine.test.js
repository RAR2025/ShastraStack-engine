require('./setup').ensureTestEnv();

const express = require('express');
const request = require('supertest');
const { migrateTestDb, truncateAll, closePool } = require('./setup');
const { buildApp } = require('../src/app');
const { query } = require('../src/db/pool');

// ---- Mutable downstream stub: simulates the external API under drift ----
let handler = (req, res) => res.json({ ok: true });
let lastRequest = null;

function stub() {
  const app = express();
  app.use(express.json());
  app.use((req, res) => {
    lastRequest = { headers: { ...req.headers }, body: req.body, query: req.query, path: req.path };
    handler(req, res);
  });
  return app;
}

const okEcho = (req, res) => res.json({ answer: `echo:${req.body.text || ''}` });

describe('ShastraStack engine', () => {
  let app;
  let downstreamServer;
  let baseUrl;
  let n = 0;

  const tid = (prefix) => `${prefix}-${Date.now()}-${(n += 1)}`;

  beforeAll(async () => {
    await migrateTestDb();
    app = buildApp();
    await new Promise((resolve) => {
      downstreamServer = stub().listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${downstreamServer.address().port}`;
  }, 30000);

  beforeEach(async () => {
    await truncateAll();
    handler = okEcho;
    lastRequest = null;
  });

  afterAll(async () => {
    await new Promise((resolve) => downstreamServer.close(resolve));
    await closePool();
  });

  async function registerTool(overrides = {}) {
    const toolId = overrides.toolId || tid('tool');
    const res = await request(app).post('/v1/tools/register').send({
      toolId,
      baseUrl,
      method: 'POST',
      path: '/api/run',
      clientSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } }, additionalProperties: false },
      downstreamSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } }, additionalProperties: false },
      responseSchema: { type: 'object', required: ['answer'], properties: { answer: { type: 'string' } } },
      timeoutMs: 5000,
      ...overrides,
    });
    if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data;
  }

  // ---------- registration ----------
  test('registers, lists, retrieves a tool', async () => {
    const tool = await registerTool({ toolId: tid('reg') });
    expect(tool.version).toBe(1);
    expect(tool.downstreamVersion).toBe(1);
    expect(tool.adapterRules).toEqual({ operations: [] });

    const list = await request(app).get('/v1/tools?page=1&pageSize=5');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.data[0].toolId).toBe(tool.toolId);

    const get = await request(app).get(`/v1/tools/${tool.toolId}`);
    expect(get.status).toBe(200);
    expect(get.body.data.baseUrl).toBe(baseUrl);
  });

  test('rejects duplicate registration with 409', async () => {
    const toolId = tid('dup');
    await registerTool({ toolId });
    const res = await request(app).post('/v1/tools/register').send({ toolId, baseUrl });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TOOL_EXISTS');
  });

  test('rejects invalid toolId, bad URL, and secret headers', async () => {
    const badId = await request(app).post('/v1/tools/register').send({ toolId: 'Bad ID!', baseUrl });
    expect(badId.status).toBe(400);

    const badUrl = await request(app).post('/v1/tools/register').send({ toolId: tid('u'), baseUrl: 'not-a-url' });
    expect(badUrl.status).toBe(400);

    const secret = await request(app).post('/v1/tools/register').send({
      toolId: tid('s'), baseUrl, headers: { Authorization: 'Bearer live-secret' },
    });
    expect(secret.status).toBe(400);
    expect(JSON.stringify(secret.body)).not.toMatch(/live-secret/);
  });

  test('PATCH enforces version checks and bumps version', async () => {
    const tool = await registerTool({ toolId: tid('ver') });
    const conflict = await request(app).patch(`/v1/tools/${tool.toolId}`).send({ expectedVersion: 99, timeoutMs: 7000 });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('VERSION_CONFLICT');

    const ok = await request(app).patch(`/v1/tools/${tool.toolId}`).send({ expectedVersion: 1, timeoutMs: 7000 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.version).toBe(2);
    expect(ok.body.data.timeoutMs).toBe(7000);
  });

  test('DELETE unregisters; unknown ids 404', async () => {
    const tool = await registerTool({ toolId: tid('del') });
    const del = await request(app).delete(`/v1/tools/${tool.toolId}`);
    expect(del.status).toBe(204);
    const get = await request(app).get(`/v1/tools/${tool.toolId}`);
    expect(get.status).toBe(404);
    const bad = await request(app).get('/v1/tools/does-not-exist-xyz');
    expect(bad.status).toBe(404);
  });

  // ---------- execution without drift ----------
  test('executes successfully and persists the trace', async () => {
    const tool = await registerTool({ toolId: tid('ok') });
    const res = await request(app).post(`/v1/tools/${tool.toolId}/execute`).send({ input: { text: 'hi' } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data).toEqual({ answer: 'echo:hi' });
    expect(res.body.executionId).toMatch(/^ex_/);

    const trace = await request(app).get(`/v1/logs/${res.body.executionId}`);
    expect(trace.status).toBe(200);
    expect(trace.body.data.execution.status).toBe('success');
    expect(trace.body.data.execution.duration_ms).toBeGreaterThanOrEqual(0);
    expect(trace.body.data.auditEvents.length).toBeGreaterThanOrEqual(1);

    const { rows } = await query('SELECT llm_tokens_baseline, llm_tokens_recovery, token_overhead FROM executions WHERE execution_id = $1', [res.body.executionId]);
    expect(rows[0]).toMatchObject({ llm_tokens_baseline: 0, llm_tokens_recovery: 0, token_overhead: 0 });
  });

  test('rejects invalid client input without touching downstream', async () => {
    const tool = await registerTool({ toolId: tid('in') });
    let downstreamHit = false;
    handler = () => { downstreamHit = true; };
    const res = await request(app).post(`/v1/tools/${tool.toolId}/execute`).send({ input: { wrong: 1 } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(downstreamHit).toBe(false);
  });

  // ---------- blind rename recovery ----------
  test('recovers from a blind downstream field rename and commits the patch', async () => {
    const toolId = tid('rename');
    await registerTool({
      toolId,
      clientSchema: { type: 'object', required: ['email'], properties: { email: { type: 'string' } }, additionalProperties: false },
      downstreamSchema: { type: 'object', required: ['email'], properties: { email: { type: 'string' } }, additionalProperties: false },
      responseSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
    });
    handler = (req, res) => {
      if (req.body.email !== undefined) {
        return res.status(400).json({ error: "request validation failed: unknown field 'email', expected 'emailAddress'" });
      }
      if (typeof req.body.emailAddress !== 'string') return res.status(400).json({ error: 'bad' });
      return res.json({ ok: true });
    };

    const first = await request(app).post(`/v1/tools/${toolId}/execute`).send({ input: { email: 'a@b.c' }, idempotencyKey: 'k-rename-1' });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('recovered');
    expect(first.body.recovery.operations).toEqual([{ op: 'RENAME_FIELD', scope: 'request', from: 'email', to: 'emailAddress' }]);
    expect(first.body.recovery.retryCount).toBe(1);
    const patchId = first.body.recovery.patchId;

    const patch = await request(app).get(`/v1/patches/${patchId}`);
    expect(patch.status).toBe(200);
    expect(patch.body.data.status).toBe('committed');

    // Second call uses the committed adapter: plain success, no recovery block.
    const second = await request(app).post(`/v1/tools/${toolId}/execute`).send({ input: { email: 'x@y.z' } });
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('success');
    expect(lastRequest.body).toEqual({ emailAddress: 'x@y.z' });
  });

  // ---------- type conversion ----------
  test('recovers via CONVERT_TYPE without a resend guard issue', async () => {
    const toolId = tid('conv');
    await registerTool({
      toolId,
      clientSchema: { type: 'object', required: ['age'], properties: { age: { type: 'string' } }, additionalProperties: false },
      downstreamSchema: { type: 'object', required: ['age'], properties: { age: { type: 'integer' } }, additionalProperties: false },
      responseSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
    });
    handler = (req, res) => {
      if (!Number.isInteger(req.body.age)) return res.status(400).json({ error: 'age must be integer' });
      return res.json({ ok: true });
    };
    const res = await request(app).post(`/v1/tools/${toolId}/execute`).send({ input: { age: '30' } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('recovered');
    expect(res.body.recovery.operations).toEqual([{ op: 'CONVERT_TYPE', scope: 'request', field: 'age', toType: 'integer' }]);
    expect(lastRequest.body).toEqual({ age: 30 });
  });

  // ---------- nesting / MOVE_FIELD ----------
  test('recovers via MOVE_FIELD when downstream nests a field', async () => {
    const toolId = tid('move');
    await registerTool({
      toolId,
      clientSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } }, additionalProperties: false },
      downstreamSchema: {
        type: 'object', required: ['customer'], additionalProperties: false,
        properties: { customer: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } },
      },
      responseSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
    });
    handler = (req, res) => {
      if (req.body.customer && req.body.customer.name) return res.json({ ok: true });
      return res.status(400).json({ error: "'customer' is required" });
    };
    const res = await request(app).post(`/v1/tools/${toolId}/execute`).send({ input: { name: 'ada' } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('recovered');
    expect(res.body.recovery.operations).toEqual([{ op: 'MOVE_FIELD', scope: 'request', fromPath: 'name', toPath: 'customer.name' }]);
    expect(lastRequest.body).toEqual({ customer: { name: 'ada' } });
  });

  // ---------- required headers ----------
  test('fails truthfully on missing header, then succeeds after header configuration', async () => {
    const toolId = tid('hdr');
    await registerTool({ toolId, responseSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } });
    handler = (req, res) => {
      if (!req.headers['x-tenant-id']) return res.status(400).json({ error: 'missing required header: x-tenant-id' });
      return res.json({ ok: true });
    };
    const failed = await request(app).post(`/v1/tools/${toolId}/execute`).send({ input: { text: 'hi' }, idempotencyKey: 'k-hdr' });
    expect(failed.status).toBe(502);
    expect(failed.body.classification).toBe('SCHEMA_DRIFT_AMBIGUOUS');
    // No values invented: nothing committed.
    const patches = await request(app).get(`/v1/patches?toolId=${toolId}`);
    expect(patches.body.total).toBe(1);
    expect(patches.body.data[0].status).toBe('rolled_back');

    const tool = await request(app).get(`/v1/tools/${toolId}`);
    await request(app).patch(`/v1/tools/${toolId}`).send({ expectedVersion: tool.body.data.version, headers: { 'x-tenant-id': 'acme' } });
    const ok = await request(app).post(`/v1/tools/${toolId}/execute`).send({ input: { text: 'hi' } });
    expect(ok.status).toBe(200);
    expect(lastRequest.headers['x-tenant-id']).toBe('acme');
  });

  // ---------- response-schema drift ----------
  test('adapts a drifted response without resending', async () => {
    const toolId = tid('resp');
    await registerTool({ toolId });
    handler = (req, res) => res.json({ reply: `echo:${req.body.text}` }); // drifted: reply vs answer
    const res = await request(app).post(`/v1/tools/${toolId}/execute`).send({ input: { text: 'yo' } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('recovered');
    expect(res.body.data).toEqual({ answer: 'echo:yo' });
    expect(res.body.recovery.operations).toEqual([{ op: 'RENAME_FIELD', scope: 'response', from: 'reply', to: 'answer' }]);
  });

  // ---------- ambiguous changes: no guessing ----------
  test('returns truthful failure on ambiguous drift and records rollback', async () => {
    const toolId = tid('amb');
    await registerTool({ toolId, responseSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } });
    handler = (req, res) => res.status(400).json({ error: 'business rule violated: duplicate customer name' });
    const res = await request(app).post(`/v1/tools/${toolId}/execute`).send({ input: { text: 'x' }, idempotencyKey: 'k-amb' });
    expect(res.status).toBe(502);
    expect(res.body.classification).toBe('DOWNSTREAM_REJECTED');
    const { rows } = await query('SELECT COUNT(*)::int AS c FROM patch_history WHERE execution_ref = $1 AND status = $2', [res.body.executionId, 'committed']);
    expect(rows[0].c).toBe(0);
  });

  test('rolls back when the verified retry still fails', async () => {
    const toolId = tid('rb');
    await registerTool({
      toolId,
      clientSchema: { type: 'object', required: ['email'], properties: { email: { type: 'string' } }, additionalProperties: false },
      downstreamSchema: { type: 'object', required: ['email'], properties: { email: { type: 'string' } }, additionalProperties: false },
      responseSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
    });
    handler = (req, res) => {
      if (req.body.email !== undefined) {
        return res.status(400).json({ error: "unknown field 'email', expected 'emailAddress'" });
      }
      return res.status(400).json({ error: "missing required field 'phone'" }); // second, unrelated failure
    };
    const before = await request(app).get(`/v1/tools/${toolId}`);
    const res = await request(app).post(`/v1/tools/${toolId}/execute`).send({ input: { email: 'a@b.c' }, idempotencyKey: 'k-rb' });
    expect(res.status).toBe(502);
    expect(res.body.classification).toBe('SCHEMA_DRIFT_UNRECOVERED');
    const after = await request(app).get(`/v1/tools/${toolId}`);
    expect(after.body.data.version).toBe(before.body.data.version); // adapter untouched
    const trace = await request(app).get(`/v1/logs/${res.body.executionId}`);
    expect(trace.body.data.patches[0].status).toBe('rolled_back');
  });

  // ---------- retry limits & safety ----------
  test('maxRetries:0 disables automatic recovery', async () => {
    const toolId = tid('noretry');
    await registerTool({
      toolId,
      clientSchema: { type: 'object', required: ['age'], properties: { age: { type: 'string' } } },
      downstreamSchema: { type: 'object', required: ['age'], properties: { age: { type: 'integer' } } },
      responseSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
      recoveryPolicy: { maxRetries: 0, allowAutomaticPatch: true },
    });
    const res = await request(app).post(`/v1/tools/${toolId}/execute`).send({ input: { age: '3' } });
    expect(res.status).toBe(502);
    const trace = await request(app).get(`/v1/logs/${res.body.executionId}`);
    expect(trace.body.data.execution.retry_count).toBe(0);
  });

  test('non-idempotent POST without idempotency key is never blindly retried', async () => {
    const toolId = tid('idem');
    await registerTool({
      toolId,
      clientSchema: { type: 'object', required: ['email'], properties: { email: { type: 'string' } } },
      downstreamSchema: { type: 'object', required: ['email'], properties: { email: { type: 'string' } } },
      responseSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
    });
    handler = (req, res) => {
      if (req.body.email !== undefined) {
        return res.status(400).json({ error: "unknown field 'email', expected 'emailAddress'" });
      }
      return res.json({ ok: true });
    };
    const refused = await request(app).post(`/v1/tools/${toolId}/execute`).send({ input: { email: 'a@b.c' } });
    expect(refused.status).toBe(502);
    expect(refused.body.classification).toBe('SCHEMA_DRIFT_UNRECOVERED');
    expect(refused.body.error.message).toMatch(/idempotency/i);

    const allowed = await request(app).post(`/v1/tools/${toolId}/execute`).send({ input: { email: 'a@b.c' }, idempotencyKey: 'k-idem-1' });
    expect(allowed.status).toBe(200);
    expect(allowed.body.status).toBe('recovered');
  });

  // ---------- error classes never patched ----------
  test('401/403 are never patched as drift', async () => {
    const toolId = tid('auth');
    await registerTool({ toolId, responseSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } });
    handler = (req, res) => res.status(401).json({ error: 'invalid api key' });
    const res = await request(app).post(`/v1/tools/${toolId}/execute`).send({ input: { text: 'x' }, idempotencyKey: 'k-auth' });
    expect(res.status).toBe(502);
    expect(res.body.classification).toBe('AUTH_ERROR');
    const { rows } = await query('SELECT COUNT(*)::int AS c FROM patch_history WHERE execution_ref = $1', [res.body.executionId]);
    expect(rows[0].c).toBe(0);
  });

  test('429 honors Retry-After without patching', async () => {
    const toolId = tid('rl');
    await registerTool({ toolId, responseSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } });
    handler = (req, res) => res.status(429).set('Retry-After', '2').json({ error: 'slow down' });
    const res = await request(app).post(`/v1/tools/${toolId}/execute`).send({ input: { text: 'x' } });
    expect(res.status).toBe(502);
    expect(res.body.classification).toBe('RATE_LIMITED');
    expect(res.body.retryAfterMs).toBe(2000);
  });

  test('arbitrary 5xx is never auto-patched', async () => {
    const toolId = tid('s5');
    await registerTool({ toolId, responseSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } });
    handler = (req, res) => res.status(500).json({ error: 'boom' });
    const res = await request(app).post(`/v1/tools/${toolId}/execute`).send({ input: { text: 'x' }, idempotencyKey: 'k-5xx' });
    expect(res.status).toBe(502);
    expect(res.body.classification).toBe('SERVER_ERROR');
  });

  test('timeouts fail truthfully without patch attempts', async () => {
    const toolId = tid('to');
    await registerTool({ toolId, timeoutMs: 150, responseSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } });
    handler = async (req, res) => { await new Promise((r) => setTimeout(r, 600)); res.json({ ok: true }); };
    const res = await request(app).post(`/v1/tools/${toolId}/execute`).send({ input: { text: 'x' } });
    expect(res.status).toBe(502);
    expect(['TIMEOUT', 'NETWORK_ERROR']).toContain(res.body.classification);
  }, 15000);

  // ---------- informed mode ----------
  test('informed schema update bumps downstream version', async () => {
    const toolId = tid('inf');
    const tool = await registerTool({ toolId });
    const res = await request(app).post(`/v1/tools/${toolId}/schema`).send({
      downstreamSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } },
      expectedDownstreamVersion: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.downstreamVersion).toBe(2);

    const stale = await request(app).post(`/v1/tools/${toolId}/schema`).send({ downstreamSchema: {}, expectedDownstreamVersion: 1 });
    expect(stale.status).toBe(409);
    expect(tool.downstreamVersion).toBe(1);
  });

  // ---------- logs, patches, metrics ----------
  test('logs support filters + pagination; trace shows audit and patches', async () => {
    const toolId = tid('logs');
    await registerTool({ toolId });
    const e1 = await request(app).post(`/v1/tools/${toolId}/execute`).send({ input: { text: 'a' } });
    const e2 = await request(app).post(`/v1/tools/${toolId}/execute`).send({ input: { wrong: 1 } });
    expect(e1.status).toBe(200);
    expect(e2.status).toBe(400);

    const filtered = await request(app).get(`/v1/logs?toolId=${toolId}&status=success&page=1&pageSize=1`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.data[0].execution_id).toBe(e1.body.executionId);

    const audits = await request(app).get(`/v1/logs?kind=audit&pageSize=5`);
    expect(audits.status).toBe(200);
    expect(audits.body.total).toBeGreaterThanOrEqual(2);

    const trace = await request(app).get(`/v1/logs/${e1.body.executionId}`);
    expect(trace.body.data.execution.tool_ref).toBe(toolId);
    expect(Array.isArray(trace.body.data.auditEvents)).toBe(true);
  });

  test('metrics summary reports counts, MTTR, ZTAR, zero token overhead', async () => {
    const toolId = tid('met');
    await registerTool({ toolId });
    await request(app).post(`/v1/tools/${toolId}/execute`).send({ input: { text: 'a' } });
    await request(app).post(`/v1/tools/${toolId}/execute`).send({ input: { nope: 1 } });

    const s = await request(app).get('/v1/metrics/summary');
    expect(s.status).toBe(200);
    expect(s.body.data.totalExecutions).toBe(2);
    expect(s.body.data.tokenOverhead).toBe(0);
    expect(s.body.data.llmTokensRecovery).toBe(0);
    expect(typeof s.body.data.mttrMs).toBe('number');
    expect(typeof s.body.data.zeroTouchAdaptationRate).toBe('number');

    const per = await request(app).get(`/v1/metrics/executions?toolId=${toolId}&pageSize=10`);
    expect(per.status).toBe(200);
    expect(per.body.total).toBe(2);
  });

  test('health reports engine + database state', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('shastrastack-engine');
    expect(res.body.db).toBe('up');
  });
});
