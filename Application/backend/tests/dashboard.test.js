jest.mock('../src/engineClient', () => {
  const actual = jest.requireActual('../src/engineClient');
  return { ...actual, callEngine: jest.fn() };
});

const request = require('supertest');
const { buildApp } = require('../src/app');
const { callEngine } = require('../src/engineClient');

describe('dashboard aggregation', () => {
  const app = buildApp();

  beforeEach(() => jest.clearAllMocks());

  test('GET /api/dashboard combines engine health and metrics', async () => {
    callEngine
      .mockResolvedValueOnce({ status: 200, body: { status: 'ok', db: 'up' } })
      .mockResolvedValueOnce({ status: 200, body: { data: { totalExecutions: 10, recovered: 2 } } });
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.data.engine).toEqual({ status: 'ok', db: 'up' });
    expect(res.body.data.metrics).toEqual({ totalExecutions: 10, recovered: 2 });
    expect(res.body.data.at).toBeDefined();
  });

  test('dashboard never invents data when the engine is down', async () => {
    callEngine.mockRejectedValue({ status: 503, code: 'ENGINE_UNAVAILABLE', message: 'ShastraStack engine unreachable at http://localhost:4000' });
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ENGINE_UNAVAILABLE');
    expect(res.body.data).toBeUndefined();
  });
});
