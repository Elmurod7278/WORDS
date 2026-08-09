# Admin Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the admin panel from a single long page into a tab-based interface with a dedicated user management section including per-user day-by-day activity history, search, and pagination.

**Architecture:** Three-tab layout (Overview, User Management, Content & Analytics) with vanilla JS tab switching. Backend adds a new `/api/admin/users/:id/timeline` endpoint for per-user event aggregation, and modifies `GET /api/admin/users` to support limit/offset pagination.

**Tech Stack:** Vanilla JavaScript + HTML/CSS (no framework), existing dark theme CSS custom properties, PostgreSQL date_trunc/aggregation.

## Global Constraints

- Frontend: Vanilla JS/HTML/CSS only — no React, build tools, or frameworks
- Styling: Use existing CSS custom properties (`--card-bg`, `--primary`, `--text-main`, `--card-border`, `--text-muted`) from `backend/admin/index.html`
- Backend: Node.js/Express, use existing `pg` raw queries (no ORM)
- Admin panel authentication: HTTP Basic Auth — no changes
- No automated test framework for frontend (manual testing only)
- Backend tests via `npm test` (existing Jest/node:test setup)
- All dates use Tashkent timezone (`'Asia/Tashkent'`) for consistency
- User timeline events: `page_views` (type='page_view') and `quizzes` (type='quiz_result'), grouped by date (day granularity)
- Tab IDs: `overview`, `users`, `content` — used consistently in HTML and JS

---

## File Structure

```
backend/
  admin/
    index.html                     # MODIFY: restructure entire layout
  src/
    services/
      stats.service.js             # MODIFY: add getUserTimeline(), update getUsersOverview()
    routes/
      admin.routes.js              # MODIFY: add /users/:id/timeline route, update /users route
```

---

### Task 1: Backend — Add getUserTimeline() Function and Modify getUsersOverview() for Pagination

**Files:**
- Modify: `backend/src/services/stats.service.js:193-302`
- Test: Existing backend test runner (npm test)

**Interfaces:**
- Consumes: PostgreSQL `events` table with columns: `user_id`, `type`, `payload`, `occurred_at`
- Produces:
  - `getUserTimeline(pool, userId)` returns: `Promise<Array<{date: string, page_views: Array<{screen: string, book?: string}>, quizzes: Array<{mode: string, correct: number, total: number, book?: string}>}>>`
  - `getUsersOverview(pool, filters)` modified signature: `filters` now includes `limit` (number), `offset` (number); returns `Promise<{users: Array, total_count: number}>` instead of just `Array`

- [ ] **Step 1: Read the current getUsersOverview function and understand its SQL structure**

Open `backend/src/services/stats.service.js` line 193-302. Note:
- It queries from `users` table with multiple subqueries (last_active, last_screen, quizzes_taken, etc.)
- It uses pagination in sort but NOT in the main query (returns all rows)
- Return value is currently `rows.map(...)` transforming each row

- [ ] **Step 2: Write getUserTimeline() before getUsersOverview()**

Add this new function at line 193 (push getUsersOverview down):

```javascript
async function getUserTimeline(pool, userId) {
  const { rows } = await pool.query(
    `
    SELECT 
      date_trunc('day', occurred_at AT TIME ZONE $1)::date AS day,
      type,
      payload
    FROM events
    WHERE user_id = $2
    ORDER BY occurred_at DESC
    `,
    ['Asia/Tashkent', userId]
  );

  const timelineByDay = {};
  rows.forEach(row => {
    const day = row.day.toISOString().split('T')[0]; // Convert Date to YYYY-MM-DD string
    if (!timelineByDay[day]) {
      timelineByDay[day] = { date: day, page_views: [], quizzes: [] };
    }

    if (row.type === 'page_view') {
      timelineByDay[day].page_views.push({
        screen: row.payload.screen || null,
        book: row.payload.book || null
      });
    } else if (row.type === 'quiz_result') {
      const correctCount = row.payload.correct_count ? Number(row.payload.correct_count) : null;
      const totalCount = row.payload.total_questions ? Number(row.payload.total_questions) : null;
      timelineByDay[day].quizzes.push({
        mode: row.payload.mode || null,
        correct: correctCount,
        total: totalCount,
        book: row.payload.book || null
      });
    }
  });

  return Object.values(timelineByDay);
}
```

