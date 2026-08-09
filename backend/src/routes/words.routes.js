const express = require('express');
const { getWords, saveWords, deleteWord, clearWords } = require('../services/words.service.js');

function createWordsRouter({ pool }) {
  const router = express.Router();

  // GET /api/words — Fetch user words from database
  router.get('/', async (req, res, next) => {
    try {
      const sessionId = req.query.session_id || req.headers['x-session-id'];
      const words = await getWords({ pool, sessionId: sessionId ? parseInt(sessionId, 10) || null : null });
      res.json({ words });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/words — Save or bulk insert words into database
  router.post('/', async (req, res, next) => {
    try {
      const { session_id, words } = req.body;
      const parsedSessionId = session_id ? parseInt(session_id, 10) || null : null;
      const listToSave = Array.isArray(words) ? words : [req.body];
      const saved = await saveWords({ pool, sessionId: parsedSessionId, words: listToSave });
      res.json({ success: true, saved });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/words/:id — Delete single word from database
  router.delete('/:id', async (req, res, next) => {
    try {
      await deleteWord({ pool, wordId: req.params.id });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/words — Clear all words for session
  router.delete('/', async (req, res, next) => {
    try {
      const sessionId = req.query.session_id || req.body.session_id;
      await clearWords({ pool, sessionId: sessionId ? parseInt(sessionId, 10) || null : null });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createWordsRouter };
