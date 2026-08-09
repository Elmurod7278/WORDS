const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadEnv } = require('./env.js');

test('throws when required vars are missing', () => {
  assert.throws(() => loadEnv({}), /Missing required environment variables/);
});

test('returns parsed config when all required vars are present', () => {
  const config = loadEnv({
    DATABASE_URL: 'postgres://localhost/test',
    TELEGRAM_BOT_TOKEN: 'test-token',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'secret',
    MINI_APP_URL: 'https://app.example.com',
    PORT: '4000',
  });

  assert.equal(config.port, 4000);
  assert.equal(config.databaseUrl, 'postgres://localhost/test');
  assert.equal(config.corsOrigin, '*');
  assert.equal(config.miniAppUrl, 'https://app.example.com');
  assert.equal(config.welcomePhotoUrl, null);
});
