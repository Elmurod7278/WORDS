async function upsertUser(pool, telegramUser) {
  const { rows } = await pool.query(
    `INSERT INTO users (telegram_id, username, first_name, last_name, language_code)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (telegram_id) DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       language_code = EXCLUDED.language_code,
       last_seen_at = now()
     RETURNING id, telegram_id, username, first_name, last_name, language_code`,
    [
      telegramUser.id,
      telegramUser.username ?? null,
      telegramUser.first_name ?? null,
      telegramUser.last_name ?? null,
      telegramUser.language_code ?? null,
    ]
  );
  const user = rows[0];
  // pg returns bigint columns as strings to avoid precision loss; telegram_id
  // fits safely within Number.MAX_SAFE_INTEGER, so normalize it back to a number.
  return { ...user, telegram_id: Number(user.telegram_id) };
}

async function updateUserPhone(pool, userId, phoneNumber) {
  const { rows } = await pool.query(
    `UPDATE users SET phone_number = $1 WHERE id = $2 RETURNING id, phone_number`,
    [phoneNumber, userId]
  );
  return rows[0] ?? null;
}

async function getUserByTelegramId(pool, telegramId) {
  const { rows } = await pool.query(
    `SELECT id, telegram_id, username, first_name, last_name, language_code, phone_number
     FROM users WHERE telegram_id = $1`,
    [telegramId]
  );
  const user = rows[0];
  if (!user) return null;
  return { ...user, telegram_id: Number(user.telegram_id) };
}

module.exports = { upsertUser, updateUserPhone, getUserByTelegramId };