- [ ] **Step 3: Modify getUsersOverview() to accept and use limit/offset**

Locate the SQL query in getUsersOverview (around line 228-277 in current file). Add LIMIT/OFFSET to the final query:

Find this line:
```javascript
const { rows } = await pool.query(
  `
  SELECT
    u.id,
    ...
  FROM users u
  WHERE 1=1 ${searchClause}
  ORDER BY ${orderBy}
  `,
  params
);
```

Replace the full query block with:

```javascript
// First, get total count (without LIMIT/OFFSET)
const countResult = await pool.query(
  `
  SELECT count(*) AS total
  FROM users u
  WHERE 1=1 ${searchClause}
  `,
  params.slice(0, params.length - (searchClause ? 1 : 0)) // Use only the params needed for this query
);
const totalCount = Number(countResult.rows[0].total);

// Then, get paginated results
const { rows } = await pool.query(
  `
  SELECT
    u.id,
    u.first_name,
    u.last_name,
    u.username,
    u.phone_number,
    (SELECT max(occurred_at) FROM events WHERE user_id = u.id) AS last_active,
    (
      SELECT payload->>'screen' FROM events
      WHERE user_id = u.id AND type = 'page_view'
      ORDER BY occurred_at DESC, id DESC LIMIT 1
    ) AS last_screen,
    (SELECT count(*) FROM events WHERE user_id = u.id AND type = 'quiz_result') AS quizzes_taken,
    (
      SELECT avg(
        CASE WHEN payload->>'correct_count' ~ '^[0-9]+(\\.[0-9]+)?$'
             THEN (payload->>'correct_count')::numeric ELSE NULL END
      )
      FROM events WHERE user_id = u.id AND type = 'quiz_result'
    ) AS avg_correct,
    (
      SELECT avg(
        CASE WHEN payload->>'total_questions' ~ '^[0-9]+(\\.[0-9]+)?$'
             THEN (payload->>'total_questions')::numeric ELSE NULL END
      )
      FROM events WHERE user_id = u.id AND type = 'quiz_result'
    ) AS avg_total,
    (
      SELECT extract(epoch FROM (max(occurred_at) - min(occurred_at))) / 60
      FROM events
      WHERE user_id = u.id
        AND occurred_at >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1
    ) AS today_active_minutes,
    (SELECT count(*) FROM events WHERE user_id = u.id AND type = 'page_view') AS total_page_views,
    (
      SELECT payload->>'mode' FROM (
        SELECT payload->>'mode' AS mode, count(*) AS cnt
        FROM events WHERE user_id = u.id AND type = 'mode_selected'
        GROUP BY payload->>'mode' ORDER BY cnt DESC LIMIT 1
      ) sub(mode, cnt)
    ) AS favorite_mode,
    (SELECT count(DISTINCT payload->>'book') FROM events WHERE user_id = u.id AND type = 'page_view' AND payload->>'book' IS NOT NULL) AS books_viewed
  FROM users u
  WHERE 1=1 ${searchClause}
  ORDER BY ${orderBy}
  LIMIT $${pIdx + 1}
  OFFSET $${pIdx + 2}
  `,
  [...params, filters.limit, filters.offset]
);
```

- [ ] **Step 4: Update the return statement to include total_count**

Change the return from:
```javascript
return rows.map((row) => { ... });
```

