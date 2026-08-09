# "Asosiy" va "Mashqlar" Ekranlarini Qayta Loyihalash — Amalga Oshirish Rejasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the static "Asosiy" (Home) welcome card into a returning-user dashboard (daily streak, total words learned, one-tap "Davom ettirish" continue button) and reduce visual clutter on the "Mashqlar" (practice setup) screen with a sticky selection summary bar and a collapsed advanced-settings section.

**Architecture:** Pure frontend changes to the existing vanilla JS/HTML/CSS app (`index.html`, `app.js`, `styles.css`) — no backend or build-step changes. New persistent state (daily streak, total words) is stored in `localStorage`, following the exact pattern the codebase already uses for `vocab_selected_books`/`vocab_mode`/etc.

**Tech Stack:** Vanilla JavaScript, HTML, CSS (no framework, no build step — matches the existing codebase exactly).

**Reference spec:** `docs/superpowers/specs/2026-07-11-home-and-mashqlar-redesign.md`

## Global Constraints

- No backend changes — `events.payload` is JSONB and already accepts any `type`/`payload` shape (Task 4 of the backend plan added `type` non-empty-string + 100-event-cap validation only, no field allow-list).
- No new dependencies, no build step — plain `<script>`/`<style>` additions matching the existing codebase.
- Screen IDs (`welcome-screen`, `setup-screen`, etc.) and the bottom-nav tab count/order do not change — only content *inside* `welcome-screen` and `setup-screen` changes.
- The existing per-quiz `state.streak`/`state.maxStreak` (consecutive correct answers within one quiz) must not be confused with or reused for the new daily streak — the daily streak is a separate, `localStorage`-backed concept.
- No automated frontend test framework exists in this project (confirmed during the backend integration task) and none is introduced here — verification is manual, following the same pattern used for `tracking.js`.
- Follow existing code conventions exactly: `localStorage` keys use the `vocab_` prefix (e.g. `vocab_selected_books`), CSS uses the existing custom-property design tokens (`--card-bg`, `--text-main`, `--primary`, `--text-muted`, `--card-border`), and new buttons reuse the existing `.btn-action`/`.btn-action-pulse` classes rather than inventing new ones.

**Deviation from spec, discovered during planning:** the spec's "Mashq turlari — vizual tozalash" item called for strengthening the selected-mode highlight (`styles.css:806-811`, `.choice-chip.selected`). Inspection during planning found this already has a solid, distinct style (primary-color background, border, glow shadow) — there is no actual visual gap to fix. No task in this plan touches mode-chip selection styling; the real fix for "12 turi bir vaqtda tashlanadi" is the reduced surrounding clutter from Tasks 3–4 (sticky summary bar + collapsed advanced settings), which make the existing, already-clear mode grid feel less crowded without changing the grid itself.

---

## Task 1: Daily streak & total-words-learned persistence logic

**Files:**
- Modify: `app.js:25130-25193` (add new functions after `saveSettings()`/`loadSettings()`)
- Modify: `app.js:27980-27993` (`finishQuiz()` — hook in the new persistence calls)

**Interfaces:**
- Consumes: nothing new (uses the existing global `state.correctCount`).
- Produces: `recordDailyActivity()` — no args, no return, updates `localStorage["vocab_daily_streak_count"]` and `localStorage["vocab_last_active_date"]`. `addToTotalWordsLearned(count)` — increments `localStorage["vocab_total_correct_answers"]` by `count`. `getDailyStreak()` → number. `getTotalWordsLearned()` → number. `hasCompletedAnyQuiz()` → boolean (true once `vocab_total_correct_answers` has ever been set). These four getter/checker functions are consumed by Task 2.

- [ ] **Step 1: Add the four new functions**

In `app.js`, find this exact block (the end of `loadSettings()`):

