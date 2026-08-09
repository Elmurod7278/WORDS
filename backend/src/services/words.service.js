async function ensureDeviceIdColumn(pool) {
  try {
    await pool.query(`ALTER TABLE user_words ADD COLUMN IF NOT EXISTS device_id TEXT;`);
  } catch (e) {}
}

async function getWords({ pool, userId, sessionId, deviceId }) {
  await ensureDeviceIdColumn(pool);

  if (userId) {
    const res = await pool.query(
      `SELECT id, source_lang as "srcLang", target_lang as "tgtLang", source, target,
              transcription, definition, example, collection, created_at
       FROM user_words
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    return res.rows;
  }
  if (sessionId) {
    const res = await pool.query(
      `SELECT id, source_lang as "srcLang", target_lang as "tgtLang", source, target,
              transcription, definition, example, collection, created_at
       FROM user_words
       WHERE session_id = $1
       ORDER BY created_at DESC`,
      [sessionId]
    );
    return res.rows;
  }
  if (deviceId) {
    const res = await pool.query(
      `SELECT id, source_lang as "srcLang", target_lang as "tgtLang", source, target,
              transcription, definition, example, collection, created_at
       FROM user_words
       WHERE device_id = $1 OR (device_id IS NULL AND user_id IS NULL AND session_id IS NULL)
       ORDER BY created_at DESC`,
      [deviceId]
    );
    return res.rows;
  }
  
  // Anonymous / Test fallback: return recent words
  const res = await pool.query(
    `SELECT id, source_lang as "srcLang", target_lang as "tgtLang", source, target,
            transcription, definition, example, collection, created_at
     FROM user_words
     ORDER BY created_at DESC
     LIMIT 500`
  );
  return res.rows;
}

async function saveWords({ pool, userId, sessionId, deviceId, words }) {
  if (!Array.isArray(words) || words.length === 0) return [];
  await ensureDeviceIdColumn(pool);

  const inserted = [];

  for (const w of words) {
    const id = w.id || "cw_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    const srcLang = w.srcLang || w.source_lang || "en";
    const tgtLang = w.tgtLang || w.target_lang || "uz";
    const source = (w.source || "").trim();
    const target = (w.target || "").trim();
    const transcription = (w.transcription || "").trim();
    const definition = (w.definition || "").trim();
    const example = (w.example || "").trim();
    const collection = (w.collection || "").trim();

    if (!source || !target) continue;

    const query = `
      INSERT INTO user_words (id, user_id, session_id, device_id, source_lang, target_lang, source, target, transcription, definition, example, collection, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      ON CONFLICT (id) DO UPDATE SET
        user_id = COALESCE(EXCLUDED.user_id, user_words.user_id),
        session_id = COALESCE(EXCLUDED.session_id, user_words.session_id),
        device_id = COALESCE(EXCLUDED.device_id, user_words.device_id),
        source_lang = EXCLUDED.source_lang,
        target_lang = EXCLUDED.target_lang,
        source = EXCLUDED.source,
        target = EXCLUDED.target,
        transcription = EXCLUDED.transcription,
        definition = EXCLUDED.definition,
        example = EXCLUDED.example,
        collection = EXCLUDED.collection,
        updated_at = NOW()
      RETURNING id, source_lang as "srcLang", target_lang as "tgtLang", source, target, transcription, definition, example, collection;
    `;
    const values = [id, userId || null, sessionId || null, deviceId || null, srcLang, tgtLang, source, target, transcription, definition, example, collection];
    const res = await pool.query(query, values);
    if (res.rows[0]) inserted.push(res.rows[0]);
  }

  return inserted;
}

async function deleteWord({ pool, wordId, userId, sessionId, deviceId }) {
  await ensureDeviceIdColumn(pool);
  
  if (userId) {
    await pool.query(`DELETE FROM user_words WHERE id = $1 AND user_id = $2`, [wordId, userId]);
  } else if (sessionId) {
    await pool.query(`DELETE FROM user_words WHERE id = $1 AND session_id = $2`, [wordId, sessionId]);
  } else if (deviceId) {
    await pool.query(`DELETE FROM user_words WHERE id = $1 AND device_id = $2`, [wordId, deviceId]);
  } else {
    await pool.query(`DELETE FROM user_words WHERE id = $1`, [wordId]);
  }
  return { success: true };
}

async function clearWords({ pool, userId, sessionId, deviceId }) {
  await ensureDeviceIdColumn(pool);

  if (userId) {
    await pool.query(`DELETE FROM user_words WHERE user_id = $1`, [userId]);
  } else if (sessionId) {
    await pool.query(`DELETE FROM user_words WHERE session_id = $1`, [sessionId]);
  } else if (deviceId) {
    await pool.query(`DELETE FROM user_words WHERE device_id = $1`, [deviceId]);
  }
  return { success: true };
}

module.exports = {
  getWords,
  saveWords,
  deleteWord,
  clearWords,
};
