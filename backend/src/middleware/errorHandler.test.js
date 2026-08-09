const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { errorHandler } = require('./errorHandler.js');

test('returns a generic 500 JSON body and does not leak error details', async () => {
  const app = express();
  app.get('/boom', () => {
    throw new Error('sensitive db connection string leaked here');
  });
  app.use(errorHandler);

  const response = await request(app).get('/boom');

  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: 'Internal server error' });
});

test('respects a custom statusCode set on the error', async () => {
  const app = express();
  app.get('/teapot', () => {
    const error = new Error('I am a teapot');
    error.statusCode = 418;
    throw error;
  });
  app.use(errorHandler);

  const response = await request(app).get('/teapot');

  assert.equal(response.status, 418);
  assert.deepEqual(response.body, { error: 'I am a teapot' });
});
