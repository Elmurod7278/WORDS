async function insertEvents(pool, sessionId, userId, events) {
  if (!Array.isArray(events) || events.length === 0) {
    return 0;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const event of events) {
      await client.query(
        `INSERT INTO events (session_id, user_id, type, payload)
         VALUES ($1, $2, $3, $4)`,
        [sessionId, userId, event.type, event.payload ?? {}]
      );
    }

    await client.query('UPDATE sessions SET last_active_at = now() WHERE id = $1', [sessionId]);

    await client.query('COMMIT');
    return events.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function sessionExists(pool, sessionId) {
  const { rows } = await pool.query('SELECT id, user_id FROM sessions WHERE id = $1', [sessionId]);
  return rows[0] ?? null;
}

module.exports = { insertEvents, sessionExists };
