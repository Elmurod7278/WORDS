# Foydalanuvchi Tracking va Analytics Backend — Amalga Oshirish Rejasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted Node.js + PostgreSQL backend that identifies Telegram Mini App users via WebApp `initData`, records page-view and quiz-result events without blocking the UI, and exposes a password-protected admin panel with engagement stats — then wire the existing frontend to send tracking data to it.

**Architecture:** Layered Express backend (`routes` → `services` → `db`) backed by PostgreSQL, deployed via Docker Compose on the user's own server. The existing frontend (`index.html`/`app.js`) stays HTML/CSS/JavaScript — a small `tracking.js` module and two hooks in `app.js` send buffered, fire-and-forget events to the backend.

**Tech Stack:** Node.js (CommonJS) + Express 4 + `pg` (no ORM) + PostgreSQL 16 + `node-pg-migrate` + Docker Compose. Tests use Node's built-in `node:test` runner + `supertest`.

**Reference spec:** `docs/superpowers/specs/2026-07-11-user-analytics-backend-design.md`

## Global Constraints

- Backend is plain Node.js CommonJS (`require`/`module.exports`), Express 4, raw `pg` with parameterized SQL — no ORM.
- Frontend (`index.html`/`app.js`/`styles.css`) is not restructured — only two `<script>` tags and two small hooks are added to existing files.
- Every frontend tracking call must be non-blocking and fail silently — it must never throw into caller code or delay the UI.
- `users.telegram_id` must be persisted (it doubles as the future broadcast `chat_id`).
- `initData` must be verified server-side via HMAC-SHA256 per Telegram's documented algorithm before any user identity is trusted.
- Admin endpoints (`/api/admin/*`, `/admin`) are protected by HTTP Basic Auth using `ADMIN_USERNAME`/`ADMIN_PASSWORD` env vars.
- Deployment is self-hosted via Docker Compose (`app` + `postgres` services) — no Vercel/Netlify serverless functions, no Supabase/Firebase.
- `events.payload` is JSONB — new event types must not require a schema migration.

---

## Task 1: Backend project scaffold — config, DB pool, migrations, Express skeleton

**Files:**
- Create: `backend/package.json`
- Create: `backend/.gitignore`
- Create: `backend/.env.example`
- Create: `backend/docker-compose.yml`
- Create: `backend/src/config/env.js`
- Create: `backend/src/config/env.test.js`
- Create: `backend/src/config/db.js`
- Create: `backend/src/db/migrations/1768000000000_create-core-tables.js`
- Create: `backend/src/db/migrate.test.js`
- Create: `backend/src/db/testPool.js`
- Create: `backend/src/app.js`
- Create: `backend/src/app.test.js`
- Create: `backend/src/server.js`

**Interfaces:**
- Produces: `loadEnv(source?)` → `{ port, databaseUrl, telegramBotToken, adminUsername, adminPassword, corsOrigin }`, throws if a required var is missing.
- Produces: `createPool(env?)` → `pg.Pool`.
- Produces: `createTestPool()` → `pg.Pool` bound to `TEST_DATABASE_URL`; `resetDb(pool)` → truncates `events`, `sessions`, `users`.
- Produces: `createApp({ env, pool })` → Express app with `GET /health` and a catch-all 404. Later tasks mount routers onto this before the 404 handler.

- [ ] **Step 1: Create the project manifest and install dependencies**

Create `backend/package.json`:

```json
{
  "name": "essential-backend",
  "version": "1.0.0",
  "private": true,
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js",
    "test": "node --test src",
    "migrate": "node-pg-migrate --migrations-dir src/db/migrations --migrations-table pgmigrations"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "express-rate-limit": "^7.4.0",
    "node-pg-migrate": "^7.6.1",
    "pg": "^8.12.0"
  },
  "devDependencies": {
    "supertest": "^7.0.0"
  }
}
```

Create `backend/.gitignore`:

```
node_modules/
.env
```

Run:
```bash
cd backend
npm install
```
Expected: `node_modules/` and `package-lock.json` are created with no errors.

- [ ] **Step 2: Write the failing test for env config**

Create `backend/src/config/env.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadEnv } = require('./env.js');

test('throws when required vars are missing', () => {
  assert.throws(() => loadEnv({}), /Missing required environment variables/);
});

test('returns parsed config when all required vars are present', () => {
  const config = loadEnv({
    DATABASE_URL: 'postgres://localhost/test',
    TELEGRAM_BOT_TOKEN: 'test-token',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'secret',
    PORT: '4000',
  });

  assert.equal(config.port, 4000);
  assert.equal(config.databaseUrl, 'postgres://localhost/test');
  assert.equal(config.corsOrigin, '*');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module './env.js'`

- [ ] **Step 4: Implement env config**

Create `backend/src/config/env.js`:

```js
require('dotenv').config();

const REQUIRED_VARS = [
  'DATABASE_URL',
  'TELEGRAM_BOT_TOKEN',
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD',
];

function loadEnv(source = process.env) {
  const missing = REQUIRED_VARS.filter((key) => !source[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    port: Number(source.PORT) || 3000,
    databaseUrl: source.DATABASE_URL,
    telegramBotToken: source.TELEGRAM_BOT_TOKEN,
    adminUsername: source.ADMIN_USERNAME,
    adminPassword: source.ADMIN_PASSWORD,
    corsOrigin: source.CORS_ORIGIN || '*',
  };
}

module.exports = { loadEnv };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS (2 tests)

- [ ] **Step 6: Set up local Postgres for dev and tests**

Create `backend/.env.example`:

```
PORT=3000
DATABASE_URL=postgres://essential:essential@localhost:5432/essential
TEST_DATABASE_URL=postgres://essential:essential@localhost:5432/essential_test
TELEGRAM_BOT_TOKEN=replace-with-your-bot-token
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-strong-password
CORS_ORIGIN=https://your-mini-app-domain.example
```

Create `backend/docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: essential
      POSTGRES_PASSWORD: essential
      POSTGRES_DB: essential
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

Run:
```bash
cp .env.example .env
docker compose up -d postgres
docker compose exec postgres psql -U essential -d essential -c "CREATE DATABASE essential_test;"
```
Expected: `CREATE DATABASE` printed, no errors.

- [ ] **Step 7: Add the DB connection pool**

Create `backend/src/config/db.js`:

```js
const { Pool } = require('pg');
const { loadEnv } = require('./env.js');

function createPool(env = loadEnv()) {
  return new Pool({ connectionString: env.databaseUrl });
}

module.exports = { createPool };
```

- [ ] **Step 8: Write the initial migration and apply it to both databases**

Create `backend/src/db/migrations/1768000000000_create-core-tables.js`:

```js
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('users', {
    id: 'id',
    telegram_id: { type: 'bigint', notNull: true, unique: true },
    username: { type: 'text' },
    first_name: { type: 'text' },
    last_name: { type: 'text' },
    language_code: { type: 'text' },
    first_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('sessions', {
    id: 'id',
    user_id: {
      type: 'bigint',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_active_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('events', {
    id: 'id',
    session_id: {
      type: 'bigint',
      notNull: true,
      references: 'sessions',
      onDelete: 'CASCADE',
    },
    user_id: {
      type: 'bigint',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    type: { type: 'text', notNull: true },
    payload: { type: 'jsonb', notNull: true, default: '{}' },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('sessions', 'user_id');
  pgm.createIndex('events', 'user_id');
  pgm.createIndex('events', 'type');
  pgm.createIndex('events', 'occurred_at');
};

exports.down = (pgm) => {
  pgm.dropTable('events');
  pgm.dropTable('sessions');
  pgm.dropTable('users');
};
```

Run:
```bash
npm run migrate -- up
DATABASE_URL=postgres://essential:essential@localhost:5432/essential_test npm run migrate -- up
```
Expected: both commands print `### MIGRATION 1768000000000_create-core-tables (UP) ###` with no errors.

- [ ] **Step 9: Write a failing integration test that verifies the migration**

Create `backend/src/db/migrate.test.js`:

```js
require('dotenv').config();
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

test('migrations create the expected core tables', async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    const { rows } = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('users', 'sessions', 'events')
      ORDER BY table_name
    `);
    assert.deepEqual(rows.map((r) => r.table_name), ['events', 'sessions', 'users']);
  } finally {
    await pool.end();
  }
});
```

Create `backend/src/db/testPool.js` (shared helper used by later tasks too):

```js
require('dotenv').config();
const { Pool } = require('pg');

function createTestPool() {
  return new Pool({ connectionString: process.env.TEST_DATABASE_URL });
}

async function resetDb(pool) {
  await pool.query('TRUNCATE TABLE events, sessions, users RESTART IDENTITY CASCADE');
}

module.exports = { createTestPool, resetDb };
```

Run: `npm test`
Expected: PASS — the migration test confirms all three tables exist (since Step 8 already applied the migration).

- [ ] **Step 10: Write the Express app skeleton with a health check**

Create `backend/src/app.js`:

```js
const express = require('express');
const cors = require('cors');

function createApp({ env, pool }) {
  const app = express();

  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}

module.exports = { createApp };
```

Create `backend/src/app.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('./app.js');

const testEnv = {
  port: 3000,
  corsOrigin: '*',
  telegramBotToken: 'test-bot-token-123',
  adminUsername: 'admin',
  adminPassword: 'secret',
};

test('GET /health returns ok status', async () => {
  const app = createApp({ env: testEnv, pool: null });
  const response = await request(app).get('/health');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok' });
});

test('unknown routes return 404 JSON', async () => {
  const app = createApp({ env: testEnv, pool: null });
  const response = await request(app).get('/nope');
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: 'Not found' });
});
```

Run: `npm test`
Expected: PASS (all tests so far green)

- [ ] **Step 11: Add the server entrypoint**

Create `backend/src/server.js`:

```js
const { loadEnv } = require('./config/env.js');
const { createPool } = require('./config/db.js');
const { createApp } = require('./app.js');

const env = loadEnv();
const pool = createPool(env);
const app = createApp({ env, pool });

app.listen(env.port, () => {
  console.log(`Server listening on port ${env.port}`);
});
```

Run: `npm start` (in one terminal), then in another: `curl http://localhost:3000/health`
Expected: `{"status":"ok"}`. Stop the server with Ctrl+C.

- [ ] **Step 12: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/.gitignore backend/.env.example \
  backend/docker-compose.yml backend/src/config backend/src/db backend/src/app.js \
  backend/src/app.test.js backend/src/server.js
git commit -m "feat(backend): scaffold Express app, PostgreSQL pool, and initial migration"
```

---

## Task 2: Telegram initData verification

**Files:**
- Create: `backend/src/services/telegramAuth.service.js`
- Test: `backend/src/services/telegramAuth.service.test.js`

**Interfaces:**
- Consumes: nothing from other tasks (pure logic).
- Produces: `verifyInitData(initDataRaw, botToken, options?)` → parsed Telegram user object (`{ id, first_name, username, ... }`). Throws `Error` for missing/invalid/expired/tampered data. `options.maxAgeSeconds` defaults to `86400`.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/services/telegramAuth.service.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyInitData } = require('./telegramAuth.service.js');

const BOT_TOKEN = 'test-bot-token-123';

function signInitData(fields, botToken) {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  return new URLSearchParams({ ...fields, hash }).toString();
}

test('accepts a correctly signed, fresh initData payload', () => {
  const fields = {
    query_id: 'AAH1abcd',
    user: JSON.stringify({ id: 12345, first_name: 'Aziz', username: 'aziz_dev' }),
    auth_date: String(Math.floor(Date.now() / 1000)),
  };
  const initData = signInitData(fields, BOT_TOKEN);

  const user = verifyInitData(initData, BOT_TOKEN);

  assert.equal(user.id, 12345);
  assert.equal(user.username, 'aziz_dev');
});

test('rejects a tampered payload', () => {
  const fields = {
    query_id: 'AAH1abcd',
    user: JSON.stringify({ id: 12345, first_name: 'Aziz' }),
    auth_date: String(Math.floor(Date.now() / 1000)),
  };
  const initData = signInitData(fields, BOT_TOKEN).replace('Aziz', 'Hacker');

  assert.throws(() => verifyInitData(initData, BOT_TOKEN), /invalid/);
});

test('rejects a payload signed with the wrong bot token', () => {
  const fields = {
    query_id: 'AAH1abcd',
    user: JSON.stringify({ id: 12345, first_name: 'Aziz' }),
    auth_date: String(Math.floor(Date.now() / 1000)),
  };
  const initData = signInitData(fields, 'a-different-bot-token');

  assert.throws(() => verifyInitData(initData, BOT_TOKEN), /invalid/);
});

test('rejects an expired payload', () => {
  const fields = {
    query_id: 'AAH1abcd',
    user: JSON.stringify({ id: 12345, first_name: 'Aziz' }),
    auth_date: String(Math.floor(Date.now() / 1000) - 100000),
  };
  const initData = signInitData(fields, BOT_TOKEN);

  assert.throws(() => verifyInitData(initData, BOT_TOKEN, { maxAgeSeconds: 86400 }), /expired/);
});

test('rejects a payload missing the hash field', () => {
  assert.throws(() => verifyInitData('user=%7B%7D&auth_date=123', BOT_TOKEN), /hash/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module './telegramAuth.service.js'`