```js
  } catch (err) {
    console.error("Local storage loaded values corrupted. Resetting...", err);
    state.selectedBooks = ["Essential 1"];
    state.selectedUnits = ["Essential 1|||Unit 1"];
    state.direction = "en-uz";
    state.mode = "multiple";
    state.limit = 20;
    renderActiveBookPanel();
    syncSetupScreenUI();
  }
}
```

Immediately after the closing `}` of `loadSettings()`, insert:

```js

// 6b. Daily Streak & Lifetime Word Count (localStorage-backed, independent of in-quiz state.streak)
function recordDailyActivity() {
  const today = new Date().toISOString().slice(0, 10);
  const lastActiveDate = localStorage.getItem("vocab_last_active_date");

  if (lastActiveDate === today) {
    return;
  }

  let streak = parseInt(localStorage.getItem("vocab_daily_streak_count") || "0", 10);

  if (lastActiveDate) {
    const lastDate = new Date(lastActiveDate + "T00:00:00");
    const todayDate = new Date(today + "T00:00:00");
    const dayDiff = Math.round((todayDate - lastDate) / (1000 * 60 * 60 * 24));

    streak = dayDiff === 1 ? streak + 1 : 1;
  } else {
    streak = 1;
  }

  localStorage.setItem("vocab_daily_streak_count", streak.toString());
  localStorage.setItem("vocab_last_active_date", today);
}

function addToTotalWordsLearned(count) {
  if (!count || count <= 0) return;
  const total = parseInt(localStorage.getItem("vocab_total_correct_answers") || "0", 10);
  localStorage.setItem("vocab_total_correct_answers", (total + count).toString());
}

function getDailyStreak() {
  return parseInt(localStorage.getItem("vocab_daily_streak_count") || "0", 10);
}

function getTotalWordsLearned() {
  return parseInt(localStorage.getItem("vocab_total_correct_answers") || "0", 10);
}

function hasCompletedAnyQuiz() {
  return localStorage.getItem("vocab_total_correct_answers") !== null;
}
```

- [ ] **Step 2: Hook the new functions into `finishQuiz()`**

Find this exact block in `app.js`:

```js
  // Clear active questions pool since it is completed
  state.questions = [];

  if (window.trackEvent) {
    window.trackEvent("quiz_result", {
```

Replace it with:

```js
  // Clear active questions pool since it is completed
  state.questions = [];

  recordDailyActivity();
  addToTotalWordsLearned(state.correctCount);

  if (window.trackEvent) {
    window.trackEvent("quiz_result", {
```

- [ ] **Step 3: Manually verify in a browser**

There is no automated test runner for this file. Serve the project locally and verify via DevTools console:

```bash
cd /Users/macbookair/Documents/elmurod_projects/essential
npx --yes serve . -l 8080
```

Open `http://localhost:8080/` in a browser, open DevTools Console, and run:

```js
localStorage.clear();
console.log(hasCompletedAnyQuiz()); // expect: false
recordDailyActivity();
addToTotalWordsLearned(12);
console.log(getDailyStreak());        // expect: 1
console.log(getTotalWordsLearned());  // expect: 12
console.log(hasCompletedAnyQuiz());   // expect: true

// Simulate "yesterday" to verify streak increments on a consecutive day
localStorage.setItem("vocab_last_active_date", "2026-07-10");
recordDailyActivity();
console.log(getDailyStreak()); // expect: 2 (if today is 2026-07-11; adjust the date above to yesterday's real date)

// Simulate a skipped day to verify streak resets
localStorage.setItem("vocab_last_active_date", "2020-01-01");
recordDailyActivity();
console.log(getDailyStreak()); // expect: 1
```

Expected: all `console.log` outputs match the comments above. Then play one real quiz to completion (any book/unit/mode) and confirm `localStorage.getItem("vocab_total_correct_answers")` increased by that quiz's correct-answer count.

- [ ] **Step 4: Commit**

```bash
cd /Users/macbookair/Documents/elmurod_projects/essential
git add app.js
git commit -m "feat: add daily streak and lifetime word-count tracking to localStorage"
```

