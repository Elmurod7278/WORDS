const path = require('node:path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createSessionRouter } = require('./routes/session.routes.js');
const { createEventsRouter } = require('./routes/events.routes.js');
const { createAdminRouter } = require('./routes/admin.routes.js');
const { createUserRouter } = require('./routes/user.routes.js');
const { adminAuth } = require('./middleware/adminAuth.js');
const { errorHandler } = require('./middleware/errorHandler.js');

function createApp({ env, pool }) {
  const app = express();
  app.set('trust proxy', 1);

  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  const publicApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const adminLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/api/session', publicApiLimiter, createSessionRouter({ env, pool }));
  app.use('/api/events', publicApiLimiter, createEventsRouter({ pool }));
  app.use('/api/user', publicApiLimiter, createUserRouter({ pool }));
  app.use('/api/admin', adminLimiter, createAdminRouter({ env, pool }));
  app.use('/admin', adminAuth(env), express.static(path.join(__dirname, '..', 'admin')));

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