- [ ] **Step 3: Implement initData verification**

Create `backend/src/services/telegramAuth.service.js`:

```js
const crypto = require('node:crypto');

const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

function verifyInitData(initDataRaw, botToken, options = {}) {
  const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;

  if (!initDataRaw || typeof initDataRaw !== 'string') {
    throw new Error('initData is required');
  }

  const params = new URLSearchParams(initDataRaw);
  const receivedHash = params.get('hash');
  if (!receivedHash) {
    throw new Error('initData is missing hash');
  }
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const receivedHashBuffer = Buffer.from(receivedHash, 'hex');
  const computedHashBuffer = Buffer.from(computedHash, 'hex');
  const hashesMatch =
    receivedHashBuffer.length === computedHashBuffer.length &&
    crypto.timingSafeEqual(receivedHashBuffer, computedHashBuffer);

  if (!hashesMatch) {
    throw new Error('initData signature is invalid');
  }

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds) {
    throw new Error('initData has expired');
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    throw new Error('initData is missing user');
  }

  return JSON.parse(userRaw);
}

module.exports = { verifyInitData };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all 5 new tests green)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/telegramAuth.service.js backend/src/services/telegramAuth.service.test.js
git commit -m "feat(backend): verify Telegram WebApp initData via HMAC-SHA256"
```

---

## Task 3: User + session services and `POST /api/session`

**Files:**
- Create: `backend/src/services/user.service.js`
- Test: `backend/src/services/user.service.test.js`
- Create: `backend/src/services/session.service.js`
- Test: `backend/src/services/session.service.test.js`
- Create: `backend/src/routes/session.routes.js`
- Test: `backend/src/routes/session.routes.test.js`
- Modify: `backend/src/app.js`

**Interfaces:**
- Consumes: `verifyInitData` from Task 2; `createApp`, `createTestPool`, `resetDb` from Task 1.
- Produces: `upsertUser(pool, telegramUser)` → `{ id, telegram_id, username, first_name, last_name, language_code }`. `createSession(pool, userId)` → `{ id, user_id, started_at, last_active_at }`. Route `POST /api/session` (body `{ initData }`) → `200 { session_id, user }` or `401`.

- [ ] **Step 1: Write the failing test for the user service**

Create `backend/src/services/user.service.test.js`:

```js
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestPool, resetDb } = require('../db/testPool.js');
const { upsertUser } = require('./user.service.js');

let pool;

before(() => {
  pool = createTestPool();
});

beforeEach(async () => {
  await resetDb(pool);
});

after(async () => {
  await pool.end();
});

test('creates a new user on first upsert', async () => {
  const user = await upsertUser(pool, {
    id: 111,
    username: 'aziz_dev',
    first_name: 'Aziz',
    last_name: null,
    language_code: 'uz',
  });

  assert.equal(user.telegram_id, 111);
  assert.equal(user.username, 'aziz_dev');
});

test('updates existing user and keeps a single row per telegram_id', async () => {
  await upsertUser(pool, { id: 222, username: 'old_name', first_name: 'Old' });
  const updated = await upsertUser(pool, { id: 222, username: 'new_name', first_name: 'New' });

  const { rows } = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [222]);

  assert.equal(rows.length, 1);
  assert.equal(updated.username, 'new_name');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module './user.service.js'`

- [ ] **Step 3: Implement the user service**

Create `backend/src/services/user.service.js`:

```js
async function upsertUser(pool, telegramUser) {
  const { rows } = await pool.query(
    `INSERT INTO users (telegram_id, username, first_name, last_name, language_code)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (telegram_id) DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       language_code = EXCLUDED.language_code,
       last_seen_at = now()
     RETURNING id, telegram_id, username, first_name, last_name, language_code`,
    [
      telegramUser.id,
      telegramUser.username ?? null,
      telegramUser.first_name ?? null,
      telegramUser.last_name ?? null,
      telegramUser.language_code ?? null,
    ]
  );
  return rows[0];
}

module.exports = { upsertUser };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Write the failing test for the session service**

Create `backend/src/services/session.service.test.js`:

```js
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestPool, resetDb } = require('../db/testPool.js');
const { upsertUser } = require('./user.service.js');
const { createSession } = require('./session.service.js');

let pool;

before(() => {
  pool = createTestPool();
});

beforeEach(async () => {
  await resetDb(pool);
});

after(async () => {
  await pool.end();
});

test('creates a session linked to the given user', async () => {
  const user = await upsertUser(pool, { id: 333, username: 'aziz_dev', first_name: 'Aziz' });
  const session = await createSession(pool, user.id);

  assert.ok(session.id);
  assert.equal(session.user_id, user.id);
});
```

- [ ] **Step 6: Run test to verify it fails, then implement**

Run: `npm test` → FAIL with `Cannot find module './session.service.js'`

Create `backend/src/services/session.service.js`:

```js
async function createSession(pool, userId) {
  const { rows } = await pool.query(
    `INSERT INTO sessions (user_id) VALUES ($1) RETURNING id, user_id, started_at, last_active_at`,
    [userId]
  );
  return rows[0];
}

module.exports = { createSession };
```

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Write the failing route test**

Create `backend/src/routes/session.routes.test.js`:

```js
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const { createTestPool, resetDb } = require('../db/testPool.js');
const { createApp } = require('../app.js');

const BOT_TOKEN = 'test-bot-token-123';

const testEnv = {
  port: 3000,
  corsOrigin: '*',
  telegramBotToken: BOT_TOKEN,
  adminUsername: 'admin',
  adminPassword: 'secret',
};

