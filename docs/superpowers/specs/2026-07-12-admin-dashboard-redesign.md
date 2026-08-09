# Admin Dashboard Redesign — Dizayn

**Sana:** 2026-07-12
**Holat:** Tasdiqlangan (brainstorming bosqichi yakunlandi)

## Muammo

Hozirgi admin panel (`backend/admin/index.html`) — bitta uzun sahifa, barcha ma'lumotlar (overview, users, timeline, exercises) bir vaqtda scroll qilish orqali ko'rsatiladi. Bu:
1. Foydalanuvchilar ro'yxati qidirilishi/saralashi qiyin
2. Har bir foydalanuvchi uchun kun-ba-kun tarix yo'q (faqat umumiy statistika bor)
3. Pagination yo'q — barcha foydalanuvchilar bir yo'la yuklandi (performance muammosi katta deployda)

## Maqsad

Admin panelni tab-asosida qayta tuzish:
- **Tab 1 (Umumiy):** Mavjud overview (kunlik/haftalik active users, trending screens/books, exercise stats) — o'zgarmaydi
- **Tab 2 (Foydalanuvchilar):** Yangi user management interface — qidiruv, limit selector, pagination, har bir user uchun accordion asosida kun-ba-kun tarix
- **Tab 3 (Kontent va Tahlil):** Mavjud exercise details + activity timeline — o'zgarmaydi

## Qamrov