---

## Task 2: "Asosiy" (Home) dashboard UI

**Files:**
- Modify: `index.html:30-68` (`welcome-screen` — split into a first-time block and a new dashboard block)
- Modify: `app.js:24549-24593` (`showScreen()` — refresh the dashboard when Home is shown)
- Modify: `app.js:28664-28672` (`DOMContentLoaded` handler — wire up the dashboard once on load)

**Interfaces:**
- Consumes: `hasCompletedAnyQuiz()`, `getDailyStreak()`, `getTotalWordsLearned()` from Task 1; `startQuiz(mistakesOnly)` (existing, `app.js:25504`); `window.trackEvent` (existing, from `tracking.js`).
- Produces: `renderHomeDashboard()` — no args, no return, toggles which of the two `welcome-screen` blocks is visible and fills in the streak/total values. `initHomeDashboard()` — no args, called once on `DOMContentLoaded`, wires the continue button's click handler and calls `renderHomeDashboard()` once.

- [ ] **Step 1: Split `welcome-screen` into two blocks**

In `index.html`, find this exact block:

```html
            <section id="welcome-screen" class="view-screen active">
                <!-- Welcome & Guide Panel -->
                <div class="welcome-card hero-formula-card">
                    <div class="welcome-badge-wrapper">
                        <span class="welcome-badge">SuperVocab 🎯</span>
                    </div>
                    
                    <div class="formula-container">
                        <div class="formula-label">Muvaffaqiyat formulasi oddiy:</div>
                        <div class="formula-steps">
                            <div class="formula-step step-1">
                                <span class="step-bullet">1</span>
                                <span class="step-phrase">Har kuni.</span>
                            </div>
                            <div class="formula-step step-2">
                                <span class="step-bullet">2</span>
                                <span class="step-phrase">Oz-ozdan.</span>
                            </div>
                            <div class="formula-step step-3">
                                <span class="step-bullet">3</span>
                                <span class="step-phrase">To'xtamasdan.</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Menu pointer pointing to the navigation menus at the bottom -->
                <div class="menu-pointer-container">
                    <div class="pointer-text">Boshlash uchun pastdagi bo'limlardan birini tanlang</div>
                    <div class="pointer-arrows">
                        <svg class="pointer-chevron" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                        <svg class="pointer-chevron delay-1" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </div>
                </div>
            </section>
```

Replace it with:

```html
            <section id="welcome-screen" class="view-screen active">
                <div id="welcome-first-time">
                    <!-- Welcome & Guide Panel -->
                    <div class="welcome-card hero-formula-card">
                        <div class="welcome-badge-wrapper">
                            <span class="welcome-badge">SuperVocab 🎯</span>
                        </div>

                        <div class="formula-container">
                            <div class="formula-label">Muvaffaqiyat formulasi oddiy:</div>
                            <div class="formula-steps">
                                <div class="formula-step step-1">
                                    <span class="step-bullet">1</span>
                                    <span class="step-phrase">Har kuni.</span>
                                </div>
                                <div class="formula-step step-2">
                                    <span class="step-bullet">2</span>
                                    <span class="step-phrase">Oz-ozdan.</span>
                                </div>
                                <div class="formula-step step-3">
                                    <span class="step-bullet">3</span>
                                    <span class="step-phrase">To'xtamasdan.</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Menu pointer pointing to the navigation menus at the bottom -->
                    <div class="menu-pointer-container">
                        <div class="pointer-text">Boshlash uchun pastdagi bo'limlardan birini tanlang</div>
                        <div class="pointer-arrows">
                            <svg class="pointer-chevron" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                            <svg class="pointer-chevron delay-1" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                        </div>
                    </div>
                </div>

                <div id="welcome-dashboard" style="display: none;">
                    <div class="welcome-card hero-formula-card">
                        <div class="welcome-badge-wrapper">
                            <span class="welcome-badge">SuperVocab 🎯</span>
                        </div>

                        <div class="setup-group" style="margin-top: 12px;">
                            <div class="group-head">
                                <h3 class="group-title"><span id="home-streak-value">0</span> kunlik seriya 🔥</h3>
                                <p class="group-caption"><span id="home-total-words-value">0</span> ta so'z o'rgandingiz</p>
                            </div>
                        </div>

                        <button type="button" id="home-continue-btn" class="btn-action btn-action-pulse" style="width: 100%; margin-top: 12px;">
                            Davom ettirish
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <polygon points="5 3 19 12 5 21 5 3"/>
                            </svg>
                        </button>
                    </div>
                </div>
            </section>
```