function signInitData(fields, botToken) {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

let pool;

before(() => {
  pool = createTestPool();
});

beforeEach(async () => {
  await resetDb(pool);
});

after(async () => {
  await pool.end();
});

test('POST /api/session creates a user and session for valid initData', async () => {
  const app = createApp({ env: testEnv, pool });
  const initData = signInitData(
    {
      query_id: 'AAH1abcd',
      user: JSON.stringify({ id: 444, username: 'aziz_dev', first_name: 'Aziz' }),
      auth_date: String(Math.floor(Date.now() / 1000)),
    },
    BOT_TOKEN
  );

  const response = await request(app).post('/api/session').send({ initData });

  assert.equal(response.status, 200);
  assert.ok(response.body.session_id);
  assert.equal(response.body.user.username, 'aziz_dev');
});

test('POST /api/session rejects invalid initData', async () => {
  const app = createApp({ env: testEnv, pool });

  const response = await request(app).post('/api/session').send({ initData: 'not-valid' });

  assert.equal(response.status, 401);
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `POST /api/session` returns 404 (route doesn't exist yet)

- [ ] **Step 9: Implement the session route and mount it**

Create `backend/src/routes/session.routes.js`:

```js
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
```

Modify `backend/src/app.js` (replace entire file):

```js
const express = require('express');
const cors = require('cors');
const { createSessionRouter } = require('./routes/session.routes.js');

function createApp({ env, pool }) {
  const app = express();

  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/session', createSessionRouter({ env, pool }));

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}

module.exports = { createApp };
```

- [ ] **Step 10: Run all tests to verify they pass**

Run: `npm test`
Expected: PASS (all tests green, including Task 1/2 tests)

- [ ] **Step 11: Commit**

```bash
git add backend/src/services/user.service.js backend/src/services/user.service.test.js \
  backend/src/services/session.service.js backend/src/services/session.service.test.js \
  backend/src/routes/session.routes.js backend/src/routes/session.routes.test.js backend/src/app.js
git commit -m "feat(backend): add POST /api/session to identify and upsert Telegram users"
```

---

## Task 4: Event service and `POST /api/events` (with rate limiting)

**Files:**
- Create: `backend/src/services/event.service.js`
- Test: `backend/src/services/event.service.test.js`
- Create: `backend/src/routes/events.routes.js`
- Test: `backend/src/routes/events.routes.test.js`
- Modify: `backend/src/app.js`
- Modify: `backend/src/app.test.js`

**Interfaces:**
- Consumes: `createApp`, `upsertUser`, `createSession` from earlier tasks.
- Produces: `insertEvents(pool, sessionId, userId, events)` → inserted count. `sessionExists(pool, sessionId)` → session row or `null`. Route `POST /api/events` (body `{ session_id, events: [{ type, payload, occurred_at? }] }`) → `202 { inserted }`, `400`, or `404`.

- [ ] **Step 1: Write the failing test for the event service**

Create `backend/src/services/event.service.test.js`:

```js
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestPool, resetDb } = require('../db/testPool.js');
const { upsertUser } = require('./user.service.js');
const { createSession } = require('./session.service.js');
const { insertEvents, sessionExists } = require('./event.service.js');

let pool;

before(() => {
  pool = createTestPool();
});

beforeEach(async () => {
  await resetDb(pool);
});

after(async () => {
  await pool.end();
});

test('inserts a batch of events and bumps session activity', async () => {
  const user = await upsertUser(pool, { id: 555, username: 'aziz_dev', first_name: 'Aziz' });
  const session = await createSession(pool, user.id);

  const count = await insertEvents(pool, session.id, user.id, [
    { type: 'page_view', payload: { screen: 'welcome-screen' } },
    { type: 'page_view', payload: { screen: 'setup-screen' } },
  ]);

  assert.equal(count, 2);

  const { rows } = await pool.query(
    'SELECT type, payload FROM events WHERE session_id = $1 ORDER BY id',
    [session.id]
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[1].payload.screen, 'setup-screen');
});

test('sessionExists returns null for an unknown session', async () => {
  const found = await sessionExists(pool, 999999);
  assert.equal(found, null);
});

test('sessionExists returns the session row for a known session', async () => {
  const user = await upsertUser(pool, { id: 556, username: 'aziz_dev', first_name: 'Aziz' });
  const session = await createSession(pool, user.id);

  const found = await sessionExists(pool, session.id);
  assert.equal(found.id, session.id);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module './event.service.js'`

- [ ] **Step 3: Implement the event service**

Create `backend/src/services/event.service.js`:

```js
async function insertEvents(pool, sessionId, userId, events) {
  if (!Array.isArray(events) || events.length === 0) {
    return 0;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const event of events) {
      await client.query(
        `INSERT INTO events (session_id, user_id, type, payload, occurred_at)
         VALUES ($1, $2, $3, $4, COALESCE($5, now()))`,
        [sessionId, userId, event.type, event.payload ?? {}, event.occurred_at ?? null]
      );
    }

    await client.query('UPDATE sessions SET last_active_at = now() WHERE id = $1', [sessionId]);

    await client.query('COMMIT');
    return events.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function sessionExists(pool, sessionId) {
  const { rows } = await pool.query('SELECT id, user_id FROM sessions WHERE id = $1', [sessionId]);
  return rows[0] ?? null;
}

module.exports = { insertEvents, sessionExists };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Write the failing route test**

Create `backend/src/routes/events.routes.test.js`:

```js
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestPool, resetDb } = require('../db/testPool.js');
const { createApp } = require('../app.js');
const { upsertUser } = require('../services/user.service.js');
const { createSession } = require('../services/session.service.js');

const testEnv = {
  port: 3000,
  corsOrigin: '*',
  telegramBotToken: 'test-bot-token-123',
  adminUsername: 'admin',
  adminPassword: 'secret',
};

let pool;

before(() => {
  pool = createTestPool();
});

beforeEach(async () => {
  await resetDb(pool);
});

after(async () => {
  await pool.end();
});

test('POST /api/events stores events for a known session', async () => {
  const user = await upsertUser(pool, { id: 777, username: 'aziz_dev', first_name: 'Aziz' });
  const session = await createSession(pool, user.id);
  const app = createApp({ env: testEnv, pool });

  const response = await request(app)
    .post('/api/events')
    .send({ session_id: session.id, events: [{ type: 'page_view', payload: { screen: 'quiz-screen' } }] });

  assert.equal(response.status, 202);
  assert.equal(response.body.inserted, 1);
});

test('POST /api/events returns 404 for an unknown session_id', async () => {
  const app = createApp({ env: testEnv, pool });

  const response = await request(app)
    .post('/api/events')
    .send({ session_id: 999999, events: [{ type: 'page_view', payload: {} }] });

  assert.equal(response.status, 404);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `POST /api/events` returns 404 for a different reason (route missing, not the "unknown session" 404) — the first test asserting 202 fails.

- [ ] **Step 7: Implement the events route, mount it, and add rate limiting**

Create `backend/src/routes/events.routes.js`:

```js
const express = require('express');
const { insertEvents, sessionExists } = require('../services/event.service.js');

function createEventsRouter({ pool }) {
  const router = express.Router();

  router.post('/', async (req, res, next) => {
    try {
      const { session_id: sessionId, events } = req.body;

      if (!sessionId || !Array.isArray(events)) {
        return res.status(400).json({ error: 'session_id and events[] are required' });
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
```

Modify `backend/src/app.js` (replace entire file):

```js
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createSessionRouter } = require('./routes/session.routes.js');
const { createEventsRouter } = require('./routes/events.routes.js');

function createApp({ env, pool }) {
  const app = express();

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

  app.use('/api/session', publicApiLimiter, createSessionRouter({ env, pool }));
  app.use('/api/events', publicApiLimiter, createEventsRouter({ pool }));

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}

module.exports = { createApp };
```

- [ ] **Step 8: Run all tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Add a rate-limit regression test**

Modify `backend/src/app.test.js` — add this test at the end of the file (keep the existing two tests):

```js

test('POST /api/session is rate limited after too many requests in a window', async () => {
  const app = createApp({ env: testEnv, pool: null });

  let lastStatus;
  for (let i = 0; i < 61; i += 1) {
    const response = await request(app).post('/api/session').send({ initData: 'not-valid' });
    lastStatus = response.status;
  }

  assert.equal(lastStatus, 429);
});
```

Run: `npm test`
Expected: PASS (this test takes a few seconds due to 61 sequential requests, but stays in-process)

- [ ] **Step 10: Commit**

```bash
git add backend/src/services/event.service.js backend/src/services/event.service.test.js \
  backend/src/routes/events.routes.js backend/src/routes/events.routes.test.js \
  backend/src/app.js backend/src/app.test.js
git commit -m "feat(backend): add POST /api/events with rate limiting"
```

---

## Task 5: Admin auth + stats service + `GET /api/admin/stats`

**Files:**
- Create: `backend/src/middleware/adminAuth.js`
- Test: `backend/src/middleware/adminAuth.test.js`
- Create: `backend/src/services/stats.service.js`
- Test: `backend/src/services/stats.service.test.js`
- Create: `backend/src/routes/admin.routes.js`
- Test: `backend/src/routes/admin.routes.test.js`
- Modify: `backend/src/app.js`

**Interfaces:**
- Consumes: `createApp`, `insertEvents`, `upsertUser`, `createSession` from earlier tasks.
- Produces: `adminAuth(env)` → Express middleware enforcing HTTP Basic Auth. `getOverview(pool)` → `{ total_users, daily_active_users, weekly_active_users, top_screens, top_books, average_quiz_score }`. Route `GET /api/admin/stats` (Basic Auth protected) → `200` with that shape, or `401`.

- [ ] **Step 1: Write the failing test for admin auth**

Create `backend/src/middleware/adminAuth.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails, then implement**

Run: `npm test` → FAIL with `Cannot find module './adminAuth.js'`

Create `backend/src/middleware/adminAuth.js`:

```js
const crypto = require('node:crypto');

function adminAuth(env) {
  return (req, res, next) => {
    const header = req.headers.authorization;

    if (!header || !header.startsWith('Basic ')) {
      res.set('WWW-Authenticate', 'Basic realm="Admin"');
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    const username = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);

    const usernameOk =
      username.length === env.adminUsername.length &&
      crypto.timingSafeEqual(Buffer.from(username), Buffer.from(env.adminUsername));
    const passwordOk =
      password.length === env.adminPassword.length &&
      crypto.timingSafeEqual(Buffer.from(password), Buffer.from(env.adminPassword));

    if (!usernameOk || !passwordOk) {
      res.set('WWW-Authenticate', 'Basic realm="Admin"');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    next();
  };
}

module.exports = { adminAuth };
```

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Write the failing test for the stats service**

Create `backend/src/services/stats.service.test.js`:

```js
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestPool, resetDb } = require('../db/testPool.js');
const { upsertUser } = require('./user.service.js');
const { createSession } = require('./session.service.js');
const { insertEvents } = require('./event.service.js');
const { getOverview } = require('./stats.service.js');

let pool;

before(() => {
  pool = createTestPool();
});

beforeEach(async () => {
  await resetDb(pool);
});

after(async () => {
  await pool.end();
});

test('summarizes users, top screens, and quiz scores', async () => {
  const user = await upsertUser(pool, { id: 888, username: 'aziz_dev', first_name: 'Aziz' });
  const session = await createSession(pool, user.id);

  await insertEvents(pool, session.id, user.id, [
    { type: 'page_view', payload: { screen: 'welcome-screen' } },
    { type: 'page_view', payload: { screen: 'welcome-screen' } },
    { type: 'page_view', payload: { screen: 'quiz-screen', book: 'Essential 1' } },
    { type: 'quiz_result', payload: { correct_count: 8, total_questions: 10 } },
  ]);

  const overview = await getOverview(pool);

  assert.equal(overview.total_users, 1);
  assert.equal(overview.daily_active_users, 1);
  assert.equal(overview.top_screens[0].screen, 'welcome-screen');
  assert.equal(overview.top_screens[0].views, 2);
  assert.equal(overview.top_books[0].book, 'Essential 1');
  assert.equal(overview.average_quiz_score.correct, 8);
  assert.equal(overview.average_quiz_score.total, 10);
});
```

- [ ] **Step 4: Run test to verify it fails, then implement**

Run: `npm test` → FAIL with `Cannot find module './stats.service.js'`

Create `backend/src/services/stats.service.js`:

```js
async function getOverview(pool) {
  const {
    rows: [totals],
  } = await pool.query(`
    SELECT
      (SELECT count(*) FROM users) AS total_users,
      (SELECT count(DISTINCT user_id) FROM events WHERE occurred_at >= now() - interval '1 day') AS daily_active_users,
      (SELECT count(DISTINCT user_id) FROM events WHERE occurred_at >= now() - interval '7 days') AS weekly_active_users
  `);

  const { rows: topScreens } = await pool.query(`
    SELECT payload->>'screen' AS screen, count(*) AS views
    FROM events
    WHERE type = 'page_view' AND payload->>'screen' IS NOT NULL
    GROUP BY payload->>'screen'
    ORDER BY views DESC
    LIMIT 10
  `);

  const { rows: topBooks } = await pool.query(`
    SELECT payload->>'book' AS book, count(*) AS views
    FROM events
    WHERE type = 'page_view' AND payload->>'book' IS NOT NULL
    GROUP BY payload->>'book'
    ORDER BY views DESC
    LIMIT 10
  `);

  const {
    rows: [scoreSummary],
  } = await pool.query(`
    SELECT
      avg((payload->>'correct_count')::numeric) AS avg_correct,
      avg((payload->>'total_questions')::numeric) AS avg_total
    FROM events
    WHERE type = 'quiz_result'
  `);

  return {
    total_users: Number(totals.total_users),
    daily_active_users: Number(totals.daily_active_users),
    weekly_active_users: Number(totals.weekly_active_users),
    top_screens: topScreens.map((row) => ({ screen: row.screen, views: Number(row.views) })),
    top_books: topBooks.map((row) => ({ book: row.book, views: Number(row.views) })),
    average_quiz_score: {
      correct: scoreSummary.avg_correct === null ? null : Number(scoreSummary.avg_correct),
      total: scoreSummary.avg_total === null ? null : Number(scoreSummary.avg_total),
    },
  };
}

module.exports = { getOverview };
```

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Write the failing route test**

Create `backend/src/routes/admin.routes.test.js`:

```js
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestPool, resetDb } = require('../db/testPool.js');
const { createApp } = require('../app.js');

const testEnv = {
  port: 3000,
  corsOrigin: '*',
  telegramBotToken: 'test-bot-token-123',
  adminUsername: 'admin',
  adminPassword: 'secret',
};

let pool;

before(() => {
  pool = createTestPool();
});

beforeEach(async () => {
  await resetDb(pool);
});

after(async () => {
  await pool.end();
});

test('GET /api/admin/stats requires authentication', async () => {
  const app = createApp({ env: testEnv, pool });
  const response = await request(app).get('/api/admin/stats');
  assert.equal(response.status, 401);
});

test('GET /api/admin/stats returns an overview for valid credentials', async () => {
  const app = createApp({ env: testEnv, pool });
  const token = Buffer.from('admin:secret').toString('base64');

  const response = await request(app).get('/api/admin/stats').set('Authorization', `Basic ${token}`);

  assert.equal(response.status, 200);
  assert.ok('total_users' in response.body);
  assert.ok(Array.isArray(response.body.top_screens));
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `GET /api/admin/stats` returns 404 (route not mounted yet)

- [ ] **Step 7: Implement the admin route and mount it**

Create `backend/src/routes/admin.routes.js`:

```js
const express = require('express');
const { adminAuth } = require('../middleware/adminAuth.js');
const { getOverview } = require('../services/stats.service.js');

function createAdminRouter({ env, pool }) {
  const router = express.Router();

  router.use(adminAuth(env));

  router.get('/stats', async (req, res, next) => {
    try {
      const overview = await getOverview(pool);
      res.json(overview);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createAdminRouter };
```

Modify `backend/src/app.js` (replace entire file):

```js
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createSessionRouter } = require('./routes/session.routes.js');
const { createEventsRouter } = require('./routes/events.routes.js');
const { createAdminRouter } = require('./routes/admin.routes.js');

function createApp({ env, pool }) {
  const app = express();

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

  app.use('/api/session', publicApiLimiter, createSessionRouter({ env, pool }));
  app.use('/api/events', publicApiLimiter, createEventsRouter({ pool }));
  app.use('/api/admin', createAdminRouter({ env, pool }));

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}

module.exports = { createApp };
```

- [ ] **Step 8: Run all tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add backend/src/middleware/adminAuth.js backend/src/middleware/adminAuth.test.js \
  backend/src/services/stats.service.js backend/src/services/stats.service.test.js \
  backend/src/routes/admin.routes.js backend/src/routes/admin.routes.test.js backend/src/app.js
git commit -m "feat(backend): add password-protected GET /api/admin/stats"
```

---

## Task 6: Central error handler

**Files:**
- Create: `backend/src/middleware/errorHandler.js`
- Test: `backend/src/middleware/errorHandler.test.js`
- Modify: `backend/src/app.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `errorHandler(err, req, res, next)` — Express error middleware. Any route calling `next(error)` gets a JSON `{ error: message }` response; `error.statusCode` controls the HTTP status (defaults to 500 with a generic message that never leaks `error.message`).

- [ ] **Step 1: Write the failing tests**

Create `backend/src/middleware/errorHandler.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail, then implement**

Run: `npm test` → FAIL with `Cannot find module './errorHandler.js'`

Create `backend/src/middleware/errorHandler.js`:

```js
function errorHandler(err, req, res, next) {
  console.error(err);
  const statusCode = err.statusCode ?? 500;
  res.status(statusCode).json({ error: statusCode === 500 ? 'Internal server error' : err.message });
}

module.exports = { errorHandler };
```

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Wire the error handler into the app**

Modify `backend/src/app.js` (replace entire file):

```js
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createSessionRouter } = require('./routes/session.routes.js');
const { createEventsRouter } = require('./routes/events.routes.js');
const { createAdminRouter } = require('./routes/admin.routes.js');
const { errorHandler } = require('./middleware/errorHandler.js');

function createApp({ env, pool }) {
  const app = express();

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

  app.use('/api/session', publicApiLimiter, createSessionRouter({ env, pool }));
  app.use('/api/events', publicApiLimiter, createEventsRouter({ pool }));
  app.use('/api/admin', createAdminRouter({ env, pool }));

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `npm test`
Expected: PASS (full suite green)

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/errorHandler.js backend/src/middleware/errorHandler.test.js backend/src/app.js
git commit -m "feat(backend): add a central error handler that never leaks internals"
```

---

## Task 7: Admin panel static page

**Files:**
- Create: `backend/admin/index.html`
- Modify: `backend/src/app.js`
- Modify: `backend/src/app.test.js`

**Interfaces:**
- Consumes: `GET /api/admin/stats` from Task 5, `adminAuth` from Task 5.
- Produces: `GET /admin` (Basic Auth protected) serves a static HTML page that renders the stats.

- [ ] **Step 1: Write the failing test**

Modify `backend/src/app.test.js` — add this test at the end of the file:

```js

test('GET /admin requires authentication', async () => {
  const app = createApp({ env: testEnv, pool: null });
  const response = await request(app).get('/admin/');
  assert.equal(response.status, 401);
});
```

Run: `npm test`
Expected: FAIL — `/admin/` currently falls through to the 404 handler, so the response body is `{"error":"Not found"}` with status 404, not 401.

- [ ] **Step 2: Create the admin panel page**

Create `backend/admin/index.html`:

```html
<!doctype html>
<html lang="uz">
<head>
  <meta charset="UTF-8" />
  <title>Essential — Admin statistikasi</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ddd; }
    .cards { display: flex; gap: 16px; margin-bottom: 24px; }
    .card { flex: 1; border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
    .card strong { display: block; font-size: 24px; }
  </style>
</head>
<body>
  <h1>Foydalanuvchi statistikasi</h1>

  <div class="cards">
    <div class="card">Jami foydalanuvchilar<strong id="total-users">-</strong></div>
    <div class="card">Bugun faol<strong id="daily-active">-</strong></div>
    <div class="card">Shu hafta faol<strong id="weekly-active">-</strong></div>
  </div>

  <h2>Eng ko'p ochilgan sahifalar</h2>
  <table id="top-screens"><thead><tr><th>Sahifa</th><th>Tashriflar</th></tr></thead><tbody></tbody></table>

  <h2>Eng mashhur kitoblar</h2>
  <table id="top-books"><thead><tr><th>Kitob</th><th>Tashriflar</th></tr></thead><tbody></tbody></table>

  <h2>O'rtacha test natijasi</h2>
  <p id="avg-score">-</p>

  <script>
    fetch('/api/admin/stats')
      .then((response) => {
        if (!response.ok) {
          throw new Error("Statistikani yuklab bo'lmadi");
        }
        return response.json();
      })
      .then((data) => {
        document.getElementById('total-users').textContent = data.total_users;
        document.getElementById('daily-active').textContent = data.daily_active_users;
        document.getElementById('weekly-active').textContent = data.weekly_active_users;

        const screensBody = document.querySelector('#top-screens tbody');
        data.top_screens.forEach((row) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${row.screen}</td><td>${row.views}</td>`;
          screensBody.appendChild(tr);
        });

        const booksBody = document.querySelector('#top-books tbody');
        data.top_books.forEach((row) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${row.book}</td><td>${row.views}</td>`;
          booksBody.appendChild(tr);
        });

        const { correct, total } = data.average_quiz_score;
        document.getElementById('avg-score').textContent =
          correct === null ? "Hali ma'lumot yo'q" : `${correct.toFixed(1)} / ${total.toFixed(1)}`;
      })
      .catch((error) => {
        document.body.insertAdjacentHTML('afterbegin', `<p style="color:red">${error.message}</p>`);
      });
  </script>
</body>
</html>
```

- [ ] **Step 3: Serve the admin panel behind adminAuth**

Modify `backend/src/app.js` (replace entire file):

```js
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createSessionRouter } = require('./routes/session.routes.js');
const { createEventsRouter } = require('./routes/events.routes.js');
const { createAdminRouter } = require('./routes/admin.routes.js');
const { adminAuth } = require('./middleware/adminAuth.js');
const { errorHandler } = require('./middleware/errorHandler.js');

function createApp({ env, pool }) {
  const app = express();

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

  app.use('/api/session', publicApiLimiter, createSessionRouter({ env, pool }));
  app.use('/api/events', publicApiLimiter, createEventsRouter({ pool }));
  app.use('/api/admin', createAdminRouter({ env, pool }));
  app.use('/admin', adminAuth(env), express.static(path.join(__dirname, '..', 'admin')));

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Manually verify the admin panel renders real data**

Run:
```bash
npm start
```

In another terminal, create a session and a couple of events so the panel has something to show:
```bash
curl -s -X POST http://localhost:3000/api/session -H "Content-Type: application/json" \
  -d '{"initData":"anything"}'
```
Expected: `{"error":"Invalid Telegram authentication data"}` — this is expected without a real signed payload; it just confirms the server is up. To see real numbers, this step is easiest to confirm after Task 9 is deployed and the app is opened inside real Telegram at least once.

Open `http://localhost:3000/admin` in a browser. Expected: the browser shows a native Basic Auth prompt; enter the `ADMIN_USERNAME`/`ADMIN_PASSWORD` from `backend/.env`. After login, the page loads with `0` counts (no data yet) and no JavaScript console errors. Stop the server with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add backend/admin/index.html backend/src/app.js backend/src/app.test.js
git commit -m "feat(backend): serve a password-protected admin stats panel"
```

---

## Task 8: Docker packaging for self-hosted deployment

**Files:**
- Create: `backend/Dockerfile`
- Create: `backend/.dockerignore`
- Modify: `backend/docker-compose.yml`

**Interfaces:**
- Consumes: the full app built in Tasks 1–7.
- Produces: `docker compose up -d --build` runs `postgres` + `app` services together on any server with Docker installed.

- [ ] **Step 1: Create the Dockerfile**

Create `backend/Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY admin ./admin

EXPOSE 3000

CMD ["node", "src/server.js"]
```

Create `backend/.dockerignore`:

```
node_modules
.env
*.test.js
```

- [ ] **Step 2: Add the app service to docker-compose.yml**

Modify `backend/docker-compose.yml` (replace entire file):

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: essential
      POSTGRES_PASSWORD: essential
      POSTGRES_DB: essential
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  app:
    build: .
    env_file: .env
    ports:
      - "3000:3000"
    depends_on:
      - postgres

volumes:
  pgdata:
```

- [ ] **Step 3: Verify the full stack builds and runs**

Run:
```bash
docker compose up -d --build
sleep 3
curl http://localhost:3000/health
```
Expected: `{"status":"ok"}`

Run:
```bash
docker compose exec app node -e "console.log(process.env.DATABASE_URL)"
```
Expected: prints the `DATABASE_URL` from `.env`, confirming `env_file` is wired correctly.

Note: if this is the first time this stack runs (fresh `postgres` volume), apply migrations against the running container before expecting `/api/admin/stats` to work:
```bash
DATABASE_URL=postgres://essential:essential@localhost:5432/essential npm run migrate -- up
```

Tear down when done inspecting:
```bash
docker compose down
```

- [ ] **Step 4: Commit**

```bash
git add backend/Dockerfile backend/.dockerignore backend/docker-compose.yml
git commit -m "feat(backend): package app + postgres for self-hosted Docker deployment"
```

---

## Task 9: Frontend tracking integration

**Files:**
- Create: `tracking.js`
- Modify: `index.html:786` (script tags)
- Modify: `app.js:24549` (`showScreen` function)
- Modify: `app.js:27974-27976` (`finishQuiz` function, just before `showScreen("result-screen")`)

**Interfaces:**
- Consumes: `POST /api/session` and `POST /api/events` from Tasks 3–4.
- Produces: `window.trackEvent(type, payload)` — global function `app.js` calls to queue an analytics event. Never throws.

- [ ] **Step 1: Create the tracking module**

Create `tracking.js` in the project root (alongside `app.js`):

```js
(function () {
  const API_BASE_URL = "https://your-backend-domain.example"; // TODO: replace with your deployed backend URL
  const FLUSH_INTERVAL_MS = 10000;
  const MAX_BUFFERED_EVENTS = 200;

  let sessionId = null;
  let buffer = [];

  function queueEvent(type, payload) {
    buffer.push({ type, payload, occurred_at: new Date().toISOString() });
    if (buffer.length > MAX_BUFFERED_EVENTS) {
      buffer.shift();
    }
  }

  function flush(useBeacon) {
    if (!sessionId || buffer.length === 0) return;

    const events = buffer;
    buffer = [];
    const body = JSON.stringify({ session_id: sessionId, events });

    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(
        `${API_BASE_URL}/api/events`,
        new Blob([body], { type: "application/json" })
      );
      return;
    }

    fetch(`${API_BASE_URL}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }

  function startSession() {
    const telegram = window.Telegram && window.Telegram.WebApp;
    if (!telegram || !telegram.initData) return;

    telegram.ready();

    fetch(`${API_BASE_URL}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: telegram.initData }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data && data.session_id) {
          sessionId = data.session_id;
          flush(false);
        }
      })
      .catch(() => {});
  }

  window.trackEvent = queueEvent;

  document.addEventListener("DOMContentLoaded", startSession);
  setInterval(() => flush(false), FLUSH_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
  window.addEventListener("pagehide", () => flush(true));
})();
```

- [ ] **Step 2: Load the Telegram SDK and the tracking module**

Modify `index.html` around line 786 — replace:

```html
    <script src="app.js"></script>
```

with:

```html
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <script src="tracking.js"></script>
    <script src="app.js"></script>
```

- [ ] **Step 3: Track every screen navigation**

Modify `app.js` — in `showScreen(screenId)` (around line 24549), the current function starts with:

```js
function showScreen(screenId) {
  document.querySelectorAll(".view-screen").forEach(screen => {
```

Change it to:

```js
function showScreen(screenId) {
  if (window.trackEvent) {
    window.trackEvent("page_view", {
      screen: screenId,
      book: state.selectedBooks && state.selectedBooks.length ? state.selectedBooks.join(", ") : null,
    });
  }

  document.querySelectorAll(".view-screen").forEach(screen => {
```

- [ ] **Step 4: Track quiz results**

Modify `app.js` — in `finishQuiz()` (around line 27974), the current code reads:

```js
  // Clear active questions pool since it is completed
  state.questions = [];
  
  showScreen("result-screen");
```

Change it to:

```js
  // Clear active questions pool since it is completed
  state.questions = [];

  if (window.trackEvent) {
    window.trackEvent("quiz_result", {
      book: state.selectedBooks.join(", "),
      units: state.selectedUnits,
      mode: state.mode,
      correct_count: state.correctCount,
      total_questions: state.correctCount + state.incorrectCount,
    });
  }

  showScreen("result-screen");
```

- [ ] **Step 5: Manually verify nothing breaks outside Telegram**

This codebase has no existing frontend test framework (per the design spec, one was deliberately not introduced), so verification here is manual:

1. Serve the project locally, e.g. `npx serve .` from the project root, and open the printed URL in a browser.
2. Open DevTools Console. Expected: no errors — `window.Telegram` is undefined in a plain browser, so `startSession()` returns early and tracking silently no-ops.
3. Click through screens (welcome → book → setup → quiz → result). Expected: navigation, quizzes, and results behave exactly as before this change.
4. Open the DevTools Network tab. Expected: no requests to `API_BASE_URL` are made (since there's no `session_id` yet, `flush()` returns immediately).

- [ ] **Step 6: Manually verify tracking works inside real Telegram**

After deploying the backend (Task 8) to a real server and updating `API_BASE_URL` in `tracking.js` to that server's real HTTPS URL, and updating `CORS_ORIGIN` in `backend/.env` to the mini app's real domain:

1. Open the bot in Telegram and launch the Mini App.
2. Navigate through a few screens and finish one quiz.
3. Query the database directly: `docker compose exec postgres psql -U essential -d essential -c "SELECT * FROM users;"` — expected: one row with your Telegram account's `telegram_id`.
4. Repeat for `sessions` and `events` tables — expected: a session row and several `page_view`/`quiz_result` event rows.
5. Open `https://<your-backend-domain>/admin`, log in, and confirm the counts match what you just did.

- [ ] **Step 7: Commit**

```bash
git add tracking.js index.html app.js
git commit -m "feat: send buffered, non-blocking analytics events to the backend"
```

---

## Post-Implementation Notes

- Before the first real deploy, fill in `backend/.env` on the server with the real `TELEGRAM_BOT_TOKEN` (from BotFather), a strong `ADMIN_PASSWORD`, and `CORS_ORIGIN` set to the mini app's actual domain.
- Update `API_BASE_URL` in `tracking.js` to the backend's real HTTPS URL before deploying the frontend.
- Broadcasting messages by `chat_id` (mentioned as a future need) is out of scope for this plan — `users.telegram_id` is already stored and ready for it; it only needs a small script calling Telegram's `sendMessage` Bot API endpoint when that feature is actually requested.
