async function createSession(pool, userId) {
  const { rows } = await pool.query(
    `INSERT INTO sessions (user_id) VALUES ($1) RETURNING id, user_id, started_at, last_active_at`,
    [userId]
  );
  const session = rows[0];
  // pg returns bigint columns as strings to avoid precision loss; user_id
  // fits safely within Number.MAX_SAFE_INTEGER, so normalize it back to a number.
  return { ...session, user_id: Number(session.user_id) };
}

module.exports = { createSession };