- [ ] **Step 2: Add `renderHomeDashboard()` and `initHomeDashboard()` to `app.js`**

Add these two functions immediately after the `hasCompletedAnyQuiz()` function added in Task 1:

```js

// 6c. Home Dashboard Rendering
function renderHomeDashboard() {
  const firstTimeBlock = document.getElementById("welcome-first-time");
  const dashboardBlock = document.getElementById("welcome-dashboard");
  if (!firstTimeBlock || !dashboardBlock) return;

  if (!hasCompletedAnyQuiz()) {
    firstTimeBlock.style.display = "block";
    dashboardBlock.style.display = "none";
    return;
  }

  firstTimeBlock.style.display = "none";
  dashboardBlock.style.display = "block";

  const streakEl = document.getElementById("home-streak-value");
  const totalEl = document.getElementById("home-total-words-value");
  if (streakEl) streakEl.innerText = getDailyStreak();
  if (totalEl) totalEl.innerText = getTotalWordsLearned();
}

function initHomeDashboard() {
  renderHomeDashboard();

  const continueBtn = document.getElementById("home-continue-btn");
  if (continueBtn) {
    continueBtn.addEventListener("click", () => {
      if (window.trackEvent) {
        window.trackEvent("continue_clicked", {
          book: state.selectedBooks && state.selectedBooks.length ? state.selectedBooks.join(", ") : null,
          mode: state.mode,
        });
      }
      startQuiz(false);
    });
  }
}
```

- [ ] **Step 3: Call `renderHomeDashboard()` when navigating back to "Asosiy"**

In `app.js`, find this exact block inside `showScreen()`:

```js
  // If result screen is shown, initialize empty state check
  if (screenId === "result-screen") {
    initResultEmptyState();
  }
}
```

Replace it with:

```js
  // If result screen is shown, initialize empty state check
  if (screenId === "result-screen") {
    initResultEmptyState();
  }

  // If welcome screen is shown, refresh the dashboard/streak view
  if (screenId === "welcome-screen") {
    renderHomeDashboard();
  }
}
```

- [ ] **Step 4: Wire up `initHomeDashboard()` on page load**

In `app.js`, find this exact block inside the `DOMContentLoaded` handler:

```js
  initResultEmptyState();
  initBookViewer();
```

Replace it with:

```js
  initResultEmptyState();
  initBookViewer();
  initHomeDashboard();
```

- [ ] **Step 5: Manually verify in a browser**

