const path = require('node:path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createSessionRouter } = require('./routes/session.routes.js');
const { createEventsRouter } = require('./routes/events.routes.js');
const { createAdminRouter } = require('./routes/admin.routes.js');
const { createUserRouter } = require('./routes/user.routes.js');
const { createWordsRouter } = require('./routes/words.routes.js');
const { adminAuth } = require('./middleware/adminAuth.js');
const { errorHandler } = require('./middleware/errorHandler.js');

const helmet = require('helmet');

function createApp({ env, pool }) {
  const app = express();
  app.set('trust proxy', 1);

  // Security Headers (XSS, Clickjacking, MIME-sniffing protection)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "https://telegram.org"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "blob:", "https:"],
          connectSrc: ["'self'", "https:"],
          frameSrc: ["'self'", "https://web.telegram.org", "https://*.telegram.org"],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(cors({ origin: env.corsOrigin }));
  
  // Strict payload limits to block big data floods (Max 100KB per JSON payload)
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // DDoS & Rate Limiting protection
  const publicApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120, // max 120 requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Juda ko'p so'rov yuborildi. Iltimos, 1 daqiqadan so'ng qayta urinib ko'ring." }
  });

  const writeApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 40, // max 40 write requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Saqlash so'rovlari chegarasi oshdi. Iltimos, ozgina kuting." }
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
  app.use('/api/words', writeApiLimiter, createWordsRouter({ pool }));
  app.use('/api/admin', adminLimiter, createAdminRouter({ env, pool }));
  app.use('/admin', adminAuth(env), express.static(path.join(__dirname, '..', 'admin')));
  app.use(express.static(path.join(__dirname, '..', '..')));

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