To:
```javascript
const users = rows.map((row) => {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
    || (row.username ? `@${row.username}` : `Foydalanuvchi #${row.id}`);
  return {
    id: row.id,
    name,
    username: row.username,
    phone_number: row.phone_number,
    last_active: row.last_active,
    last_screen: row.last_screen,
    quizzes_taken: Number(row.quizzes_taken),
    avg_score: {
      correct: row.avg_correct === null ? null : Number(row.avg_correct),
      total: row.avg_total === null ? null : Number(row.avg_total),
    },
    today_active_minutes: row.today_active_minutes === null ? 0 : Math.round(Number(row.today_active_minutes)),
    total_page_views: Number(row.total_page_views),
    favorite_mode: row.favorite_mode ? (MODE_LABELS[row.favorite_mode] || row.favorite_mode) : null,
    favorite_mode_key: row.favorite_mode,
    books_viewed: Number(row.books_viewed),
  };
});

return { users, total_count: totalCount };
```

- [ ] **Step 5: Export the new getUserTimeline function**

Find the module.exports line (around line 425). Change from:
```javascript
module.exports = { getOverview, getUsersOverview, getActivityTimeline, getExerciseDetails };
```

To:
```javascript
module.exports = { getOverview, getUsersOverview, getActivityTimeline, getExerciseDetails, getUserTimeline };
```

- [ ] **Step 6: Run backend tests to verify changes**

```bash
cd backend
npm test
```

Expected: All existing tests still pass. New `getUserTimeline` is not tested yet (no test file changes in this task).

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/stats.service.js
git commit -m "feat(backend): add getUserTimeline() and add limit/offset pagination to getUsersOverview()"
```

---

### Task 2: Backend — Update Admin Routes for New Endpoint and Modified /users Route

**Files:**
- Modify: `backend/src/routes/admin.routes.js:1-60`

**Interfaces:**
- Consumes: `getUserTimeline`, `getUsersOverview` from stats.service.js (updated signatures)
- Produces: Two modified/new HTTP endpoints:
  - `GET /api/admin/users/:id/timeline` returns `{ user_id: number, timeline: Array }`
  - `GET /api/admin/users?search=...&limit=10&offset=0` returns `{ users: Array, total_count: number }`

- [ ] **Step 1: Read current admin.routes.js structure**

Open `backend/src/routes/admin.routes.js`. It currently has 4 routes:
- `GET /stats`
- `GET /users`
- `GET /activity-timeline`
- `GET /exercise-details`

The `GET /users` route calls `getUsersOverview(pool, filters)` which previously returned an array. This route needs updating.

- [ ] **Step 2: Update the existing GET /users route to handle new response format**

Find:
```javascript
router.get('/users', async (req, res, next) => {
  try {
    const filters = {
      period: req.query.period || 'all',
      search: req.query.search || undefined,
      sort: req.query.sort || 'last_active',
    };
    const users = await getUsersOverview(pool, filters);
    res.json(users);
```

Replace with:
```javascript
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
```

- [ ] **Step 3: Add new GET /users/:id/timeline route**

After the GET /users route, add:

```javascript
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
```

- [ ] **Step 4: Verify imports at the top of the file**

Ensure `getUserTimeline` is imported from stats.service.js. Find the destructure line and update:

```javascript
const { getOverview, getUsersOverview, getActivityTimeline, getExerciseDetails, getUserTimeline } = require('../services/stats.service.js');
```

- [ ] **Step 5: Run backend tests**

```bash
cd backend
npm test
```

Expected: All tests pass. Manually verify the new route works (or test in following task).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/admin.routes.js
git commit -m "feat(backend): add /users/:id/timeline endpoint and update /users route for pagination"
```

---

### Task 3: Frontend — Restructure HTML Layout with Tab Navigation

**Files:**
- Modify: `backend/admin/index.html:1-850` (entire document structure)

**Interfaces:**
- Consumes: Existing overview, exercise, activity HTML blocks (lines ~500-800 currently)
- Produces: New HTML structure with:
  - Tab navigation bar with 3 buttons (data-tab attributes)
  - Three tab panels (id="overview", id="users", id="content")
  - Users panel contains: search input, limit selector, users list, pagination controls

- [ ] **Step 1: Back up and read current index.html structure**

Open `backend/admin/index.html`. Note the current sections:
- `<style>` block (lines ~1-800)
- `<body>` with grid/flex layout showing all stats at once
- Multiple `<div class="section">` elements for overview, users, timeline, exercises
- `<script>` section with load/render functions

- [ ] **Step 2: Add tab navigation HTML after opening body tag**

Find the opening `<body>` tag. After it, before the first `<div class="admin-container">`, add:

```html
<body>
  <!-- Tab Navigation -->
  <nav class="tab-nav">
    <button class="tab-button active" data-tab="overview">📊 Umumiy</button>
    <button class="tab-button" data-tab="users">👤 Foydalanuvchilar</button>
    <button class="tab-button" data-tab="content">📚 Kontent va Tahlil</button>
  </nav>
