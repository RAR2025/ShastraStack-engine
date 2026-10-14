const request = require('supertest');
const { buildApp } = require('../src/app');

describe('Mock LLM backend foundation', () => {
  const app = buildApp();

  test('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('POST /api/chat stable returns answer', async () => {
    const res = await request(app).post('/api/chat').send({ prompt: 'hello' });
    expect(res.status).toBe(200);
    expect(res.body.data.answer).toMatch(/hello/);
  });

  test('POST /api/chat renamed-field drifts honestly', async () => {
    const res = await request(app).post('/api/chat').send({ prompt: 'hi', scenario: 'renamed-field' });
    expect(res.status).toBe(200);
    expect(res.body.data.reply).toBeDefined();
    expect(res.body.data.answer).toBeUndefined();
  });

  test('POST /api/chat rejects empty prompt', async () => {
    const res = await request(app).post('/api/chat').send({ prompt: '' });
    expect(res.status).toBe(400);
  });
});
