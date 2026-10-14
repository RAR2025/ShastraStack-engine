jest.mock('../src/engineClient', () => {
  const actual = jest.requireActual('../src/engineClient');
  return { ...actual, callEngine: jest.fn() };
});

const request = require('supertest');
const { buildApp } = require('../src/app');
const { callEngine } = require('../src/engineClient');

describe('logs / patches / metrics proxies', () => {
  const app = buildApp();

  beforeEach(() => jest.clearAllMocks());

  test('GET /api/logs forwards filters', async () => {
    callEngine.mockResolvedValue({ status: 200, body: { data: [], page: 1, pageSize: 20, total: 0 } });
    const res = await request(app).get('/api/logs?toolId=demo&status=recovered&page=1');
    expect(res.status).toBe(200);
    expect(callEngine).toHaveBeenCalledWith({
      method: 'GET', path: '/v1/logs', params: { toolId: 'demo', status: 'recovered', page: '1' },
    });
  });

  test('GET /api/logs/:executionId returns the engine trace', async () => {
    const trace = { data: { execution: { execution_id: 'ex_1' }, auditEvents: [], patches: [] } };
    callEngine.mockResolvedValue({ status: 200, body: trace });
    const res = await request(app).get('/api/logs/ex_1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(trace);
  });

  test('GET /api/patches and detail forward correctly', async () => {
    callEngine.mockResolvedValue({ status: 200, body: { data: [], total: 0 } });
    expect((await request(app).get('/api/patches?toolId=demo')).status).toBe(200);
    callEngine.mockResolvedValue({ status: 200, body: { data: { patch_id: 'pt_1' } } });
    const one = await request(app).get('/api/patches/pt_1');
    expect(one.body.data.patch_id).toBe('pt_1');
  });

  test('GET /api/metrics/summary forwards aggregates', async () => {
    callEngine.mockResolvedValue({ status: 200, body: { data: { totalExecutions: 3 } } });
    const res = await request(app).get('/api/metrics/summary');
    expect(res.status).toBe(200);
    expect(res.body.data.totalExecutions).toBe(3);
  });

  test('GET /api/metrics/executions rejects unknown params', async () => {
    const res = await request(app).get('/api/metrics/executions?orderBy=hack');
    expect(res.status).toBe(400);
    expect(callEngine).not.toHaveBeenCalled();
  });

  test('engine timeouts surface as 504 with a useful message', async () => {
    callEngine.mockRejectedValue({ status: 504, code: 'ENGINE_TIMEOUT', message: 'Engine request timed out after 15000ms' });
    const res = await request(app).get('/api/metrics/summary');
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('ENGINE_TIMEOUT');
  });
});
