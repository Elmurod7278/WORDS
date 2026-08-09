const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const supertest = require('supertest');
const { createApp } = require('../app.js');
const { resetDb, createTestPool } = require('../db/testPool.js');

const env = {
  port: 3000,
  databaseUrl: 'postgres://localhost:5432/words_test',
  telegramBotToken: 'test-token',
  adminUsername: 'admin',
  adminPassword: 'password',
  corsOrigin: '*',
  miniAppUrl: 'https://words.reach.uz',
  welcomePhotoUrl: '',
};

let app;
let pool;

before(() => {
  pool = createTestPool();
  app = createApp({ env, pool });
});

beforeEach(async () => {
  await resetDb(pool);
});

test('POST /api/words stores custom words in database and GET /api/words returns them', async () => {
  const wordsToSave = [
    {
      id: 'cw_test_1',
      srcLang: 'de',
      tgtLang: 'uz',
      source: 'Hund',
      target: 'it',
      transcription: '[hʊnt]',
      definition: 'Uy hayvoni',
      example: 'Der Hund bellt.',
      collection: 'Nemis so\'zlari',
    },
    {
      id: 'cw_test_2',
      srcLang: 'en',
      tgtLang: 'uz',
      source: 'apple',
      target: 'olma',
      transcription: '[ǽpl]',
      definition: 'Meve',
      example: 'I eat an apple.',
      collection: '',
    },
  ];

  const postRes = await supertest(app)
    .post('/api/words')
    .send({ words: wordsToSave })
    .expect(200);

  assert.strictEqual(postRes.body.success, true);
  assert.strictEqual(postRes.body.saved.length, 2);

  const getRes = await supertest(app)
    .get('/api/words')
    .expect(200);

  assert.strictEqual(getRes.body.words.length, 2);
  const germanWord = getRes.body.words.find(w => w.id === 'cw_test_1');
  assert.ok(germanWord);
  assert.strictEqual(germanWord.source, 'Hund');
  assert.strictEqual(germanWord.srcLang, 'de');
});

test('DELETE /api/words/:id removes a word from database', async () => {
  const wordsToSave = [
    { id: 'cw_del_1', srcLang: 'fr', tgtLang: 'uz', source: 'chat', target: 'mushuk' },
  ];

  await supertest(app).post('/api/words').send({ words: wordsToSave }).expect(200);
  await supertest(app).delete('/api/words/cw_del_1').expect(200);

  const getRes = await supertest(app).get('/api/words').expect(200);
  assert.strictEqual(getRes.body.words.length, 0);
});
