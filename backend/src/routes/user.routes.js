const express = require('express');
const { sessionExists } = require('../services/event.service.js');
const { updateUserPhone } = require('../services/user.service.js');

const PHONE_PATTERN = /^\+?[0-9][0-9\s-]{6,19}$/;

function createUserRouter({ pool }) {
  const router = express.Router();

  router.post('/phone', async (req, res, next) => {
    try {
      const { session_id: sessionId, phone_number: phoneNumber } = req.body;

      if (!sessionId || typeof phoneNumber !== 'string' || !PHONE_PATTERN.test(phoneNumber.trim())) {
        return res.status(400).json({ error: 'session_id and a valid phone_number are required' });
      }

      const session = await sessionExists(pool, sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Unknown session_id' });
      }

      const updated = await updateUserPhone(pool, session.user_id, phoneNumber.trim());
      res.json({ phone_number: updated.phone_number });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createUserRouter };
