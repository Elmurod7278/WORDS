require('dotenv').config();
const { Pool } = require('pg');

function createTestPool() {
  return new Pool({ connectionString: process.env.TEST_DATABASE_URL });
}

async function resetDb(pool) {
  await pool.query('TRUNCATE TABLE events, sessions, users RESTART IDENTITY CASCADE');
}

module.exports = { createTestPool, resetDb };