**Kiritiladi:**
- Tab switching UI (tepada 3 tugma)
- User Management tab: qidiruv + limit selector + accordion-based user cards + day-by-day timeline + pagination
- Backend endpoint: `GET /api/admin/users/:id/timeline` (bitta foydalanuvchining kun bo'yicha grouped events)
- Backend modifier: `GET /api/admin/users?limit=X&offset=Y` (hozir limit/offset kerak emas, penambahan)

**Qamrovga kirmaydi:**
- Tab 1/3 ning ichidagi logic/styling — mavjud code saqlanadi
- Admin panel uchun yangi CSS framework — Vanilla + mavjud dark theme tokenlar
- User activity exporti yoki filtering dan ko'p (faqat qidiruv + limit)

## Arxitektura

### Frontend (`backend/admin/index.html` + inline `<script>`)

```
┌─────────────────────────────────────────────────────┐
│ Tab Navigation (3 buttons):                         │
│ [📊 Umumiy] [👤 Foydalanuvchilar] [📚 Kontent]      │
└─────────────────────────────────────────────────────┘

Tab Panel 1 (Umumiy):
├─ Overview stats (mavjud code)
├─ Bar charts: top_screens, top_books
└─ Exercise details table

Tab Panel 2 (Foydalanuvchilar): ← YANGI
├─ Search bar + Limit selector (10/20/50/100)
├─ User list (accordion cards):
│  ├─ Summary row: name, username, phone, last_active, favorite_mode
│  └─ Details (ochilganda): Timeline (date → pages + quizzes)
└─ Pagination: [◄ Oldingi] [Sahifa 1/5] [Keyingi ►]

Tab Panel 3 (Kontent va Tahlil):
├─ Activity timeline (week/month/today)
└─ Exercise modes ranking (mavjud code)
```

### Backend (`backend/src/services/stats.service.js` + `backend/src/routes/admin.routes.js`)

**Yangi servis funksiyasi:**
```javascript
async function getUserTimeline(pool, userId) {
  // SELECT * FROM events WHERE user_id = $1 ORDER BY occurred_at DESC
  // Group by date (kun aniqligida)
  // Return: [
  //   { date: "2026-07-12", page_views: [...], quizzes: [...] },
  //   { date: "2026-07-11", ... }
  // ]
}
```

**Yangi route:**
```
GET /api/admin/users/:id/timeline
Response: { user_id, timeline: [ ... ] }
```

**Modifier (existing GET /api/admin/users):**
- Add `limit` query param (default 10)
- Add `offset` query param (default 0)
- Implement LIMIT/OFFSET in SQL query
- Return: { users: [...], total_count: 12345 } (pagination uchun)

---

## Frontend Tafsili

### HTML Struktura

```html
<div class="admin-container">
  <!-- Tab Navigation -->
  <nav class="tab-nav">
    <button class="tab-button active" data-tab="overview">📊 Umumiy</button>
    <button class="tab-button" data-tab="users">👤 Foydalanuvchilar</button>
    <button class="tab-button" data-tab="content">📚 Kontent va Tahlil</button>
  </nav>

  <!-- Tab Panels -->
  <div class="tab-panel active" id="overview">
    <!-- Mavjud overview content -->
  </div>

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
      <!-- Accordion cards dinamik qo'shiladi -->
    </div>

    <div class="pagination">
      <button id="btn-prev">◄ Oldingi</button>
      <span id="page-info">Sahifa 1</span>
      <button id="btn-next">Keyingi ►</button>
    </div>
  </div>

  <div class="tab-panel" id="content">
    <!-- Mavjud content analytics -->
  </div>
</div>
```

### JavaScript Logic (pseudocode)

```javascript
// Global state
let currentTab = 'overview';
let currentPage = 1;
let currentLimit = 10;
let currentSearch = '';

// Tab switching
document.querySelectorAll('.tab-button').forEach(btn => {
  btn.addEventListener('click', () => {
    currentTab = btn.dataset.tab;
    showPanel(currentTab);
  });
});

// User Management tab logic
async function loadUsers(page = 1) {
  const offset = (page - 1) * currentLimit;
  const res = await fetch(`/api/admin/users?search=${currentSearch}&limit=${currentLimit}&offset=${offset}`);
  const data = await res.json();
  
  renderUserList(data.users);
  renderPagination(page, Math.ceil(data.total_count / currentLimit));
}

function renderUserList(users) {
  const html = users.map(user => `
    <details class="user-card">
      <summary>
        <strong>${user.name}</strong> | @${user.username} | ${user.phone_number || '—'}
        <small>${formatDate(user.last_active)}</small> | 
        <span class="mode-badge">${user.favorite_mode || '—'}</span>
      </summary>
      <div class="timeline" id="timeline-${user.id}">Yuklanmoqda...</div>
    </details>
  `).join('');
  
  document.getElementById('users-list').innerHTML = html;
  
  // Timeline loading trigger
  document.querySelectorAll('.user-card').forEach(card => {
    card.addEventListener('toggle', async (e) => {
      if (e.target.open) {
        const userId = e.target.querySelector('.timeline').id.replace('timeline-', '');
        const timeline = await fetch(`/api/admin/users/${userId}/timeline`).then(r => r.json());
        renderTimeline(userId, timeline.timeline);
      }
    });
  });
}

function renderTimeline(userId, days) {
  const html = days.map(day => `
    <div class="day">
      <strong>${day.date}</strong>
      <ul>
        ${day.page_views.map(pv => `<li>📄 ${pv.screen}</li>`).join('')}
        ${day.quizzes.map(q => `<li>✅ ${q.mode}: ${q.correct}/${q.total}</li>`).join('')}
      </ul>
    </div>
  `).join('');
  
  document.getElementById(`timeline-${userId}`).innerHTML = html;
}

// Search/Limit/Pagination handlers
document.getElementById('search-input').addEventListener('input', (e) => {
  currentSearch = e.target.value;
  currentPage = 1;
  loadUsers(1);
});

document.getElementById('limit-select').addEventListener('change', (e) => {
  currentLimit = parseInt(e.target.value);
  currentPage = 1;
  loadUsers(1);
});

// Track total pages for boundary check
let totalPages = 1;

document.getElementById('btn-next').addEventListener('click', () => {
  if (currentPage < totalPages) {
    currentPage++;
    loadUsers(currentPage);
  }
});

document.getElementById('btn-prev').addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage--;
    loadUsers(currentPage);
  }
});
```

---

## Backend Tafsili

### `getUserTimeline(pool, userId)` funksiyasi

**SQL Strategy:**
```sql
SELECT 
  date_trunc('day', occurred_at AT TIME ZONE 'Asia/Tashkent') AS day,
  type,
  payload
FROM events
WHERE user_id = $1
ORDER BY occurred_at DESC
```

**Aggregation (JavaScript-da):**
Group events by day, har bir kunni `page_views` va `quizzes` qo'llariga bo'lib chiqarish.

**Return format:**
```javascript
[
  {
    date: "2026-07-12",
    page_views: [
      { screen: "book-screen", book: "Essential 1" },
      { screen: "settings-screen" }
    ],
    quizzes: [
      { mode: "Eshitib yig'ish", correct: 8, total: 10, book: "Essential 1" }
    ]
  },
  { date: "2026-07-11", ... }
]
```

### `GET /api/admin/users?search=...&limit=10&offset=0` Modifier

**Current:** Barcha foydalanuvchilarni qaytaradi (LIMIT/OFFSET yo'q).

**Change:**
```javascript
router.get('/users', async (req, res, next) => {
  try {
    const filters = {
      period: req.query.period || 'all',
      search: req.query.search || undefined,
      sort: req.query.sort || 'last_active',
      limit: parseInt(req.query.limit) || 10,
      offset: parseInt(req.query.offset) || 0
    };
    const result = await getUsersOverview(pool, filters);
    res.json(result); // { users: [...], total_count: 12345 }
  } catch (error) {
    next(error);
  }
});
```

**`getUsersOverview` signature change:**
- Input: `filters` object (adds `limit`, `offset`)
- Output: `{ users: [...], total_count: number }` (vaqtincha `{ count: number }` qo'shiladi)

---

## CSS Styling

**Minimal — mavjud tokenlarni ishlatish:**
```css
.tab-nav {
  display: flex;
  gap: 10px;
  padding: 15px 0;
  border-bottom: 1px solid var(--card-border);
}

.tab-button {
  padding: 8px 16px;
  background: transparent;
  color: var(--text-main);
  border: 1px solid var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
}

.tab-button.active {
  background: var(--primary);
  color: white;
  border-color: var(--primary);
}

.tab-panel {
  display: none;
}

.tab-panel.active {
  display: block;
}

.user-card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 4px;
  padding: 12px;
  margin-bottom: 8px;
  cursor: pointer;
}

.user-card summary {
  font-weight: 600;
  padding: 8px;
}

.user-card[open] summary {
  border-bottom: 1px solid var(--card-border);
  margin-bottom: 8px;
}

.timeline {
  margin-top: 8px;
  font-size: 13px;
}

.day {
  margin-bottom: 12px;
}

.day strong {
  color: var(--primary);
}

.day ul {
  list-style: none;
  margin: 4px 0 0 0;
  padding-left: 16px;
  color: var(--text-muted);
}

.pagination {
  margin-top: 20px;
  text-align: center;
  display: flex;
  justify-content: center;
  gap: 10px;
}

.pagination button {
  padding: 8px 12px;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  color: var(--text-main);
  cursor: pointer;
  border-radius: 4px;
}

.pagination button:hover {
  background: var(--primary);
  color: white;
}
```

---

## Testlash yondashuvi

**Frontend (qo'lda):**
- Tab switching: Har bir tugma bosilganda to'g'ri panel ko'rsatiladi
- Search: Input'ga yozsak, ro'yxat filtirlanadi (500ms debounce tavsiya etiladi)
- Limit selector: 10/20/50 tanlab, to'g'ri sonli foydalanuvchi ko'rsatiladi
- Accordion: User kartasini bosganda, timeline osiladi va kun-ba-kun ma'lumot ko'rsatiladi
- Pagination: "Keyingi" bosilganda offset o'zgaradi, yangi ro'yxat yuklandi

**Backend (unit/integration test):**
- `getUserTimeline(pool, userId)`: bitta foydalanuvchining events'lari kunlar bo'yicha to'g'ri grupirlandi
- `GET /api/admin/users?limit=10&offset=0`: LIMIT/OFFSET SQL'da to'g'ri ishlatiladi, `total_count` to'g'ri qaytariladi

---

## Nima o'zgarmaydi

- Tab 1/3 ning mavjud kodi va styling — o'zgarmaydi
- Backend uchun boshqa endpoint'lar (`/stats`, `/exercise-details`, `/activity-timeline`) — o'zgarmaydi
- Frontend'dagi boshqa component'lar — o'zgarmaydi
- Admin panel authentication (Basic Auth) — o'zgarmaydi
