const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestPool, resetDb } = require('../db/testPool.js');
const { upsertUser, updateUserPhone, getUserByTelegramId } = require('./user.service.js');

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

test('creates a new user on first upsert', async () => {
  const user = await upsertUser(pool, {
    id: 111,
    username: 'aziz_dev',
    first_name: 'Aziz',
    last_name: null,
    language_code: 'uz',
  });

  assert.equal(user.telegram_id, 111);
  assert.equal(user.username, 'aziz_dev');
});

test('updates existing user and keeps a single row per telegram_id', async () => {
  await upsertUser(pool, { id: 222, username: 'old_name', first_name: 'Old' });
  const updated = await upsertUser(pool, { id: 222, username: 'new_name', first_name: 'New' });

  const { rows } = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [222]);

  assert.equal(rows.length, 1);
  assert.equal(updated.username, 'new_name');
});

test('getUserByTelegramId returns null for an unknown telegram_id', async () => {
  const found = await getUserByTelegramId(pool, 999999);
  assert.equal(found, null);
});

test('getUserByTelegramId returns the user including phone_number once set', async () => {
  const user = await upsertUser(pool, { id: 333, username: 'aziz_dev', first_name: 'Aziz' });

  const beforePhone = await getUserByTelegramId(pool, 333);
  assert.equal(beforePhone.phone_number, null);

  await updateUserPhone(pool, user.id, '+998901234567');

  const afterPhone = await getUserByTelegramId(pool, 333);
  assert.equal(afterPhone.telegram_id, 333);
  assert.equal(afterPhone.phone_number, '+998901234567');
});
