const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const { createTestPool, resetDb } = require('../db/testPool.js');
const { createApp } = require('../app.js');

const BOT_TOKEN = 'test-bot-token-123';

const testEnv = {
  port: 3000,
  corsOrigin: '*',
  telegramBotToken: BOT_TOKEN,
  adminUsername: 'admin',
  adminPassword: 'secret',
};

function signInitData(fields, botToken) {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

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

test('POST /api/session creates a user and session for valid initData', async () => {
  const app = createApp({ env: testEnv, pool });
  const initData = signInitData(
    {
      query_id: 'AAH1abcd',
      user: JSON.stringify({ id: 444, username: 'aziz_dev', first_name: 'Aziz' }),
      auth_date: String(Math.floor(Date.now() / 1000)),
    },
    BOT_TOKEN
  );

  const response = await request(app).post('/api/session').send({ initData });

  assert.equal(response.status, 200);
  assert.ok(response.body.session_id);
  assert.equal(response.body.user.username, 'aziz_dev');
});

test('POST /api/session rejects invalid initData', async () => {
  const app = createApp({ env: testEnv, pool });

  const response = await request(app).post('/api/session').send({ initData: 'not-valid' });

  assert.equal(response.status, 401);
});
