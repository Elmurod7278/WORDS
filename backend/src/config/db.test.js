const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPool } = require('./db.js');

test('createPool attaches an error listener so idle-client errors do not crash the process', () => {
  const pool = createPool({ databaseUrl: 'postgres://unused/for-this-test' });

  assert.equal(pool.listenerCount('error'), 1);

  // Emitting 'error' with zero listeners throws; this proves one is attached.
  assert.doesNotThrow(() => {
    pool.emit('error', new Error('simulated idle client error'));
  });
});
