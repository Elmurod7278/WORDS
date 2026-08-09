const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestPool, resetDb } = require('../db/testPool.js');
const { upsertUser } = require('./user.service.js');
const { createSession } = require('./session.service.js');

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

test('creates a session linked to the given user', async () => {
  const user = await upsertUser(pool, { id: 333, username: 'aziz_dev', first_name: 'Aziz' });
  const session = await createSession(pool, user.id);

  assert.ok(session.id);
  assert.equal(session.user_id, user.id);
});