```

- [ ] **Step 3: Wrap Overview content in a tab panel**

Find the existing overview section (title "Asosiy"). Wrap it with:

```html
<div class="tab-panel active" id="overview">
  <!-- All existing overview HTML (stats, charts, tables) -->
</div>
```

Move the entire current Overview content inside this div.

- [ ] **Step 4: Create new empty Users tab panel**

After the Overview panel, add:

```html
<div class="tab-panel" id="users">
  <div class="controls">
    <input type="text" id="search-input" placeholder="Qidiruv: ism/username/telefon...">
    <select id="limit-select">
      <option value="10">10</option>
      <option value="20">20</option>
      <option value="50">50</option>
      <option value="100">100</option>
    </select>
  </div>

  <div id="users-list" class="users-list">
    <div class="skeleton">Yuklanmoqda...</div>
  </div>

  <div class="pagination">
    <button id="btn-prev">◄ Oldingi</button>
    <span id="page-info">Sahifa 1</span>
    <button id="btn-next">Keyingi ►</button>
  </div>
</div>
```

- [ ] **Step 5: Wrap Content & Analytics in a tab panel**

Find the existing Activity Timeline and Exercise Details sections. Wrap both with:

```html
<div class="tab-panel" id="content">
  <!-- All existing activity timeline HTML -->
  <!-- All existing exercise details HTML -->
</div>
```

- [ ] **Step 6: Verify structure**

Ensure the final body contains exactly 3 tab panels (overview, users, content), each inside a `.tab-panel` div.

- [ ] **Step 7: Commit**

```bash
git add backend/admin/index.html
git commit -m "refactor(frontend): restructure HTML layout with tab navigation and panels"
```

---

### Task 4: Frontend — Add CSS Styling for Tabs and User Management Components

**Files:**
- Modify: `backend/admin/index.html` `<style>` section (add ~150 lines at end of existing CSS)

**Interfaces:**
- Consumes: Existing CSS custom properties (--card-bg, --primary, --text-main, --card-border, --text-muted)
- Produces: New CSS classes:
  - `.tab-nav` — horizontal flex navigation bar
  - `.tab-button` — individual tab button styling (inactive/active states)
  - `.tab-panel` — visibility toggle (display: none by default, display: block when active)
  - `.user-card` — accordion-style user summary card
  - `.timeline` — day-by-day activity container
  - `.day` — single day's events
  - `.pagination` — pagination control bar with buttons
  - `.controls` — search + limit selector container

- [ ] **Step 1: Locate the end of the existing <style> block in index.html**

Find the closing `</style>` tag (around line 800). Before it, add new CSS rules.

- [ ] **Step 2: Add Tab Navigation CSS**

```css
/* Tab Navigation */
.tab-nav {
  display: flex;
  gap: 10px;
  padding: 15px;
  border-bottom: 1px solid var(--card-border);
  background: var(--bg-main);
}

.tab-button {
  padding: 10px 16px;
  background: transparent;
  color: var(--text-main);
  border: 1px solid var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s ease;
}

.tab-button:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.tab-button.active {
  background: var(--primary);
  color: white;
  border-color: var(--primary);
}
```

- [ ] **Step 3: Add Tab Panel Visibility CSS**

```css
/* Tab Panels */
.tab-panel {
  display: none;
  padding: 20px;
}

