jest.mock('../src/engineClient', () => {
  const actual = jest.requireActual('../src/engineClient');
  return { ...actual, callEngine: jest.fn() };
});

const request = require('supertest');
const { buildApp } = require('../src/app');
const { callEngine } = require('../src/engineClient');

describe('optional local token guard', () => {
  const app = buildApp();

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.APP_API_TOKEN;
  });
  afterEach(() => {
    delete process.env.APP_API_TOKEN;
  });

  test('mutating routes are open when APP_API_TOKEN is unset', async () => {
    callEngine.mockResolvedValue({ status: 201, body: { data: { toolId: 'demo' } } });
    const res = await request(app).post('/api/tools').send({ toolId: 'demo', baseUrl: 'http://localhost:5000' });
    expect(res.status).toBe(201);
  });

  test('mutating routes require x-api-token when APP_API_TOKEN is set', async () => {
    process.env.APP_API_TOKEN = 'local-secret';
    const denied = await request(app).post('/api/tools').send({ toolId: 'demo', baseUrl: 'http://localhost:5000' });
    expect(denied.status).toBe(401);
    expect(denied.body.error.code).toBe('UNAUTHORIZED');
    expect(callEngine).not.toHaveBeenCalled();

    callEngine.mockResolvedValue({ status: 201, body: { data: { toolId: 'demo' } } });
    const allowed = await request(app).post('/api/tools').set('x-api-token', 'local-secret').send({ toolId: 'demo', baseUrl: 'http://localhost:5000' });
    expect(allowed.status).toBe(201);
  });

  test('reads stay open even when the token is set', async () => {
    process.env.APP_API_TOKEN = 'local-secret';
    callEngine.mockResolvedValue({ status: 200, body: { data: [] } });
    const res = await request(app).get('/api/tools');
    expect(res.status).toBe(200);
  });
});
