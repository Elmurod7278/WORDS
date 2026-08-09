const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { adminAuth } = require('./adminAuth.js');

const env = { adminUsername: 'admin', adminPassword: 'secret' };

function buildTestApp() {
  const app = express();
  app.get('/protected', adminAuth(env), (req, res) => res.json({ ok: true }));
  return app;
}

test('rejects requests with no Authorization header', async () => {
  const app = buildTestApp();
  const response = await request(app).get('/protected');
  assert.equal(response.status, 401);
});

test('rejects requests with wrong credentials', async () => {
  const app = buildTestApp();
  const token = Buffer.from('admin:wrong-password').toString('base64');
  const response = await request(app).get('/protected').set('Authorization', `Basic ${token}`);
  assert.equal(response.status, 401);
});

test('allows requests with correct credentials', async () => {
  const app = buildTestApp();
  const token = Buffer.from('admin:secret').toString('base64');
  const response = await request(app).get('/protected').set('Authorization', `Basic ${token}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });
});
