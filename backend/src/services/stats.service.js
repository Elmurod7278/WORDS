const MODE_LABELS = {
  flashcard: "Kartochka",
  cover: "Bir taraf",
  multiple: "Test",
  definition: "Ta'rifni top",
  fillgap: "Gapni to'ldir",
  audiospelling: "Eshitib yig'ish",
  audiowrite: "Eshitib yozish",
  match: "Juftlash",
  linematch: "Chizib ulash",
  wordsearch: "Qidiruv",
  balloon: "Pufakchalar",
  tank: "Neon Tank",
};

// Uzbekistan is UTC+5 with no DST; users' "today" is bucketed on that local
// day boundary (not the server's or UTC's), matching the frontend's local
// day handling for streaks.
const APP_TIMEZONE = 'Asia/Tashkent';

/**
 * Build a WHERE clause fragment that constrains `occurred_at` based on the
 * requested period. Returns { clause, params, nextParamIndex }.
 */
function buildPeriodFilter(period, paramIndex = 1) {
  switch (period) {
    case 'today':
      return {
        clause: `occurred_at >= date_trunc('day', now() AT TIME ZONE $${paramIndex}) AT TIME ZONE $${paramIndex}`,
        params: [APP_TIMEZONE],
        nextParamIndex: paramIndex + 1,
      };
    case 'week':
      return {
        clause: `occurred_at >= now() - interval '7 days'`,
        params: [],
        nextParamIndex: paramIndex,
      };
    case 'month':
      return {
        clause: `occurred_at >= now() - interval '30 days'`,
        params: [],
        nextParamIndex: paramIndex,
      };
    default: // 'all'
      return { clause: '1=1', params: [], nextParamIndex: paramIndex };
  }
}

async function getOverview(pool, filters = {}) {
  const { period = 'all', book, mode } = filters;
  const pf = buildPeriodFilter(period);

  // ----- totals -----
  const {
    rows: [totals],
  } = await pool.query(`
    SELECT
      (SELECT count(*) FROM users) AS total_users,
      (SELECT count(DISTINCT user_id) FROM events WHERE ${pf.clause}) AS period_active_users,
      (SELECT count(DISTINCT user_id) FROM events WHERE occurred_at >= now() - interval '1 day') AS daily_active_users,
      (SELECT count(DISTINCT user_id) FROM events WHERE occurred_at >= now() - interval '7 days') AS weekly_active_users
  `, pf.params);

  // ----- top screens -----
  const screenPf = buildPeriodFilter(period);
  const screenExtraConditions = [];
  const screenParams = [...screenPf.params];
  let pIdx = screenPf.nextParamIndex;

  if (book) {
    screenExtraConditions.push(`payload->>'book' = $${pIdx}`);
    screenParams.push(book);
    pIdx++;
  }

  const screenWhere = [
    `type = 'page_view'`,
    `payload->>'screen' IS NOT NULL`,
    screenPf.clause,
    ...screenExtraConditions,
  ].join(' AND ');

  const { rows: topScreens } = await pool.query(`
    SELECT payload->>'screen' AS screen, count(*) AS views
    FROM events
    WHERE ${screenWhere}
    GROUP BY payload->>'screen'
    ORDER BY views DESC
    LIMIT 10
  `, screenParams);

  // ----- top books -----
  const bookPf = buildPeriodFilter(period);
  const { rows: topBooks } = await pool.query(`
    SELECT payload->>'book' AS book, count(*) AS views
    FROM events
    WHERE type = 'page_view' AND payload->>'book' IS NOT NULL AND ${bookPf.clause}
    GROUP BY payload->>'book'
    ORDER BY views DESC
    LIMIT 10
  `, bookPf.params);

  // ----- top modes -----
  const modePf = buildPeriodFilter(period);
  const modeExtraConditions = [];
  const modeParams = [...modePf.params];
  let mIdx = modePf.nextParamIndex;

  if (mode) {
    modeExtraConditions.push(`payload->>'mode' = $${mIdx}`);
    modeParams.push(mode);
    mIdx++;
  }

  const modeWhere = [
    `type = 'mode_selected'`,
    `payload->>'mode' IS NOT NULL`,
    modePf.clause,
    ...modeExtraConditions,
  ].join(' AND ');

  const { rows: topModes } = await pool.query(`
    SELECT payload->>'mode' AS mode, count(*) AS selections
    FROM events
    WHERE ${modeWhere}
    GROUP BY payload->>'mode'
    ORDER BY selections DESC
  `, modeParams);

  // ----- average quiz score -----
  const quizPf = buildPeriodFilter(period);
  const quizExtraConditions = [];
  const quizParams = [...quizPf.params];
  let qIdx = quizPf.nextParamIndex;

  if (book) {
    quizExtraConditions.push(`payload->>'book' = $${qIdx}`);
    quizParams.push(book);
    qIdx++;
  }
  if (mode) {
    quizExtraConditions.push(`payload->>'mode' = $${qIdx}`);
    quizParams.push(mode);
    qIdx++;
  }

  const quizWhere = [
    `type = 'quiz_result'`,
    quizPf.clause,
    ...quizExtraConditions,
  ].join(' AND ');

  const {
    rows: [scoreSummary],
  } = await pool.query(`
    SELECT
      avg(
        CASE WHEN payload->>'correct_count' ~ '^[0-9]+(\\.[0-9]+)?$'
             THEN (payload->>'correct_count')::numeric
             ELSE NULL
        END
      ) AS avg_correct,
      avg(
        CASE WHEN payload->>'total_questions' ~ '^[0-9]+(\\.[0-9]+)?$'
             THEN (payload->>'total_questions')::numeric
             ELSE NULL
        END
      ) AS avg_total
    FROM events
    WHERE ${quizWhere}
  `, quizParams);

  return {
    total_users: Number(totals.total_users),
    daily_active_users: Number(totals.daily_active_users),
    weekly_active_users: Number(totals.weekly_active_users),
    period_active_users: Number(totals.period_active_users),
    top_screens: topScreens.map((row) => ({ screen: row.screen, views: Number(row.views) })),
    top_books: topBooks.map((row) => ({ book: row.book, views: Number(row.views) })),
    top_modes: topModes.map((row) => ({
      mode: row.mode,
      label: MODE_LABELS[row.mode] || row.mode,
      selections: Number(row.selections),
    })),
    average_quiz_score: {
      correct: scoreSummary.avg_correct === null ? null : Number(scoreSummary.avg_correct),
      total: scoreSummary.avg_total === null ? null : Number(scoreSummary.avg_total),
    },
  };
}

