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

test('POST /api/events stores events for a known session', async () => {
  const user = await upsertUser(pool, { id: 777, username: 'aziz_dev', first_name: 'Aziz' });
  const session = await createSession(pool, user.id);
  const app = createApp({ env: testEnv, pool });

  const response = await request(app)
    .post('/api/events')
    .send({ session_id: session.id, events: [{ type: 'page_view', payload: { screen: 'quiz-screen' } }] });

  assert.equal(response.status, 202);
  assert.equal(response.body.inserted, 1);
});

test('POST /api/events returns 404 for an unknown session_id', async () => {
  const app = createApp({ env: testEnv, pool });

  const response = await request(app)
    .post('/api/events')
    .send({ session_id: 999999, events: [{ type: 'page_view', payload: {} }] });

  assert.equal(response.status, 404);
});

test('POST /api/events rejects an event missing type', async () => {
  const user = await upsertUser(pool, { id: 778, username: 'aziz_dev', first_name: 'Aziz' });
  const session = await createSession(pool, user.id);
  const app = createApp({ env: testEnv, pool });

  const response = await request(app)
    .post('/api/events')
    .send({ session_id: session.id, events: [{ payload: { screen: 'quiz-screen' } }] });

  assert.equal(response.status, 400);
});

test('POST /api/events rejects more than 100 events in one request', async () => {
  const user = await upsertUser(pool, { id: 779, username: 'aziz_dev', first_name: 'Aziz' });
  const session = await createSession(pool, user.id);
  const app = createApp({ env: testEnv, pool });

  const events = Array.from({ length: 101 }, () => ({ type: 'page_view', payload: {} }));
  const response = await request(app).post('/api/events').send({ session_id: session.id, events });

  assert.equal(response.status, 400);
});
