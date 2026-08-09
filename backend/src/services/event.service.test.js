const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestPool, resetDb } = require('../db/testPool.js');
const { upsertUser } = require('./user.service.js');
const { createSession } = require('./session.service.js');
const { insertEvents, sessionExists } = require('./event.service.js');

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

test('inserts a batch of events and bumps session activity', async () => {
  const user = await upsertUser(pool, { id: 555, username: 'aziz_dev', first_name: 'Aziz' });
  const session = await createSession(pool, user.id);

  const count = await insertEvents(pool, session.id, user.id, [
    { type: 'page_view', payload: { screen: 'welcome-screen' } },
    { type: 'page_view', payload: { screen: 'setup-screen' } },
  ]);

  assert.equal(count, 2);

  const { rows } = await pool.query(
    'SELECT type, payload FROM events WHERE session_id = $1 ORDER BY id',
    [session.id]
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[1].payload.screen, 'setup-screen');
});

test('sessionExists returns null for an unknown session', async () => {
  const found = await sessionExists(pool, 999999);
  assert.equal(found, null);
});

test('sessionExists returns the session row for a known session', async () => {
  const user = await upsertUser(pool, { id: 556, username: 'aziz_dev', first_name: 'Aziz' });
  const session = await createSession(pool, user.id);

  const found = await sessionExists(pool, session.id);
  assert.equal(found.id, session.id);
});

test('ignores a client-supplied occurred_at and uses the server time instead', async () => {
  const user = await upsertUser(pool, { id: 557, username: 'aziz_dev', first_name: 'Aziz' });
  const session = await createSession(pool, user.id);

  await insertEvents(pool, session.id, user.id, [
    { type: 'page_view', payload: {}, occurred_at: '2000-01-01T00:00:00.000Z' },
  ]);

  const { rows } = await pool.query('SELECT occurred_at FROM events WHERE session_id = $1', [session.id]);
  const ageMs = Date.now() - new Date(rows[0].occurred_at).getTime();

  assert.ok(ageMs >= 0 && ageMs < 60000, `expected occurred_at to be close to now, got age ${ageMs}ms`);
});
