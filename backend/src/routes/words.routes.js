const express = require('express');
const { getWords, saveWords, deleteWord, clearWords } = require('../services/words.service.js');

function getClientIdentity(req) {
  let userId = req.user ? req.user.id : (req.headers['x-user-id'] ? String(req.headers['x-user-id']).trim() : null);
  if (!userId && req.query?.user_id) {
    userId = String(req.query.user_id).trim();
  }
  if (!userId && req.body?.user_id) {
    userId = String(req.body.user_id).trim();
  }

  // Extract from Telegram initData if available
  const initDataStr = req.headers['x-telegram-init-data'];
  if (!userId && initDataStr) {
    try {
      const params = new URLSearchParams(initDataStr);
      const userJSON = params.get('user');
      if (userJSON) {
        const parsedUser = JSON.parse(userJSON);
        if (parsedUser && parsedUser.id) {
          userId = String(parsedUser.id).trim();
        }
      }
    } catch (e) {}
  }

  const sessionId = req.query.session_id || req.headers['x-session-id'] || req.body?.session_id;
  const deviceId = req.headers['x-device-id'] || req.query.device_id || req.body?.device_id;

  return {
    userId: userId || null,
    sessionId: sessionId ? String(sessionId).trim() : null,
    deviceId: deviceId ? String(deviceId).trim() : null,
  };
}

function createWordsRouter({ pool }) {
  const router = express.Router();

  // GET /api/words — Fetch user words from database
  router.get('/', async (req, res, next) => {
    try {
      const identity = getClientIdentity(req);
      const words = await getWords({ pool, ...identity });
      res.json({ words });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/words — Save or bulk insert words into database
  router.post('/', async (req, res, next) => {
    try {
      const identity = getClientIdentity(req);
      const { words } = req.body;
      const listToSave = Array.isArray(words) ? words : (req.body.source ? [req.body] : []);
      const saved = await saveWords({ pool, ...identity, words: listToSave });
      res.json({ success: true, saved });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/words/:id — Delete single word from database
  router.delete('/:id', async (req, res, next) => {
    try {
      const identity = getClientIdentity(req);
      await deleteWord({ pool, wordId: req.params.id, ...identity });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/words — Clear all words for session/device
  router.delete('/', async (req, res, next) => {
    try {
      const identity = getClientIdentity(req);
      await clearWords({ pool, ...identity });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createWordsRouter };
