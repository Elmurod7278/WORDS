const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('./app.js');

const testEnv = {
  port: 3000,
  corsOrigin: '*',
  telegramBotToken: 'test-bot-token-123',
  adminUsername: 'admin',
  adminPassword: 'secret',
};

test('GET /health returns ok status', async () => {
  const app = createApp({ env: testEnv, pool: null });
  const response = await request(app).get('/health');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok' });
});

test('unknown routes return 404 JSON', async () => {
  const app = createApp({ env: testEnv, pool: null });
  const response = await request(app).get('/nope');
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: 'Not found' });
});

test('POST /api/session is rate limited after too many requests in a window', async () => {
  const app = createApp({ env: testEnv, pool: null });

  let lastStatus;
  for (let i = 0; i < 61; i += 1) {
    const response = await request(app).post('/api/session').send({ initData: 'not-valid' });
    lastStatus = response.status;
  }

  assert.equal(lastStatus, 429);
});

test('GET /api/admin/stats is rate limited after too many requests in a window', async () => {
  const app = createApp({ env: testEnv, pool: null });

  let lastStatus;
  for (let i = 0; i < 21; i += 1) {
    const response = await request(app).get('/api/admin/stats');
    lastStatus = response.status;
  }

  assert.equal(lastStatus, 429);
});

test('GET /admin requires authentication', async () => {
  const app = createApp({ env: testEnv, pool: null });
  const response = await request(app).get('/admin/');
  assert.equal(response.status, 401);
});
