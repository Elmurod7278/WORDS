const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestPool, resetDb } = require('../db/testPool.js');
const { createApp } = require('../app.js');
const { upsertUser } = require('../services/user.service.js');
const { createSession } = require('../services/session.service.js');

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

test('POST /api/user/phone stores the phone number for a known session', async () => {
  const user = await upsertUser(pool, { id: 881, username: 'aziz_dev', first_name: 'Aziz' });
  const session = await createSession(pool, user.id);
  const app = createApp({ env: testEnv, pool });

  const response = await request(app)
    .post('/api/user/phone')
    .send({ session_id: session.id, phone_number: '+998901234567' });

  assert.equal(response.status, 200);
  assert.equal(response.body.phone_number, '+998901234567');

  const { rows } = await pool.query('SELECT phone_number FROM users WHERE id = $1', [user.id]);
  assert.equal(rows[0].phone_number, '+998901234567');
});

test('POST /api/user/phone rejects a malformed phone number', async () => {
  const user = await upsertUser(pool, { id: 882, username: 'aziz_dev', first_name: 'Aziz' });
  const session = await createSession(pool, user.id);
  const app = createApp({ env: testEnv, pool });

  const response = await request(app)
    .post('/api/user/phone')
    .send({ session_id: session.id, phone_number: 'not-a-phone' });

  assert.equal(response.status, 400);
});

test('POST /api/user/phone returns 404 for an unknown session_id', async () => {
  const app = createApp({ env: testEnv, pool });

  const response = await request(app)
    .post('/api/user/phone')
    .send({ session_id: 999999, phone_number: '+998901234567' });

  assert.equal(response.status, 404);
});
