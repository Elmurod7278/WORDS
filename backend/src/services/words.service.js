async function ensureDeviceIdColumn(pool) {
  try {
    await pool.query(`ALTER TABLE user_words ADD COLUMN IF NOT EXISTS device_id TEXT;`);
  } catch (e) {}
}



async function resolveInternalUserId(pool, rawId, deviceId = null) {
  if (rawId) {
    // Use BigInt-safe parsing — telegram_id is BIGINT, never compare against users.id (INTEGER)
    const num = Number(rawId);
    // Valid Telegram user IDs: positive, at most 10 digits
    if (Number.isFinite(num) && num > 10000 && num < 10000000000) {
      try {
        // 1. Match against telegram_id (BIGINT column)
        const byTg = await pool.query(`SELECT id FROM users WHERE telegram_id = $1 LIMIT 1;`, [num]);
        if (byTg.rows.length > 0) {
          return byTg.rows[0].id;
        }

        // 2. New real Telegram user — register them
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
        console.error("Failed to resolve user_id:", e.message);
      }
    }
  }

  // 3. No Telegram ID — check if this device already has words tied to a user
  if (deviceId) {
    try {
      const knownUserRes = await pool.query(
        `SELECT user_id FROM user_words WHERE device_id = $1 AND user_id IS NOT NULL ORDER BY created_at DESC LIMIT 1;`,
        [deviceId]
      );
      if (knownUserRes.rows[0] && knownUserRes.rows[0].user_id) {
        return knownUserRes.rows[0].user_id;
      }
    } catch (e) {}
  }

  // No valid identity — never leak another user's data
  return null;
}

async function getWords({ pool, userId, sessionId, deviceId }) {
  await ensureDeviceIdColumn(pool);
  const internalUserId = await resolveInternalUserId(pool, userId, deviceId);

  // If no user identity is established, return empty array to prevent data leaks across users
  if (!internalUserId) {
    return [];
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

async function saveWords({ pool, userId, sessionId, deviceId, words }) {
  if (!Array.isArray(words) || words.length === 0) return [];
  await ensureDeviceIdColumn(pool);

  // Security Constraint: Cap maximum batch count per request to 150 items to prevent big data floods
  const safeWordsBatch = words.slice(0, 150);

  const internalUserId = await resolveInternalUserId(pool, userId, deviceId);
  if (!internalUserId) return [];

  const numSession = sessionId ? parseInt(sessionId, 10) : null;
  const parsedSessionId = (numSession && !isNaN(numSession)) ? numSession : (sessionId || null);

  const inserted = [];

  for (const w of safeWordsBatch) {
    const id = (w.id && typeof w.id === 'string') ? w.id.slice(0, 64) : ("cw_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7));
    const srcLang = (w.srcLang || w.source_lang || "en").slice(0, 10);
    const tgtLang = (w.tgtLang || w.target_lang || "uz").slice(0, 10);
    const source = String(w.source || "").trim().slice(0, 300);
    const target = String(w.target || "").trim().slice(0, 300);
    const transcription = String(w.transcription || "").trim().slice(0, 150);
    const definition = String(w.definition || "").trim().slice(0, 600);
    const example = String(w.example || "").trim().slice(0, 600);
    const collection = String(w.collection || "").trim().slice(0, 100);

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
  const internalUserId = await resolveInternalUserId(pool, userId, deviceId);
  
  if (internalUserId) {
    await pool.query(`DELETE FROM user_words WHERE id = $1 AND user_id = $2`, [wordId, internalUserId]);
  } else if (deviceId) {
    await pool.query(`DELETE FROM user_words WHERE id = $1 AND device_id = $2`, [wordId, deviceId]);
  }
  return { success: true };
}

async function clearWords({ pool, userId, sessionId, deviceId }) {
  await ensureDeviceIdColumn(pool);
  const internalUserId = await resolveInternalUserId(pool, userId, deviceId);

  if (internalUserId) {
    await pool.query(`DELETE FROM user_words WHERE user_id = $1`, [internalUserId]);
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
