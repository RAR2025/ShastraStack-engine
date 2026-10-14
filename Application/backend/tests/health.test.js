jest.mock('../src/engineClient', () => {
  const actual = jest.requireActual('../src/engineClient');
  return { ...actual, callEngine: jest.fn() };
});

const request = require('supertest');
const { buildApp } = require('../src/app');
const { callEngine } = require('../src/engineClient');

describe('health + readiness', () => {
  const app = buildApp();

  beforeEach(() => jest.clearAllMocks());

  test('GET /health is local and needs no engine', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'application-backend' });
    expect(callEngine).not.toHaveBeenCalled();
  });

  test('GET /ready reports engine health through the shared client', async () => {
    callEngine.mockResolvedValue({ status: 200, body: { status: 'ok', service: 'shastrastack-engine' } });
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready', engine: { status: 'ok', service: 'shastrastack-engine' } });
    expect(callEngine).toHaveBeenCalledWith({ method: 'GET', path: '/health' });
  });

  test('GET /ready surfaces engine outage without fabricating data', async () => {
    callEngine.mockRejectedValue({ status: 503, code: 'ENGINE_UNAVAILABLE', message: 'ShastraStack engine unreachable at http://localhost:4000' });
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ENGINE_UNAVAILABLE');
    expect(res.body.data).toBeUndefined();
  });

  test('GET /api/engine/health forwards the engine response', async () => {
    callEngine.mockResolvedValue({ status: 200, body: { status: 'ok', db: 'up' } });
    const res = await request(app).get('/api/engine/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });
});
