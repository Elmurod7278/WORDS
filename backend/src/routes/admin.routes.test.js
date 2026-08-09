const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestPool, resetDb } = require('../db/testPool.js');
const { createApp } = require('../app.js');

const testEnv = {
  port: 3000,
  corsOrigin: '*',
  telegramBotToken: 'test-bot-token-123',
  adminUsername: 'admin',
  adminPassword: 'secret',
};

let pool;

before(() => {
  pool = createTestPool();
});

beforeEach(async () => {
  await resetDb(pool);
});

after(async () => {
  await pool.end();
});

test('GET /api/admin/stats requires authentication', async () => {
  const app = createApp({ env: testEnv, pool });
  const response = await request(app).get('/api/admin/stats');
  assert.equal(response.status, 401);
});

test('GET /api/admin/stats returns an overview for valid credentials', async () => {
  const app = createApp({ env: testEnv, pool });
  const token = Buffer.from('admin:secret').toString('base64');

  const response = await request(app).get('/api/admin/stats').set('Authorization', `Basic ${token}`);

  assert.equal(response.status, 200);
  assert.ok('total_users' in response.body);
  assert.ok(Array.isArray(response.body.top_screens));
});
