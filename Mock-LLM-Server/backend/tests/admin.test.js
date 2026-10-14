process.env.ADMIN_TOKEN = 'test-token';

const express = require('express');
const request = require('supertest');
const { buildApp } = require('../src/app');
const { seed } = require('../src/store');

const TOKEN = 'test-token';
const auth = (r) => r.set('x-admin-token', TOKEN);

describe('Mock simulation platform', () => {
  const app = buildApp();
  let n = 0;
  const eid = (p) => `${p}-${Date.now()}-${(n += 1)}`;

  beforeEach(() => {
    seed();
  });

  test('admin routes require the token; token never appears in responses', async () => {
    const noAuth = await request(app).get('/api/admin/endpoints');
    expect(noAuth.status).toBe(401);
    const ok = await auth(request(app).get('/api/admin/endpoints'));
    expect(ok.status).toBe(200);
    expect(JSON.stringify(ok.body)).not.toMatch(/test-token/);
  });

  test('endpoint CRUD with version checking', async () => {
    const id = eid('orders');
    const created = await auth(request(app).post('/api/admin/endpoints')).send({
      endpointId: id, method: 'POST', path: '/api/orders',
      requestSchema: { type: 'object', required: ['sku'], properties: { sku: { type: 'string' } }, additionalProperties: false },
      responseSchema: { type: 'object', required: ['orderId'], properties: { orderId: { type: 'string' } } },
      responseStatus: 201, responseBody: { orderId: 'ord_1' },
    });
    expect(created.status).toBe(201);
    expect(created.body.data.version).toBe(1);

    const dup = await auth(request(app).post('/api/admin/endpoints')).send({
      endpointId: id, path: '/api/other', requestSchema: { type: 'object' },
    });
    expect(dup.status).toBe(409);

    const list = await auth(request(app).get('/api/admin/endpoints'));
    expect(list.body.data.length).toBe(2); // seeded customers + new

    const stale = await auth(request(app).patch(`/api/admin/endpoints/${id}`)).send({ expectedVersion: 99, responseStatus: 200 });
    expect(stale.status).toBe(409);

    const patched = await auth(request(app).patch(`/api/admin/endpoints/${id}`)).send({ expectedVersion: 1, responseStatus: 200 });
    expect(patched.status).toBe(200);
    expect(patched.body.data.version).toBe(2);

    const schema = await auth(request(app).get(`/api/admin/endpoints/${id}/schema`));
    expect(schema.body.data.schemaVersion).toBe(1);

    const del = await auth(request(app).delete(`/api/admin/endpoints/${id}`));
    expect(del.status).toBe(204);
    expect((await auth(request(app).get(`/api/admin/endpoints/${id}`))).status).toBe(404);
  });

  test('rejects unsafe paths, reserved paths, and bad schemas', async () => {
    for (const bad of ['/api/../secret', '/api/admin/hack', '/api/chat', '/nope', '/api/a b']) {
      const res = await auth(request(app).post('/api/admin/endpoints')).send({
        endpointId: eid('x'), path: bad, requestSchema: { type: 'object' },
      });
      expect([400, 404].includes(res.status) || res.status === 400).toBe(true);
    }
    const badSchema = await auth(request(app).post('/api/admin/endpoints')).send({
      endpointId: eid('y'), path: '/api/ys', requestSchema: { type: 'array' },
    });
    expect(badSchema.status).toBe(400);
  });

  test('simulated endpoint validates requests and renders templated bodies', async () => {
    const valid = await request(app).post('/api/customers').send({ name: 'Ada', email: 'a@b.c' });
    expect(valid.status).toBe(201);
    expect(valid.body.data).toEqual({ id: 'cus_demo123', name: 'Ada', email: 'a@b.c' });

    const invalid = await request(app).post('/api/customers').send({ name: 'Ada' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('REQUEST_VALIDATION_FAILED');
    expect(Array.isArray(invalid.body.error.details)).toBe(true);
    expect(invalid.body.error.message).toMatch(/email/);
  });

  test('mutations apply immediately, version, and record history', async () => {
    const m = await auth(request(app).post('/api/admin/endpoints/customers/mutations')).send({
      op: 'RENAME_FIELD', scope: 'request', from: 'email', to: 'emailAddress', appliedBy: 'tester',
    });
    expect(m.status).toBe(201);
    expect(m.body.data.mutation.op).toBe('RENAME_FIELD');
    expect(m.body.data.schemaVersion).toBe(2);
    expect(m.body.data.notification).toEqual({ notified: false, mode: 'blind' });

    // Active schema changed: old shape now fails with evidence.
    const drifted = await request(app).post('/api/customers').send({ name: 'Ada', email: 'a@b.c' });
    expect(drifted.status).toBe(400);
    expect(drifted.body.error.message).toMatch(/unknown field 'email'/);

    const hist = await auth(request(app).get('/api/admin/mutations?endpointId=customers'));
    expect(hist.body.data[0]).toMatchObject({ op: 'RENAME_FIELD', prevVersion: 1, newVersion: 2, appliedBy: 'tester' });
  });

  test('invalid mutations are rejected before activation', async () => {
    const before = await auth(request(app).get('/api/admin/endpoints/customers/schema'));
    const bad = await auth(request(app).post('/api/admin/endpoints/customers/mutations')).send({
      op: 'RENAME_FIELD', scope: 'request', from: 'nope', to: 'emailAddress',
    });
    expect(bad.status).toBe(400);
    const after = await auth(request(app).get('/api/admin/endpoints/customers/schema'));
    expect(after.body.data.schemaVersion).toBe(before.body.data.schemaVersion);

    const unsupported = await auth(request(app).post('/api/admin/endpoints/customers/mutations')).send({ op: 'DROP_TABLE' });
    expect(unsupported.status).toBe(400);
  });

  test('reset restores the baseline deterministically', async () => {
    await auth(request(app).post('/api/admin/endpoints/customers/mutations')).send({ op: 'RENAME_FIELD', scope: 'request', from: 'email', to: 'emailAddress' });
    const reset = await auth(request(app).post('/api/admin/endpoints/customers/reset')).send({});
    expect(reset.status).toBe(200);
    expect(reset.body.data.reset.op).toBe('RESET');
    const ok = await request(app).post('/api/customers').send({ name: 'Ada', email: 'a@b.c' });
    expect(ok.status).toBe(201);
  });

  test('failure injection: auth, ratelimit (+Retry-After), server, timeout; reset clears', async () => {
    await auth(request(app).put('/api/admin/endpoints/customers/failure')).send({ mode: 'auth' });
    expect((await request(app).post('/api/customers').send({ name: 'A', email: 'a@b.c' })).status).toBe(401);

    await auth(request(app).put('/api/admin/endpoints/customers/failure')).send({ mode: 'ratelimit', retryAfterSec: 3 });
    const rl = await request(app).post('/api/customers').send({ name: 'A', email: 'a@b.c' });
    expect(rl.status).toBe(429);
    expect(rl.headers['retry-after']).toBe('3');

    await auth(request(app).put('/api/admin/endpoints/customers/failure')).send({ mode: 'server', status: 503 });
    expect((await request(app).post('/api/customers').send({ name: 'A', email: 'a@b.c' })).status).toBe(503);

    await auth(request(app).put('/api/admin/endpoints/customers/failure')).send({ mode: 'timeout', delayMs: 400 });
    const t0 = Date.now();
    const slow = await request(app).post('/api/customers').send({ name: 'A', email: 'a@b.c' });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(350);
    expect(slow.status).toBe(201);

    await auth(request(app).post('/api/admin/endpoints/customers/reset')).send({});
    expect((await request(app).post('/api/customers').send({ name: 'A', email: 'a@b.c' })).status).toBe(201);
  }, 15000);

  test('scenarios apply deterministically; unsupported preset is listed', async () => {
    const cats = await auth(request(app).get('/api/admin/scenarios'));
    expect(cats.body.data.map((s) => s.scenarioId)).toEqual(
      expect.arrayContaining(['field-rename', 'type-conversion', 'nesting', 'required-header', 'multiple-changes', 'response-drift', 'unsupported-change'])
    );

    const once = await auth(request(app).post('/api/admin/scenarios/field-rename/apply')).send({ endpointId: 'customers' });
    expect(once.status).toBe(200);
    const snap1 = JSON.stringify((await auth(request(app).get('/api/admin/endpoints/customers/schema'))).body.data);
    const twice = await auth(request(app).post('/api/admin/scenarios/field-rename/apply')).send({ endpointId: 'customers' });
    expect(twice.status).toBe(200);
    const snap2 = JSON.stringify((await auth(request(app).get('/api/admin/endpoints/customers/schema'))).body.data);
    expect(JSON.parse(snap1).requestSchema).toEqual(JSON.parse(snap2).requestSchema);

    const bad = await auth(request(app).post('/api/admin/scenarios/nope/apply')).send({});
    expect(bad.status).toBe(404);

    await auth(request(app).post('/api/admin/scenarios/unsupported-change/apply')).send({ endpointId: 'customers' });
    const schema = await auth(request(app).get('/api/admin/endpoints/customers/schema'));
    expect(schema.body.data.requestSchema.required).toContain('loyaltyTier');
  });

  test('informed mode notifies the engine; blind mode never does', async () => {
    const seen = [];
    const engineStub = express();
    engineStub.use(express.json());
    engineStub.post('/v1/tools/:toolId/schema', (req, res) => {
      seen.push({ toolId: req.params.toolId, body: req.body });
      res.json({ data: { downstreamVersion: 2 } });
    });
    const server = await new Promise((resolve) => {
      const s = engineStub.listen(0, '127.0.0.1', () => resolve(s));
    });
    const engineUrl = `http://127.0.0.1:${server.address().port}`;
    try {
      const informed = await auth(request(app).post('/api/admin/endpoints/customers/mutations')).send({
        op: 'RENAME_FIELD', scope: 'request', from: 'email', to: 'emailAddress',
        notify: { toolId: 'customer-api', engineUrl },
      });
      expect(informed.status).toBe(201);
      expect(informed.body.data.notification.notified).toBe(true);
      expect(informed.body.data.notification.mode).toBe('informed');
      expect(seen.length).toBe(1);
      expect(seen[0].toolId).toBe('customer-api');
      expect(seen[0].body.downstreamSchema.properties.emailAddress).toBeDefined();

      const blind = await auth(request(app).post('/api/admin/endpoints/customers/reset')).send({});
      expect(blind.body.data.notification).toEqual({ notified: false, mode: 'blind' });
      expect(seen.length).toBe(1); // no automatic notification in blind mode
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('activity log records requests and admin actions', async () => {
    await request(app).post('/api/customers').send({ name: 'A', email: 'a@b.c' });
    await auth(request(app).post('/api/admin/endpoints/customers/mutations')).send({ op: 'CONVERT_TYPE', scope: 'request', field: 'name', toType: 'string' });
    const act = await auth(request(app).get('/api/admin/activity?limit=10'));
    expect(act.status).toBe(200);
    expect(act.body.total).toBeGreaterThanOrEqual(2);
    expect(act.body.data[0]).toHaveProperty('type');
    expect(act.body.data[0]).toHaveProperty('at');
  });
});
