require('dotenv').config();
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

test('migrations create the expected core tables', async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    const { rows } = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('users', 'sessions', 'events')
      ORDER BY table_name
    `);
    assert.deepEqual(rows.map((r) => r.table_name), ['events', 'sessions', 'users']);
  } finally {
    await pool.end();
  }
});