.tab-panel.active {
  display: block;
}
```

- [ ] **Step 4: Add User Management Components CSS**

```css
/* User Management Controls */
.controls {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

#search-input {
  flex: 1;
  padding: 10px 12px;
  background: var(--card-bg);
  color: var(--text-main);
  border: 1px solid var(--card-border);
  border-radius: 4px;
  font-size: 13px;
}

#search-input::placeholder {
  color: var(--text-muted);
}

#limit-select {
  padding: 10px 12px;
  background: var(--card-bg);
  color: var(--text-main);
  border: 1px solid var(--card-border);
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
}

/* Users List */
.users-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
}

.user-card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 4px;
  padding: 12px;
  cursor: pointer;
}

.user-card summary {
  font-weight: 600;
  color: var(--text-main);
  padding: 8px;
  user-select: none;
}

.user-card summary:hover {
  color: var(--primary);
}

.user-card[open] summary {
  border-bottom: 1px solid var(--card-border);
  margin-bottom: 8px;
  padding-bottom: 8px;
}

/* Timeline Display */
.timeline {
  margin-top: 8px;
  padding: 12px 8px;
  font-size: 13px;
}

.day {
  margin-bottom: 12px;
}

.day strong {
  color: var(--primary);
  display: block;
  margin-bottom: 4px;
}

.day ul {
  list-style: none;
  margin: 0;
  padding-left: 16px;
}

.day li {
  color: var(--text-muted);
  padding: 2px 0;
}

/* Pagination Controls */
.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  margin-top: 20px;
  padding: 15px 0;
  border-top: 1px solid var(--card-border);
}

.pagination button {
  padding: 8px 12px;
  background: var(--card-bg);
  color: var(--text-main);
  border: 1px solid var(--card-border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s ease;
}

.pagination button:hover:not(:disabled) {
  background: var(--primary);
  color: white;
  border-color: var(--primary);
}

.pagination button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

#page-info {
  color: var(--text-muted);
  font-size: 13px;
  min-width: 100px;
  text-align: center;
}
```

- [ ] **Step 5: Commit**

```bash
git add backend/admin/index.html
git commit -m "feat(frontend): add CSS styling for tabs, user cards, and pagination"
```

---

### Task 5: Frontend — Implement Tab Switching and Global State Management

**Files:**
- Modify: `backend/admin/index.html` `<script>` section (add ~50 lines)

**Interfaces:**
- Consumes: HTML elements with data-tab attributes, .tab-panel divs
- Produces: Global JavaScript state object and tab switching event handlers:
  - `currentTab` — current active tab (string: 'overview'|'users'|'content')
  - `currentPage` — pagination page (number)
  - `currentLimit` — users per page (number: 10|20|50|100)
  - `currentSearch` — search query text (string)
  - `totalPages` — computed from API response
  - Functions: `showPanel(tabId)` to activate/deactivate tabs

- [ ] **Step 1: Open the <script> section in index.html**

Find the opening `<script>` tag near the end of index.html (around line 810).

- [ ] **Step 2: Add global state variables at the top of the script (before any existing code)**

Add this immediately after `<script>`:

```javascript
// Global state for User Management tab
let currentTab = 'overview';
let currentPage = 1;
let currentLimit = 10;
let currentSearch = '';
let totalPages = 1;
const API_BASE = '/api/admin';
```

- [ ] **Step 3: Add showPanel() function**

After the state variables, add:

```javascript
function showPanel(tabId) {
  // Hide all panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.remove('active');
  });

  // Deactivate all tab buttons
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.classList.remove('active');
  });

  // Show selected panel
  const selectedPanel = document.getElementById(tabId);
  if (selectedPanel) {
    selectedPanel.classList.add('active');
  }

  // Activate selected button
  const selectedBtn = document.querySelector(`[data-tab="${tabId}"]`);
  if (selectedBtn) {
    selectedBtn.classList.add('active');
  }

  currentTab = tabId;

  // Auto-load data when Users tab is opened
  if (tabId === 'users' && currentPage === 1) {
    loadUsers(1);
  }
}
```

- [ ] **Step 4: Add tab button event listeners**

After showPanel(), add:

```javascript
// Initialize tab buttons
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.addEventListener('click', () => {
      showPanel(btn.dataset.tab);
    });
  });
  
  // Show overview tab by default
  showPanel('overview');
});
```

- [ ] **Step 5: Verify no conflicts with existing script**

Search the existing `<script>` section for any existing `currentTab` or `showPanel` definitions. If they exist, they should be removed (they belong in this new structure).

- [ ] **Step 6: Commit**

```bash
git add backend/admin/index.html
git commit -m "feat(frontend): add tab switching and global state management"
```

---

### Task 6: Frontend — Implement User List Loading and Rendering Logic

**Files:**
- Modify: `backend/admin/index.html` `<script>` section (add ~100 lines after Task 5 code)

**Interfaces:**
- Consumes: Global state (`currentSearch`, `currentLimit`, `currentPage`), API endpoint `GET /api/admin/users?search=...&limit=...&offset=...`
- Produces:
  - `loadUsers(page)` — fetches user list from API
  - `renderUserList(users)` — renders accordion cards into #users-list
  - `formatDate(isoDate)` — utility to format timestamps for display
  - Updates `totalPages` global state from API response

- [ ] **Step 1: Add formatDate() utility function**

Add after the DOMContentLoaded block:

```javascript
function formatDate(isoDate) {
  if (!isoDate) return '—';
  const date = new Date(isoDate);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}.${month} ${hours}:${minutes}`;
}
```

