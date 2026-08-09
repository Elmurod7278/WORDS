const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyInitData } = require('./telegramAuth.service.js');

const BOT_TOKEN = 'test-bot-token-123';

function signInitData(fields, botToken) {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  return new URLSearchParams({ ...fields, hash }).toString();
}

test('accepts a correctly signed, fresh initData payload', () => {
  const fields = {
    query_id: 'AAH1abcd',
    user: JSON.stringify({ id: 12345, first_name: 'Aziz', username: 'aziz_dev' }),
    auth_date: String(Math.floor(Date.now() / 1000)),
  };
  const initData = signInitData(fields, BOT_TOKEN);

  const user = verifyInitData(initData, BOT_TOKEN);

  assert.equal(user.id, 12345);
  assert.equal(user.username, 'aziz_dev');
});

test('rejects a tampered payload', () => {
  const fields = {
    query_id: 'AAH1abcd',
    user: JSON.stringify({ id: 12345, first_name: 'Aziz' }),
    auth_date: String(Math.floor(Date.now() / 1000)),
  };
  const initData = signInitData(fields, BOT_TOKEN).replace('Aziz', 'Hacker');

  assert.throws(() => verifyInitData(initData, BOT_TOKEN), /invalid/);
});

test('rejects a payload signed with the wrong bot token', () => {
  const fields = {
    query_id: 'AAH1abcd',
    user: JSON.stringify({ id: 12345, first_name: 'Aziz' }),
    auth_date: String(Math.floor(Date.now() / 1000)),
  };
  const initData = signInitData(fields, 'a-different-bot-token');

  assert.throws(() => verifyInitData(initData, BOT_TOKEN), /invalid/);
});

test('rejects an expired payload', () => {
  const fields = {
    query_id: 'AAH1abcd',
    user: JSON.stringify({ id: 12345, first_name: 'Aziz' }),
    auth_date: String(Math.floor(Date.now() / 1000) - 100000),
  };
  const initData = signInitData(fields, BOT_TOKEN);

  assert.throws(() => verifyInitData(initData, BOT_TOKEN, { maxAgeSeconds: 86400 }), /expired/);
});

test('rejects a payload missing the hash field', () => {
  assert.throws(() => verifyInitData('user=%7B%7D&auth_date=123', BOT_TOKEN), /hash/);
});

test('rejects a payload with malformed JSON in the user field', () => {
  const fields = {
    query_id: 'AAH1abcd',
    user: '{not valid json',
    auth_date: String(Math.floor(Date.now() / 1000)),
  };
  const initData = signInitData(fields, BOT_TOKEN);

  assert.throws(() => verifyInitData(initData, BOT_TOKEN), /invalid user payload/);
});
