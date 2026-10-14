jest.mock('../src/engineClient', () => {
  const actual = jest.requireActual('../src/engineClient');
  return { ...actual, callEngine: jest.fn() };
});

const request = require('supertest');
const { buildApp } = require('../src/app');
const { callEngine } = require('../src/engineClient');

describe('tool proxy routes', () => {
  const app = buildApp();

  beforeEach(() => jest.clearAllMocks());

  test('GET /api/tools forwards pagination params', async () => {
    callEngine.mockResolvedValue({ status: 200, body: { data: [], page: 2, pageSize: 5, total: 0 } });
    const res = await request(app).get('/api/tools?page=2&pageSize=5');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(callEngine).toHaveBeenCalledWith({ method: 'GET', path: '/v1/tools', params: { page: '2', pageSize: '5' } });
  });

  test('GET /api/tools rejects unknown query params', async () => {
    const res = await request(app).get('/api/tools?dropTable=true');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(callEngine).not.toHaveBeenCalled();
  });

  test('POST /api/tools validates then registers through the engine', async () => {
    const bad = await request(app).post('/api/tools').send({ baseUrl: 'http://x' });
    expect(bad.status).toBe(400);

    callEngine.mockResolvedValue({ status: 201, body: { data: { toolId: 'demo', version: 1 } } });
    const ok = await request(app).post('/api/tools').send({ toolId: 'demo', baseUrl: 'http://localhost:5000' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.toolId).toBe('demo');
    expect(callEngine).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', path: '/v1/tools/register' }));
  });

  test('toolId params are validated locally', async () => {
    const res = await request(app).get('/api/tools/Bad_ID!');
    expect(res.status).toBe(400);
    expect(callEngine).not.toHaveBeenCalled();
  });

  test('GET/PATCH/DELETE forward to engine paths', async () => {
    callEngine.mockResolvedValue({ status: 200, body: { data: { toolId: 'demo' } } });
    expect((await request(app).get('/api/tools/demo')).status).toBe(200);

    callEngine.mockResolvedValue({ status: 200, body: { data: { toolId: 'demo', version: 2 } } });
    const patched = await request(app).patch('/api/tools/demo').send({ expectedVersion: 1, timeoutMs: 7000 });
    expect(patched.status).toBe(200);
    expect(callEngine).toHaveBeenCalledWith(expect.objectContaining({ method: 'PATCH', path: '/v1/tools/demo' }));

    callEngine.mockResolvedValue({ status: 204, body: undefined });
    const del = await request(app).delete('/api/tools/demo');
    expect(del.status).toBe(204);
  });

  test('POST execute forwards input and preserves recovery shapes', async () => {
    callEngine.mockResolvedValue({
      status: 200,
      body: { data: { ok: true }, executionId: 'ex_1', status: 'recovered', recovery: { patchId: 'pt_1', retryCount: 1 } },
    });
    const res = await request(app).post('/api/tools/demo/execute').send({ input: { a: 1 }, idempotencyKey: 'k' });
    expect(res.status).toBe(200);
    expect(res.body.recovery.patchId).toBe('pt_1');
  });

  test('engine error bodies are forwarded exactly, not rewritten', async () => {
    const engineBody = { error: { code: 'SCHEMA_DRIFT_AMBIGUOUS', message: 'nope' }, executionId: 'ex_9', classification: 'SCHEMA_DRIFT_AMBIGUOUS' };
    callEngine.mockRejectedValue({ status: 502, code: 'SCHEMA_DRIFT_AMBIGUOUS', message: 'nope', engineBody });
    const res = await request(app).post('/api/tools/demo/execute').send({ input: {} });
    expect(res.status).toBe(502);
    expect(res.body).toEqual(engineBody);
  });

  test('engine 404 maps through with its code', async () => {
    callEngine.mockRejectedValue({ status: 404, code: 'NOT_FOUND', message: 'Tool not found: demo', engineBody: { error: { code: 'NOT_FOUND', message: 'Tool not found: demo' } } });
    const res = await request(app).get('/api/tools/demo');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
