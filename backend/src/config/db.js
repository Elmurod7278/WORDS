const { Pool } = require('pg');
const { loadEnv } = require('./env.js');

function createPool(env = loadEnv()) {
  const pool = new Pool({ connectionString: env.databaseUrl });
  pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client', err);
  });
  return pool;
}

module.exports = { createPool };