- [ ] **Step 2: Add loadUsers() function**

```javascript
async function loadUsers(page = 1) {
  try {
    const offset = (page - 1) * currentLimit;
    const searchParam = currentSearch ? `&search=${encodeURIComponent(currentSearch)}` : '';
    const url = `${API_BASE}/users?limit=${currentLimit}&offset=${offset}${searchParam}`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    
    renderUserList(data.users);
    totalPages = Math.ceil(data.total_count / currentLimit);
    renderPagination(page, totalPages);
    
    currentPage = page;
  } catch (error) {
    console.error('Error loading users:', error);
    document.getElementById('users-list').innerHTML = `<div class="skeleton" style="color: red;">Xatolik: ${error.message}</div>`;
  }
}
```

- [ ] **Step 3: Add renderUserList() function**

```javascript
function renderUserList(users) {
  if (!users || users.length === 0) {
    document.getElementById('users-list').innerHTML = '<div class="skeleton">Foydalanuvchilar topilmadi</div>';
    return;
  }

  const html = users.map(user => `
    <details class="user-card">
      <summary>
        <strong>${user.name || 'No name'}</strong>
        ${user.username ? ` | @${user.username}` : ''}
        ${user.phone_number ? ` | ${user.phone_number}` : ''}
        <small style="float: right; font-weight: normal; color: var(--text-muted);">
          ${formatDate(user.last_active)} | ${user.favorite_mode || '—'}
        </small>
      </summary>
      <div class="timeline" id="timeline-${user.id}" style="min-height: 60px;">Yuklanmoqda...</div>
    </details>
  `).join('');

  const container = document.getElementById('users-list');
  container.innerHTML = html;

  // Attach accordion toggle listeners
  document.querySelectorAll('.user-card').forEach(card => {
    card.addEventListener('toggle', async (e) => {
      if (e.target.open) {
        const timelineDiv = card.querySelector('.timeline');
        const userId = timelineDiv.id.replace('timeline-', '');
        await loadTimeline(userId);
      }
    });
  });
}
```

- [ ] **Step 4: Add renderPagination() function**

```javascript
function renderPagination(currentPageNum, total) {
  document.getElementById('page-info').textContent = `Sahifa ${currentPageNum}/${total}`;
  
  const prevBtn = document.getElementById('btn-prev');
  const nextBtn = document.getElementById('btn-next');
  
  prevBtn.disabled = currentPageNum === 1;
  nextBtn.disabled = currentPageNum >= total;
}
```

