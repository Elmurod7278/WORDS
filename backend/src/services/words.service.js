async function ensureDeviceIdColumn(pool) {
  try {
    await pool.query(`ALTER TABLE user_words ADD COLUMN IF NOT EXISTS device_id TEXT;`);
  } catch (e) {}
}

async function resolveInternalUserId(pool, rawId) {
  if (!rawId) return null;
  const num = parseInt(rawId, 10);
  if (isNaN(num)) return null;

  try {
    // 1. First check if rawId matches an existing users.id (integer primary key)
    const byId = await pool.query(`SELECT id FROM users WHERE id = $1 LIMIT 1;`, [num]);
    if (byId.rows.length > 0) {
      return byId.rows[0].id;
    }

    // 2. Next check if rawId matches an existing users.telegram_id (bigint)
    const byTg = await pool.query(`SELECT id FROM users WHERE telegram_id = $1 LIMIT 1;`, [num]);
    if (byTg.rows.length > 0) {
      return byTg.rows[0].id;
    }

    // 3. Create user in users table with telegram_id = num and return new users.id
    const newUser = await pool.query(
      `INSERT INTO users (telegram_id, first_seen_at, last_seen_at)
       VALUES ($1, NOW(), NOW())
       ON CONFLICT (telegram_id) DO UPDATE SET last_seen_at = NOW()
       RETURNING id;`,
      [num]
    );
    if (newUser.rows.length > 0) {
      return newUser.rows[0].id;
    }
  } catch (e) {
    console.error("Failed to resolve user_id in users table:", e);
  }
  return null;
}

async function getWords({ pool, userId, sessionId, deviceId }) {
  await ensureDeviceIdColumn(pool);
  const internalUserId = await resolveInternalUserId(pool, userId);

  if (internalUserId) {
    // If deviceId is present, retroactively attach orphan null user_id rows created by this deviceId
    if (deviceId) {
      try {
        await pool.query(`UPDATE user_words SET user_id = $1 WHERE device_id = $2 AND user_id IS NULL;`, [internalUserId, deviceId]);
      } catch (e) {}
    }

    const res = await pool.query(
      `SELECT id, source_lang as "srcLang", target_lang as "tgtLang", source, target,
              transcription, definition, example, collection, created_at
       FROM user_words
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [internalUserId]
    );
    return res.rows;
  }

  if (sessionId) {
    const numSession = parseInt(sessionId, 10);
    const res = await pool.query(
      `SELECT id, source_lang as "srcLang", target_lang as "tgtLang", source, target,
              transcription, definition, example, collection, created_at
       FROM user_words
       WHERE session_id = $1
       ORDER BY created_at DESC`,
      [!isNaN(numSession) ? numSession : sessionId]
    );
    return res.rows;
  }

  if (deviceId) {
    const res = await pool.query(
      `SELECT id, source_lang as "srcLang", target_lang as "tgtLang", source, target,
              transcription, definition, example, collection, created_at
       FROM user_words
       WHERE device_id = $1
       ORDER BY created_at DESC`,
      [deviceId]
    );
    return res.rows;
  }

  // Strict isolation: return empty array if no identity
  return [];
}

async function saveWords({ pool, userId, sessionId, deviceId, words }) {
  if (!Array.isArray(words) || words.length === 0) return [];
  await ensureDeviceIdColumn(pool);

  // Tier 4: If userId is null but deviceId is passed, try to look up existing user_id for this device
  if (!userId && deviceId) {
    try {
      const knownUserRes = await pool.query(
        `SELECT user_id FROM user_words WHERE device_id = $1 AND user_id IS NOT NULL ORDER BY created_at DESC LIMIT 1;`,
        [deviceId]
      );
      if (knownUserRes.rows[0] && knownUserRes.rows[0].user_id) {
        userId = String(knownUserRes.rows[0].user_id);
      }
    } catch (e) {}
  }

  const internalUserId = await resolveInternalUserId(pool, userId);

  const numSession = sessionId ? parseInt(sessionId, 10) : null;
  const parsedSessionId = (numSession && !isNaN(numSession)) ? numSession : (sessionId || null);

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
    const values = [id, internalUserId, parsedSessionId, deviceId || null, srcLang, tgtLang, source, target, transcription, definition, example, collection];
    const res = await pool.query(query, values);
    if (res.rows[0]) inserted.push(res.rows[0]);
  }

  return inserted;
}

async function deleteWord({ pool, wordId, userId, sessionId, deviceId }) {
  await ensureDeviceIdColumn(pool);
  const internalUserId = await resolveInternalUserId(pool, userId);
  
  if (internalUserId) {
    await pool.query(`DELETE FROM user_words WHERE id = $1 AND user_id = $2`, [wordId, internalUserId]);
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
  const internalUserId = await resolveInternalUserId(pool, userId);

  if (internalUserId) {
    await pool.query(`DELETE FROM user_words WHERE user_id = $1`, [internalUserId]);
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
