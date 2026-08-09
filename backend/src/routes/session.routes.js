const express = require('express');
const { verifyInitData } = require('../services/telegramAuth.service.js');
const { upsertUser } = require('../services/user.service.js');
const { createSession } = require('../services/session.service.js');

function createSessionRouter({ env, pool }) {
  const router = express.Router();

  router.post('/', async (req, res, next) => {
    const { initData } = req.body;

    let telegramUser;
    try {
      telegramUser = verifyInitData(initData, env.telegramBotToken);
    } catch (error) {
      return res.status(401).json({ error: 'Invalid Telegram authentication data' });
    }

    try {
      const user = await upsertUser(pool, telegramUser);
      const session = await createSession(pool, user.id);
      res.json({ session_id: session.id, user: { id: user.id, username: user.username } });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createSessionRouter };