async function getUserTimeline(pool, userId) {
  const { rows } = await pool.query(
    `
    SELECT
      date_trunc('day', occurred_at AT TIME ZONE $1)::date AS day,
      type,
      payload
    FROM events
    WHERE user_id = $2
    ORDER BY occurred_at DESC
    `,
    ['Asia/Tashkent', userId]
  );

  const timelineByDay = {};
  rows.forEach(row => {
    const day = row.day.toISOString().split('T')[0]; // Convert Date to YYYY-MM-DD string
    if (!timelineByDay[day]) {
      timelineByDay[day] = { date: day, page_views: [], quizzes: [] };
    }

    if (row.type === 'page_view') {
      timelineByDay[day].page_views.push({
        screen: row.payload.screen || null,
        book: row.payload.book || null
      });
    } else if (row.type === 'quiz_result') {
      const correctCount = row.payload.correct_count ? Number(row.payload.correct_count) : null;
      const totalCount = row.payload.total_questions ? Number(row.payload.total_questions) : null;
      timelineByDay[day].quizzes.push({
        mode: row.payload.mode || null,
        correct: correctCount,
        total: totalCount,
        book: row.payload.book || null
      });
    }
  });

  return Object.values(timelineByDay);
}

async function getUsersOverview(pool, filters = {}) {
  const { period = 'all', search, sort = 'last_active', limit = 10, offset = 0 } = filters;
  const pf = buildPeriodFilter(period, 2); // $1 reserved for APP_TIMEZONE
  const params = [APP_TIMEZONE, ...pf.params];
  let pIdx = pf.nextParamIndex;

  // Optional search filter
  let searchClause = '';
  if (search && search.trim()) {
    searchClause = `AND (
      u.first_name ILIKE $${pIdx} OR
      u.last_name ILIKE $${pIdx} OR
      u.username ILIKE $${pIdx} OR
      u.phone_number ILIKE $${pIdx}
    )`;
    params.push(`%${search.trim()}%`);
    pIdx++;
  }

  // Sort order
  let orderBy;
  switch (sort) {
    case 'name':
      orderBy = 'u.first_name ASC NULLS LAST, u.last_name ASC NULLS LAST';
      break;
    case 'quizzes':
      orderBy = 'quizzes_taken DESC';
      break;
    default:
      orderBy = 'last_active DESC NULLS LAST';
  }

  // Period filter for events subqueries
  const eventPeriodClause = period !== 'all' ? `AND ${pf.clause.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 1}`)}` : '';

  // First, get total count (without LIMIT/OFFSET)
  // Count query has its own params array, so the search placeholder is always $1 here
  // regardless of what index it uses in the paginated query below.
  const countSearchClause = search && search.trim()
    ? `AND (
      u.first_name ILIKE $1 OR
      u.last_name ILIKE $1 OR
      u.username ILIKE $1 OR
      u.phone_number ILIKE $1
    )`
    : '';
  const countParams = searchClause ? [params[params.length - 1]] : [];
  const countResult = await pool.query(
    `
    SELECT count(*) AS total
    FROM users u
    WHERE 1=1 ${countSearchClause}
    `,
    countParams
  );
  const totalCount = Number(countResult.rows[0].total);

  // Then, get paginated results
  const { rows } = await pool.query(
    `
    SELECT
      u.id,
      u.first_name,
      u.last_name,
      u.username,
      u.phone_number,
      (SELECT max(occurred_at) FROM events WHERE user_id = u.id) AS last_active,
      (
        SELECT payload->>'screen' FROM events
        WHERE user_id = u.id AND type = 'page_view'
        ORDER BY occurred_at DESC, id DESC LIMIT 1
      ) AS last_screen,
      (SELECT count(*) FROM events WHERE user_id = u.id AND type = 'quiz_result') AS quizzes_taken,
      (
        SELECT avg(
          CASE WHEN payload->>'correct_count' ~ '^[0-9]+(\\.[0-9]+)?$'
               THEN (payload->>'correct_count')::numeric ELSE NULL END
        )
        FROM events WHERE user_id = u.id AND type = 'quiz_result'
      ) AS avg_correct,
      (
        SELECT avg(
          CASE WHEN payload->>'total_questions' ~ '^[0-9]+(\\.[0-9]+)?$'
               THEN (payload->>'total_questions')::numeric ELSE NULL END
        )
        FROM events WHERE user_id = u.id AND type = 'quiz_result'
      ) AS avg_total,
      (
        SELECT extract(epoch FROM (max(occurred_at) - min(occurred_at))) / 60
        FROM events
        WHERE user_id = u.id
          AND occurred_at >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1
      ) AS today_active_minutes,
      (SELECT count(*) FROM events WHERE user_id = u.id AND type = 'page_view') AS total_page_views,
      (
        SELECT mode FROM (
          SELECT payload->>'mode' AS mode, count(*) AS cnt
          FROM events WHERE user_id = u.id AND type = 'mode_selected'
          GROUP BY payload->>'mode' ORDER BY cnt DESC LIMIT 1
        ) sub(mode, cnt)
      ) AS favorite_mode,
      (SELECT count(DISTINCT payload->>'book') FROM events WHERE user_id = u.id AND type = 'page_view' AND payload->>'book' IS NOT NULL) AS books_viewed
    FROM users u
    WHERE 1=1 ${searchClause}
    ORDER BY ${orderBy}
    LIMIT $${pIdx}
    OFFSET $${pIdx + 1}
    `,
    [...params, limit, offset]
  );

  const users = rows.map((row) => {
    const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
      || (row.username ? `@${row.username}` : `Foydalanuvchi #${row.id}`);

    return {
      id: row.id,
      name,
      username: row.username,
      phone_number: row.phone_number,
      last_active: row.last_active,
      last_screen: row.last_screen,
      quizzes_taken: Number(row.quizzes_taken),
      avg_score: {
        correct: row.avg_correct === null ? null : Number(row.avg_correct),
        total: row.avg_total === null ? null : Number(row.avg_total),
      },
      today_active_minutes: row.today_active_minutes === null ? 0 : Math.round(Number(row.today_active_minutes)),
      total_page_views: Number(row.total_page_views),
      favorite_mode: row.favorite_mode ? (MODE_LABELS[row.favorite_mode] || row.favorite_mode) : null,
      favorite_mode_key: row.favorite_mode,
      books_viewed: Number(row.books_viewed),
    };
  });

  return { users, total_count: totalCount };
}