Serve the project (if not already running from Task 1's Step 3): `npx --yes serve . -l 8080` from the repo root, open `http://localhost:8080/`.

1. In DevTools Console, run `localStorage.clear()` and reload the page. Expected: "Asosiy" shows the original static welcome card (formula + pointer arrow), not the dashboard.
2. Navigate to "Mashqlar", pick any book/unit/mode, complete a full quiz through to the result screen.
3. Tap "Asosiy" in the bottom nav. Expected: the dashboard now shows ("1 kunlik seriya 🔥", a word count matching the quiz's correct-answer count) instead of the static card, and a "Davom ettirish" button is visible.
4. Tap "Davom ettirish". Expected: a new quiz starts immediately using the same book/unit/mode as before, without visiting "Mashqlar" first — and in DevTools Console, `window.trackEvent` fired (no error thrown; if `tracking.js` is loaded, no console errors appear since `window.Telegram` is undefined outside Telegram and the call silently no-ops per Task 9 of the backend plan).
5. Confirm no console errors appear at any point in steps 1–4.

- [ ] **Step 6: Commit**

```bash
cd /Users/macbookair/Documents/elmurod_projects/essential
git add index.html app.js
git commit -m "feat: replace static Home screen with a returning-user dashboard"
```

---

## Task 3: "Mashqlar" sticky selection summary bar

**Files:**
- Modify: `index.html:71` (`setup-screen` — add the summary bar as the first child)
- Modify: `styles.css` (add `.setup-summary-bar` styling)
- Modify: `app.js:24908-24937` (`initSetupScreen()` — wire the click handler)
- Modify: `app.js:25131-25137` (`saveSettings()` — refresh the summary bar on every selection change)
- Modify: `app.js:25139-25193` (`loadSettings()` — refresh the summary bar on initial load)

**Interfaces:**
- Consumes: `state.selectedBooks`, `state.selectedUnits` (existing global state).
- Produces: `renderSetupSummaryBar()` — no args, no return, updates the `#setup-summary-text` element's text. Called internally by `saveSettings()` and `loadSettings()`; no other task depends on calling it directly.

- [ ] **Step 1: Add the summary bar HTML**

In `index.html`, find this exact line:

```html
            <section id="setup-screen" class="view-screen">
                <!-- Always visible Setup Steps -->
                <div id="config-steps">
```

Replace it with:

```html
            <section id="setup-screen" class="view-screen">
                <button type="button" id="setup-summary-bar" class="setup-summary-bar">
                    <span id="setup-summary-text">Kitob va unit tanlanmagan</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>

                <!-- Always visible Setup Steps -->
                <div id="config-steps">
```

- [ ] **Step 2: Add CSS for the summary bar**

Add this to `styles.css` (append near the end of the file, or near the `.choice-chip` rules at line ~811 for locality):

```css
.setup-summary-bar {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    background-color: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 14px;
    padding: 12px 14px;
    margin-bottom: 14px;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text-main);
    cursor: pointer;
    text-align: left;
}

.setup-summary-bar svg {
    flex-shrink: 0;
    opacity: 0.6;
}
```

- [ ] **Step 3: Add `renderSetupSummaryBar()` and hook it into `saveSettings()`/`loadSettings()`**

Add this function immediately after the `initHomeDashboard()` function added in Task 2:

```js

// 6d. Setup Screen Summary Bar
function renderSetupSummaryBar() {
  const label = document.getElementById("setup-summary-text");
  if (!label) return;

  const bookCount = state.selectedBooks.length;
  const unitCount = state.selectedUnits.length;

  if (bookCount === 0 || unitCount === 0) {
    label.innerText = "Kitob va unit tanlanmagan — pastdan tanlang";
    return;
  }

  const bookLabel = bookCount === 1 ? state.selectedBooks[0] : `${bookCount} ta kitob`;
  label.innerText = `📘 ${bookLabel} · ${unitCount} ta unit tanlandi`;
}
```

In `app.js`, find this exact block (`saveSettings()`):

```js
function saveSettings() {
  localStorage.setItem("vocab_selected_books", JSON.stringify(state.selectedBooks));
  localStorage.setItem("vocab_selected_units", JSON.stringify(state.selectedUnits));
  localStorage.setItem("vocab_direction", state.direction);
  localStorage.setItem("vocab_mode", state.mode);
  localStorage.setItem("vocab_limit", state.limit.toString());
}
```

Replace it with:

```js
function saveSettings() {
  localStorage.setItem("vocab_selected_books", JSON.stringify(state.selectedBooks));
  localStorage.setItem("vocab_selected_units", JSON.stringify(state.selectedUnits));
  localStorage.setItem("vocab_direction", state.direction);
  localStorage.setItem("vocab_mode", state.mode);
  localStorage.setItem("vocab_limit", state.limit.toString());
  renderSetupSummaryBar();
}
```

Next, find this exact block (the end of the try branch in `loadSettings()`):

```js
    // Sync all UI states
    renderActiveBookPanel();
    syncSetupScreenUI();
    
    document.querySelectorAll('#mode-chips .choice-chip').forEach(chip => {
      chip.classList.toggle("selected", chip.dataset.val === state.mode);
    });
  } catch (err) {
    console.error("Local storage loaded values corrupted. Resetting...", err);
    state.selectedBooks = ["Essential 1"];
    state.selectedUnits = ["Essential 1|||Unit 1"];
    state.direction = "en-uz";
    state.mode = "multiple";
    state.limit = 20;
    renderActiveBookPanel();
    syncSetupScreenUI();
  }
}
```

Replace it with:

```js
    // Sync all UI states
    renderActiveBookPanel();
    syncSetupScreenUI();
    renderSetupSummaryBar();
    
    document.querySelectorAll('#mode-chips .choice-chip').forEach(chip => {
      chip.classList.toggle("selected", chip.dataset.val === state.mode);
    });
  } catch (err) {
    console.error("Local storage loaded values corrupted. Resetting...", err);
    state.selectedBooks = ["Essential 1"];
    state.selectedUnits = ["Essential 1|||Unit 1"];
    state.direction = "en-uz";
    state.mode = "multiple";
    state.limit = 20;
    renderActiveBookPanel();
    syncSetupScreenUI();
    renderSetupSummaryBar();
  }
}
```

- [ ] **Step 4: Wire the click-to-scroll handler**

In `app.js`, find this exact block at the end of `initSetupScreen()`:

```js
  renderActiveBookPanel();
  loadSettings();
}

function toggleUnitChip(bookName, unitName, idx) {
```

Replace it with:

```js
  renderActiveBookPanel();
  loadSettings();

  const summaryBar = document.getElementById("setup-summary-bar");
  if (summaryBar) {
    summaryBar.addEventListener("click", () => {
      const target = document.getElementById("config-steps");
      if (target) target.scrollIntoView({ behavior: "smooth" });
    });
  }
}

function toggleUnitChip(bookName, unitName, idx) {
```

- [ ] **Step 5: Manually verify in a browser**

Serve the project (if not already running), open `http://localhost:8080/`, tap "Mashqlar" in the bottom nav.

1. Expected: a bar reading e.g. "📘 Essential 1 · 1 ta unit tanlandi" appears at the very top of the screen, above the book-tabs row.
2. Tap a different unit chip (or use "Barchasi"/"Tozalash"/"Toqlar"/"Juftlar"). Expected: the summary bar's text updates immediately to reflect the new unit count.
3. Switch to a different book tab and select units there too. Expected: the summary bar now shows "2 ta kitob · N ta unit tanlandi".
4. Scroll down so the bar is off-screen, then tap it (it should still be reachable — the bar is not `position: sticky` in this implementation, it is simply the first element in the scrollable screen; confirm this is acceptable, since tapping it while off-screen isn't possible — this step just confirms the bar itself, when visible, correctly scrolls `#config-steps` into view on tap).
5. Deselect every unit (use "Tozalash" quick action on every book if needed). Expected: the bar reads "Kitob va unit tanlanmagan — pastdan tanlang".
6. Confirm no console errors appear at any point.

- [ ] **Step 6: Commit**

```bash
cd /Users/macbookair/Documents/elmurod_projects/essential
git add index.html styles.css app.js
git commit -m "feat: add a sticky book/unit selection summary bar to the Mashqlar screen"
```

---

## Task 4: Collapse advanced settings (direction & word count) on "Mashqlar"

**Files:**
- Modify: `index.html:92-122` (wrap `.practice-console-card` in a `<details>` element)
- Modify: `styles.css` (style the new `<details>`/`<summary>`)

**Interfaces:**
- Consumes: nothing new — the existing direction/slider JS (`setupConfigChips()`, `#dir-chips`, `#limit-range-slider` handlers) reads/writes these same DOM elements regardless of their new `<details>` wrapper; no JS changes needed in this task.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Wrap the practice console card in a `<details>` element**

In `index.html`, find this exact block:

```html
                    <!-- Consolidated Practice Console Card -->
                    <div class="practice-console-card">
                        
                        <!-- Direction sliding segmented control -->
                        <div class="segmented-control" id="dir-chips">
                            <div class="segmented-glider" id="dir-glider"></div>
                            <button type="button" class="segmented-item selected" data-val="en-uz">EN → UZ</button>
                            <button type="button" class="segmented-item" data-val="uz-en">UZ → EN</button>
                            <button type="button" class="segmented-item" data-val="mixed">Aralash 🌀</button>
                        </div>
                        
                        <!-- Integrated range slider row -->
                        <div class="slider-row">
                            <div class="slider-wrapper">
                                <input type="range" id="limit-range-slider" min="5" max="100" step="1" value="20" class="premium-slider">
                                <div class="slider-ticks" id="limit-chips">
                                    <span class="tick-preset" data-val="10">10</span>
                                    <span class="tick-preset" data-val="20">20</span>
                                    <span class="tick-preset" data-val="50">50</span>
                                    <span class="tick-preset" data-val="all" id="chip-all-btn">Jami</span>
                                </div>
                            </div>
                            <div class="slider-value-pill" id="limit-slider-badge">20</div>
                        </div>

                        <!-- Selected indicator subtext -->
                        <div class="console-meta-row">
                            <span>Savollar soni:</span>
                            <span class="val-highlight" id="limit-selected-indicator">20 ta so'z</span>
                        </div>
                    </div>

                    <!-- Practice type -->
```

Replace it with:

```html
                    <!-- Consolidated Practice Console Card (collapsed by default) -->
                    <details class="advanced-settings-details">
                        <summary class="advanced-settings-summary">Qo'shimcha sozlamalar (yo'nalish, so'z soni)</summary>
                        <div class="practice-console-card">

                            <!-- Direction sliding segmented control -->
                            <div class="segmented-control" id="dir-chips">
                                <div class="segmented-glider" id="dir-glider"></div>
                                <button type="button" class="segmented-item selected" data-val="en-uz">EN → UZ</button>
                                <button type="button" class="segmented-item" data-val="uz-en">UZ → EN</button>
                                <button type="button" class="segmented-item" data-val="mixed">Aralash 🌀</button>
                            </div>

                            <!-- Integrated range slider row -->
                            <div class="slider-row">
                                <div class="slider-wrapper">
                                    <input type="range" id="limit-range-slider" min="5" max="100" step="1" value="20" class="premium-slider">
                                    <div class="slider-ticks" id="limit-chips">
                                        <span class="tick-preset" data-val="10">10</span>
                                        <span class="tick-preset" data-val="20">20</span>
                                        <span class="tick-preset" data-val="50">50</span>
                                        <span class="tick-preset" data-val="all" id="chip-all-btn">Jami</span>
                                    </div>
                                </div>
                                <div class="slider-value-pill" id="limit-slider-badge">20</div>
                            </div>

                            <!-- Selected indicator subtext -->
                            <div class="console-meta-row">
                                <span>Savollar soni:</span>
                                <span class="val-highlight" id="limit-selected-indicator">20 ta so'z</span>
                            </div>
                        </div>
                    </details>

                    <!-- Practice type -->
```

- [ ] **Step 2: Style the `<details>`/`<summary>`**

Add this to `styles.css` (near the `.setup-summary-bar` rules added in Task 3):

```css
.advanced-settings-details {
    margin-bottom: 8px;
}

.advanced-settings-summary {
    list-style: none;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text-muted);
    padding: 10px 4px;
    display: flex;
    align-items: center;
    gap: 6px;
}

.advanced-settings-summary::-webkit-details-marker {
    display: none;
}

.advanced-settings-summary::before {
    content: "▸";
    display: inline-block;
    transition: transform 0.15s ease;
}

.advanced-settings-details[open] .advanced-settings-summary::before {
    transform: rotate(90deg);
}
```

- [ ] **Step 3: Manually verify in a browser**

Serve the project (if not already running), open `http://localhost:8080/`, tap "Mashqlar".

1. Expected: "Qo'shimcha sozlamalar (yo'nalish, so'z soni)" appears as a closed, collapsed row — the direction toggle and word-count slider are NOT visible by default.
2. Tap the row. Expected: it expands, revealing the EN→UZ/UZ→EN/Aralash toggle and the slider, with "EN → UZ" and "20" still selected by default (unchanged behavior).
3. Change the direction to "UZ → EN" and the slider to 50, then complete a quiz. Expected: the quiz correctly uses UZ→EN direction and 50 words — confirming the `<details>` wrapper did not break the existing `setupConfigChips()` JS logic.
4. Reload the page and revisit "Mashqlar". Expected: the row is collapsed again by default (collapsing state itself is not persisted — only the underlying direction/limit *values* persist, per existing `saveSettings()`/`loadSettings()` behavior, which is unchanged).
5. Confirm no console errors appear at any point.

- [ ] **Step 4: Commit**

```bash
cd /Users/macbookair/Documents/elmurod_projects/essential
git add index.html styles.css
git commit -m "feat: collapse direction/word-count settings into a details element on Mashqlar"
```

---

## Task 5: Full end-to-end manual verification

**Files:** none (verification-only task, no code changes).

**Interfaces:** none.

- [ ] **Step 1: Fresh-install walkthrough**

Serve the project (`npx --yes serve . -l 8080` from the repo root if not already running), open `http://localhost:8080/` in a private/incognito browser window (guarantees empty `localStorage`).

1. "Asosiy" shows the original static welcome card (first-time state).
2. Tap "Mashqlar". Confirm the summary bar shows the default selection ("📘 Essential 1 · 1 ta unit tanlandi"), the advanced settings are collapsed, and the 12 mashq-turi cards are visible below in their existing 4 groups.
3. Pick a mashq turi (e.g. "Test") and tap "Mashqni boshlash". Complete the quiz.
4. On the result screen, tap "Bosh sahifa" (or equivalent) to return to "Asosiy". Confirm the dashboard now appears (1 kunlik seriya, word count matching this quiz, "Davom ettirish" button).
5. Tap "Davom ettirish". Confirm a new quiz starts immediately with the same book/unit/mode as step 3, with no detour through "Mashqlar".
6. Complete this second quiz. Return to "Asosiy" again. Confirm the total word count increased further (streak stays at 1, since both quizzes happened today).

- [ ] **Step 2: Confirm tracking events fire correctly**

With DevTools open to the Network tab (or Console, watching for thrown errors — `tracking.js` fails silently outside real Telegram per the backend plan's design, so no network calls are expected here, only the absence of console errors matters):

1. Repeat the walkthrough above once more.
2. Confirm zero JavaScript errors appear in the Console at any point across all four screens touched (`welcome-screen`, `setup-screen`, `quiz-screen`, `result-screen`).

- [ ] **Step 3: Regression check on unrelated screens**

1. Tap "Kitob" in the bottom nav. Confirm it still opens and behaves exactly as before (this plan does not touch `book-screen`).
2. Tap "Sozlamalar". Confirm it still opens and behaves exactly as before (this plan does not touch `settings-screen`).

- [ ] **Step 4: Report completion**

No commit needed for this task (verification-only). If any step fails, stop and report which step failed and what was observed instead of the expected result — do not proceed to marking the plan complete.
