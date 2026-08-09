const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestPool, resetDb } = require('../db/testPool.js');
const { upsertUser } = require('./user.service.js');
const { createSession } = require('./session.service.js');
const { insertEvents } = require('./event.service.js');
const { getOverview, getUsersOverview } = require('./stats.service.js');

let pool;

before(() => {
  pool = createTestPool();
});

beforeEach(async () => {
  await resetDb(pool);
});

after(async () => {
  await pool.end();
});

test('summarizes users, top screens, and quiz scores', async () => {
  const user = await upsertUser(pool, { id: 888, username: 'aziz_dev', first_name: 'Aziz' });
  const session = await createSession(pool, user.id);

  await insertEvents(pool, session.id, user.id, [
    { type: 'page_view', payload: { screen: 'welcome-screen' } },
    { type: 'page_view', payload: { screen: 'welcome-screen' } },
    { type: 'page_view', payload: { screen: 'quiz-screen', book: 'Essential 1' } },
    { type: 'quiz_result', payload: { correct_count: 8, total_questions: 10 } },
  ]);

  const overview = await getOverview(pool);

  assert.equal(overview.total_users, 1);
  assert.equal(overview.daily_active_users, 1);
  assert.equal(overview.top_screens[0].screen, 'welcome-screen');
  assert.equal(overview.top_screens[0].views, 2);
  assert.equal(overview.top_books[0].book, 'Essential 1');
  assert.equal(overview.average_quiz_score.correct, 8);
  assert.equal(overview.average_quiz_score.total, 10);
});

test('summarizes top exercise types with human-readable labels', async () => {
  const user = await upsertUser(pool, { id: 891, username: 'aziz_dev', first_name: 'Aziz' });
  const session = await createSession(pool, user.id);

  await insertEvents(pool, session.id, user.id, [
    { type: 'mode_selected', payload: { mode: 'tank' } },
    { type: 'mode_selected', payload: { mode: 'tank' } },
    { type: 'mode_selected', payload: { mode: 'audiowrite' } },
  ]);

  const overview = await getOverview(pool);

  assert.equal(overview.top_modes[0].mode, 'tank');
  assert.equal(overview.top_modes[0].label, 'Neon Tank');
  assert.equal(overview.top_modes[0].selections, 2);
  assert.equal(overview.top_modes[1].mode, 'audiowrite');
  assert.equal(overview.top_modes[1].label, 'Eshitib yozish');
  assert.equal(overview.top_modes[1].selections, 1);
});

test('ignores malformed quiz_result payloads instead of crashing', async () => {
  const user = await upsertUser(pool, { id: 889, username: 'aziz_dev', first_name: 'Aziz' });
  const session = await createSession(pool, user.id);

  await insertEvents(pool, session.id, user.id, [
    { type: 'quiz_result', payload: { correct_count: 6, total_questions: 10 } },
    { type: 'quiz_result', payload: { correct_count: 'not-a-number', total_questions: 10 } },
  ]);

  const overview = await getOverview(pool);

  assert.equal(overview.average_quiz_score.correct, 6);
});

test('summarizes per-user activity: name, last screen, and quiz results', async () => {
  const namedUser = await upsertUser(pool, { id: 892, username: 'aziz_dev', first_name: 'Aziz', last_name: 'Karimov' });
  const namedSession = await createSession(pool, namedUser.id);
  await insertEvents(pool, namedSession.id, namedUser.id, [
    { type: 'page_view', payload: { screen: 'setup-screen' } },
    { type: 'page_view', payload: { screen: 'book-screen/reading', book: 'Essential 1', unit: 'Unit 1' } },
    { type: 'quiz_result', payload: { correct_count: 9, total_questions: 10 } },
    { type: 'quiz_result', payload: { correct_count: 7, total_questions: 10 } },
  ]);

  const anonymousUser = await upsertUser(pool, { id: 893 });

  const { users, total_count } = await getUsersOverview(pool);
  const named = users.find((u) => u.id === namedUser.id);
  const anonymous = users.find((u) => u.id === anonymousUser.id);

  assert.equal(named.name, 'Aziz Karimov');
  assert.equal(named.last_screen, 'book-screen/reading');
  assert.equal(named.quizzes_taken, 2);
  assert.equal(named.avg_score.correct, 8);
  assert.equal(named.avg_score.total, 10);
  assert.equal(typeof named.today_active_minutes, 'number');
  assert.ok(named.today_active_minutes >= 0);

  assert.equal(anonymous.name, `Foydalanuvchi #${anonymousUser.id}`);
  assert.equal(anonymous.last_screen, null);
  assert.equal(anonymous.quizzes_taken, 0);
  assert.equal(anonymous.avg_score.correct, null);
  assert.equal(anonymous.today_active_minutes, 0);
});

test('ignores digit-junk-digit malformed payloads instead of crashing', async () => {
  const user = await upsertUser(pool, { id: 890, username: 'aziz_dev', first_name: 'Aziz' });
  const session = await createSession(pool, user.id);

  await insertEvents(pool, session.id, user.id, [
    { type: 'quiz_result', payload: { correct_count: 7, total_questions: 10 } },
    { type: 'quiz_result', payload: { correct_count: '6a5', total_questions: 10 } },
  ]);

  const overview = await getOverview(pool);

  assert.equal(overview.average_quiz_score.correct, 7);
});