/**
 * Returns an activity timeline: hourly buckets for 'today', daily buckets
 * for 'week' and 'month'.
 */
async function getActivityTimeline(pool, period = 'week') {
  if (period === 'today') {
    // Hourly buckets for today (Tashkent time)
    const { rows } = await pool.query(`
      WITH hours AS (
        SELECT generate_series(
          date_trunc('day', now() AT TIME ZONE $1),
          date_trunc('day', now() AT TIME ZONE $1) + interval '23 hours',
          interval '1 hour'
        ) AS hour_start
      )
      SELECT
        extract(hour FROM h.hour_start) AS bucket_label,
        coalesce(count(e.id), 0) AS event_count,
        count(DISTINCT e.user_id) AS unique_users
      FROM hours h
      LEFT JOIN events e ON
        e.occurred_at >= (h.hour_start AT TIME ZONE $1) AND
        e.occurred_at < ((h.hour_start + interval '1 hour') AT TIME ZONE $1)
      GROUP BY h.hour_start
      ORDER BY h.hour_start
    `, [APP_TIMEZONE]);

    return rows.map((r) => ({
      label: `${String(Math.floor(Number(r.bucket_label))).padStart(2, '0')}:00`,
      event_count: Number(r.event_count),
      unique_users: Number(r.unique_users),
    }));
  }

  // Daily buckets
  const days = period === 'month' ? 30 : 7;
  const { rows } = await pool.query(`
    WITH days AS (
      SELECT generate_series(
        date_trunc('day', now() AT TIME ZONE $1) - ($2::int - 1) * interval '1 day',
        date_trunc('day', now() AT TIME ZONE $1),
        interval '1 day'
      ) AS day_start
    )
    SELECT
      to_char(d.day_start, 'DD.MM') AS bucket_label,
      coalesce(count(e.id), 0) AS event_count,
      count(DISTINCT e.user_id) AS unique_users
    FROM days d
    LEFT JOIN events e ON
      e.occurred_at >= (d.day_start AT TIME ZONE $1) AND
      e.occurred_at < ((d.day_start + interval '1 day') AT TIME ZONE $1)
    GROUP BY d.day_start
    ORDER BY d.day_start
  `, [APP_TIMEZONE, days]);

  return rows.map((r) => ({
    label: r.bucket_label,
    event_count: Number(r.event_count),
    unique_users: Number(r.unique_users),
  }));
}