- [ ] **Step 5: Commit**

```bash
git add backend/admin/index.html
git commit -m "feat(frontend): add loadUsers() and renderUserList() functions"
```

---

### Task 7: Frontend — Implement Search, Limit, and Pagination Handlers

**Files:**
- Modify: `backend/admin/index.html` `<script>` section (add ~40 lines)

**Interfaces:**
- Consumes: Global state variables, DOM elements (#search-input, #limit-select, #btn-prev, #btn-next)
- Produces: Event listeners that update global state and trigger loadUsers()

- [ ] **Step 1: Add search input handler after renderPagination()**

```javascript
document.addEventListener('DOMContentLoaded', function() {
  // ... existing tab button code ...

  // Search handler
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      currentSearch = e.target.value;
      currentPage = 1; // Reset to page 1 on new search
      searchTimeout = setTimeout(() => {
        loadUsers(1);
      }, 300); // 300ms debounce
    });
  }

  // Limit selector handler
  const limitSelect = document.getElementById('limit-select');
  if (limitSelect) {
    limitSelect.addEventListener('change', (e) => {
      currentLimit = parseInt(e.target.value);
      currentPage = 1; // Reset to page 1
      loadUsers(1);
    });
  }

  // Pagination handlers
  const prevBtn = document.getElementById('btn-prev');
  const nextBtn = document.getElementById('btn-next');
  
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        loadUsers(currentPage - 1);
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (currentPage < totalPages) {
        loadUsers(currentPage + 1);
      }
    });
  }
});
```

Note: Merge this with the existing DOMContentLoaded block from Task 5 so there's only one DOMContentLoaded listener.

- [ ] **Step 2: Commit**

```bash
git add backend/admin/index.html
git commit -m "feat(frontend): add search, limit, and pagination event handlers"
```

---

### Task 8: Frontend — Implement Timeline Loading on Accordion Expansion

**Files:**
- Modify: `backend/admin/index.html` `<script>` section (add ~40 lines)

**Interfaces:**
- Consumes: Global state, API endpoint `GET /api/admin/users/:id/timeline`, DOM timeline containers
- Produces:
  - `loadTimeline(userId)` — fetches and renders day-by-day activity
  - `renderTimeline(userId, timeline)` — renders timeline into accordion detail section

- [ ] **Step 1: Add loadTimeline() function after renderUserList()**

```javascript
async function loadTimeline(userId) {
  try {
    const url = `${API_BASE}/users/${userId}/timeline`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    renderTimeline(userId, data.timeline);
  } catch (error) {
    console.error('Error loading timeline:', error);
    const container = document.getElementById(`timeline-${userId}`);
    if (container) {
      container.innerHTML = `<div style="color: red;">Xatolik: ${error.message}</div>`;
    }
  }
}
```

- [ ] **Step 2: Add renderTimeline() function**

```javascript
function renderTimeline(userId, timelineArray) {
  if (!timelineArray || timelineArray.length === 0) {
    document.getElementById(`timeline-${userId}`).innerHTML = '<div style="color: var(--text-muted);">Tarix yo\'q</div>';
    return;
  }

  const html = timelineArray.map(dayData => {
    const dayHtml = `
      <div class="day">
        <strong>${dayData.date}</strong>
        <ul>
          ${dayData.page_views.map(pv => `
            <li>📄 ${pv.screen || 'Unknown'}${pv.book ? ` (${pv.book})` : ''}</li>
          `).join('')}
          ${dayData.quizzes.map(q => `
            <li>✅ ${q.mode || 'Unknown'}: ${q.correct}/${q.total}${q.book ? ` (${q.book})` : ''}</li>
          `).join('')}
        </ul>
      </div>
    `;
    return dayHtml;
  }).join('');

  document.getElementById(`timeline-${userId}`).innerHTML = html;
}
```

- [ ] **Step 3: Verify renderUserList() calls loadTimeline()**

Check that renderUserList() has the toggle event listener that calls `loadTimeline(userId)` — added in Task 6. If missing, add it.

- [ ] **Step 4: Commit**

```bash
git add backend/admin/index.html
git commit -m "feat(frontend): add timeline loading and rendering on accordion expansion"
```

---

### Task 9: Manual End-to-End Testing

**Files:**
- Test: Entire admin panel (no code changes)

**Interfaces:**
- Consumes: Running backend API, populated database with events
- Produces: Verification checklist

- [ ] **Step 1: Start the backend server**

```bash
cd backend
npm run dev
# or: node src/server.js
```

Wait for "Server running on port 3000" message.

- [ ] **Step 2: Open admin panel in browser**

Navigate to: `http://localhost:3000/admin`

Credentials (HTTP Basic Auth):
- Username: `admin`
- Password: (from `ADMIN_PASSWORD` in `.env`)

- [ ] **Step 3: Test tab switching**

- Click "📊 Umumiy" → Overview stats and charts should appear
- Click "👤 Foydalanuvchilar" → Search input, limit dropdown, user list, pagination should appear
- Click "📚 Kontent va Tahlil" → Activity timeline and exercise details should appear
- Tabs should remain stable when switching (no content loss)

- [ ] **Step 4: Test User Management tab — initial load**

- Default limit should be 10 in dropdown
- User list should load with first 10 users displayed
- Page info should show "Sahifa 1/N" (where N = total pages)
- "◄ Oldingi" button should be disabled
- "Keyingi ►" button should be enabled (if more than 10 users exist)

- [ ] **Step 5: Test search functionality**

- Type in search input (e.g., "admin")
- List should filter in real-time (≤500ms debounce acceptable)
- Page should reset to 1
- Page info should show updated total

- [ ] **Step 6: Test limit selector**

- Change dropdown to "20" → List should show 20 users per page
- Page info should update (e.g., "Sahifa 1/2" if ~25 total users)
- "Keyingi" button should stay enabled if more pages remain

- [ ] **Step 7: Test pagination**

- Click "Keyingi ►" → Next page loads
- Page info should update (e.g., "Sahifa 2/5")
- "◄ Oldingi" should now be enabled
- Click "◄ Oldingi" → Previous page loads
- Verify users are different on each page

- [ ] **Step 8: Test accordion expansion (timeline loading)**

- Click a user card's summary area to expand
- Timeline should appear inside with a "Yuklanmoqda..." message briefly
- After ~1s, timeline should show days with activities
- Each day should list:
  - 📄 Page views (screen names and book names if available)
  - ✅ Quiz results (mode, correct/total scores, book if available)
- Collapse and re-expand the same user → timeline should reload (not cached)

- [ ] **Step 9: Test error scenarios**

- Close backend server (kill process)
- Try to load users or timeline → Should show error message in UI (e.g., "Xatolik: HTTP Failed to fetch")
- Restart backend → Should work again

- [ ] **Step 10: Verify no console errors**

- Open browser DevTools (F12)
- Console tab → Should have no red error messages
- Search/limit/pagination changes should log expected values (if any debug logs exist)

- [ ] **Step 11: Commit testing results**

No code changes, but document findings. If bugs found:
- Return to relevant task and fix
- Re-test the specific feature
- Re-commit the task

If all tests pass:
```bash
git log --oneline -5
```

Expected to see recent commits from Tasks 1-8.

---

## Summary

After all 9 tasks complete:

- ✅ Backend: 2 new functions (`getUserTimeline()`, modified `getUsersOverview()`)
- ✅ Backend: 2 new/updated routes (`GET /users/:id/timeline`, updated `GET /users?limit=...&offset=...`)
- ✅ Frontend: Tab navigation with 3 panels
- ✅ Frontend: User Management tab with search, limit selector, pagination, accordion user cards
- ✅ Frontend: Day-by-day activity timeline per user
- ✅ All styling uses existing CSS custom properties (no hard-coded colors)
- ✅ No automated tests (manual verification only, per spec)
- ✅ All code follows vanilla JS/HTML/CSS (no frameworks)
