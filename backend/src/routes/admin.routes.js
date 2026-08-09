const express = require('express');
const { adminAuth } = require('../middleware/adminAuth.js');
const { getOverview, getUsersOverview, getActivityTimeline, getExerciseDetails, getUserTimeline } = require('../services/stats.service.js');

function createAdminRouter({ env, pool }) {
  const router = express.Router();

  router.use(adminAuth(env));

  router.get('/stats', async (req, res, next) => {
    try {
      const filters = {
        period: req.query.period || 'all',
        book: req.query.book || undefined,
        mode: req.query.mode || undefined,
      };
      const overview = await getOverview(pool, filters);
      res.json(overview);
    } catch (error) {
      next(error);
    }
  });

  router.get('/users', async (req, res, next) => {
    try {
      const filters = {
        period: req.query.period || 'all',
        search: req.query.search || undefined,
        sort: req.query.sort || 'last_active',
        limit: parseInt(req.query.limit) || 10,
        offset: parseInt(req.query.offset) || 0,
      };
      const result = await getUsersOverview(pool, filters);
      res.json(result); // Now sends { users: [...], total_count: number }
    } catch (error) {
      next(error);
    }
  });

  router.get('/users/:id/timeline', async (req, res, next) => {
    try {
      const userId = parseInt(req.params.id);
      if (isNaN(userId) || userId <= 0) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }
      const timeline = await getUserTimeline(pool, userId);
      res.json({ user_id: userId, timeline });
    } catch (error) {
      next(error);
    }
  });

  router.get('/activity-timeline', async (req, res, next) => {
    try {
      const period = req.query.period || 'week';
      const timeline = await getActivityTimeline(pool, period);
      res.json(timeline);
    } catch (error) {
      next(error);
    }
  });

  router.get('/exercise-details', async (req, res, next) => {
    try {
      const filters = {
        period: req.query.period || 'all',
        book: req.query.book || undefined,
      };
      const details = await getExerciseDetails(pool, filters);
      res.json(details);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createAdminRouter };