/**
 * Returns per-exercise-mode statistics: usage count, unique users,
 * average score, pass rate (>=60%).
 */
async function getExerciseDetails(pool, filters = {}) {
  const { period = 'all', book } = filters;
  const pf = buildPeriodFilter(period);
  const extraConditions = [];
  const params = [...pf.params];
  let pIdx = pf.nextParamIndex;

  if (book) {
    extraConditions.push(`payload->>'book' = $${pIdx}`);
    params.push(book);
    pIdx++;
  }

  const where = [
    `type = 'quiz_result'`,
    pf.clause,
    ...extraConditions,
  ].join(' AND ');

  const { rows } = await pool.query(`
    SELECT
      payload->>'mode' AS mode,
      count(*) AS usage_count,
      count(DISTINCT user_id) AS unique_users,
      avg(
        CASE WHEN payload->>'correct_count' ~ '^[0-9]+(\\.[0-9]+)?$'
             THEN (payload->>'correct_count')::numeric ELSE NULL END
      ) AS avg_correct,
      avg(
        CASE WHEN payload->>'total_questions' ~ '^[0-9]+(\\.[0-9]+)?$'
             THEN (payload->>'total_questions')::numeric ELSE NULL END
      ) AS avg_total,
      count(*) FILTER (
        WHERE (payload->>'correct_count')::numeric >= (payload->>'total_questions')::numeric * 0.6
          AND payload->>'correct_count' ~ '^[0-9]+(\\.[0-9]+)?$'
          AND payload->>'total_questions' ~ '^[0-9]+(\\.[0-9]+)?$'
      ) AS passed_count
    FROM events
    WHERE ${where}
    GROUP BY payload->>'mode'
    ORDER BY usage_count DESC
  `, params);

  return rows.map((r) => ({
    mode: r.mode,
    label: MODE_LABELS[r.mode] || r.mode,
    usage_count: Number(r.usage_count),
    unique_users: Number(r.unique_users),
    avg_correct: r.avg_correct === null ? null : Number(r.avg_correct),
    avg_total: r.avg_total === null ? null : Number(r.avg_total),
    pass_rate: r.usage_count > 0 ? Math.round((Number(r.passed_count) / Number(r.usage_count)) * 100) : 0,
  }));
}

module.exports = { getOverview, getUsersOverview, getActivityTimeline, getExerciseDetails, getUserTimeline };
