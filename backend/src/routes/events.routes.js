const express = require('express');
const { insertEvents, sessionExists } = require('../services/event.service.js');

const MAX_EVENTS_PER_REQUEST = 100;

function isValidEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return false;
  }
  if (typeof event.type !== 'string' || event.type.length === 0) {
    return false;
  }
  if (event.payload !== undefined) {
    if (typeof event.payload !== 'object' || event.payload === null || Array.isArray(event.payload)) {
      return false;
    }
  }
  return true;
}

function createEventsRouter({ pool }) {
  const router = express.Router();

  router.post('/', async (req, res, next) => {
    try {
      const { session_id: sessionId, events } = req.body;

      if (!sessionId || !Array.isArray(events)) {
        return res.status(400).json({ error: 'session_id and events[] are required' });
      }

      if (events.length > MAX_EVENTS_PER_REQUEST || !events.every(isValidEvent)) {
        return res.status(400).json({ error: 'events[] contains invalid entries' });
      }

      const session = await sessionExists(pool, sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Unknown session_id' });
      }

      const inserted = await insertEvents(pool, sessionId, session.user_id, events);
      res.status(202).json({ inserted });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createEventsRouter };
