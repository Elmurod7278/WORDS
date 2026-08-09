# Foydalanuvchi Tracking va Analytics Backend — Dizayn

**Sana:** 2026-07-11
**Holat:** Tasdiqlangan (brainstorming bosqichi)

## Maqsad

Hozirgi "4000 Essential English Words" Telegram Mini App (`index.html` + `app.js` + `styles.css`) to'liq client-side ishlaydi — hech qanday backend yoki foydalanuvchi ma'lumotlar bazasi yo'q. Botning o'zi ham faqat BotFather orqali sozlangan, alohida server kodi mavjud emas.

Kerak bo'lgan narsa:
1. Har bir foydalanuvchini Telegram identifikatori orqali aniqlash va bazada saqlash.
2. Foydalanuvchi qaysi ekranlarga (sahifalarga), qaysi kitob/unitlarga necha marta kirganini, qancha vaqt o'tkazganini va test natijalarini yozib borish.
3. Bu ma'lumotlarni parol bilan himoyalangan sodda admin panelda ko'rish (foydalanuvchilar soni, faollik, mashhur sahifalar/kitoblar, o'rtacha natija).
4. Kelajakda `chat_id` bo'yicha foydalanuvchilarga xabar (broadcast) yuborish imkoniyati uchun baza tayyor bo'lishi.
5. Mini app tezligiga hech qanday salbiy ta'sir qilmasligi — tracking hech qachon UI'ni bloklamasligi kerak.

**Qamrov chegarasi:** Mavjud frontend (`index.html`/`app.js`/`styles.css`) qayta yozilmaydi — u allaqachon to'g'ri texnologiyada (HTML/CSS/JavaScript, Telegram Mini App platformasi buni talab qiladi). Faqat tracking uchun yengil qo'shimcha kod kiritiladi. Yangidan quriladigan qism — backend (Node.js/Express) va PostgreSQL baza, mukammal/kengaytiriladigan strukturada.

## Arxitektura

```
[Telegram Mini App: index.html + app.js]
   │  Telegram WebApp SDK (telegram-web-app.js) — yangi qo'shiladi
   │  initData (ishonchli foydalanuvchi ma'lumoti)
   ▼
[Node.js / Express API — foydalanuvchining o'z serverida]
   │  pg connection pool
   ▼
[PostgreSQL]
```

Backend alohida loyiha (`backend/`) sifatida quriladi, frontenddan mustaqil deploy qilinadi (o'z serverida, Docker Compose orqali: `app` + `postgres` xizmatlari).

## Backend loyiha strukturasi

```
backend/
  src/
    config/
      env.js            # atrof-muhit o'zgaruvchilarini o'qish/tekshirish
      db.js              # pg.Pool ulanishi
    db/
      migrations/        # raqamlangan SQL migratsiya fayllari (node-pg-migrate)
    middleware/
      adminAuth.js        # admin panel uchun Basic Auth
      errorHandler.js      # markazlashgan xatolik ushlagich
      rateLimit.js          # public endpointlar uchun so'rov cheklovi
    routes/
      session.routes.js     # POST /api/session
      events.routes.js      # POST /api/events
      admin.routes.js        # GET /api/admin/* (himoyalangan)
    services/
      telegramAuth.service.js  # initData HMAC tekshiruvi
      user.service.js            # user upsert
      event.service.js            # event yozish
      stats.service.js             # admin panel uchun agregatsiya so'rovlari
    app.js                # Express app yig'ilishi (middleware, routes)
    server.js              # kirish nuqtasi (listen)
  admin/
    index.html              # sodda statistik panel (grafik/jadval)
  .env.example
  package.json
  Dockerfile
  docker-compose.yml
```

Qatlamlar aniq ajratilgan: **routes** (HTTP so'rov/javob) → **services** (biznes mantiq) → **db** (ma'lumotlarga kirish). Bu tuzilma kelajakda yangi funksiya (masalan, broadcast xabar yuborish) qo'shishni oson qiladi — mavjud kodga tegmasdan yangi `routes/`, `services/` fayli qo'shish kifoya.

Xom `pg` kutubxonasi ishlatiladi (ORM emas) — parametrlangan SQL so'rovlar bilan, tezlik va soddalik uchun. Migratsiyalar `node-pg-migrate` orqali — sof SQL, runtime tezligiga ta'sir qilmaydi (faqat deploy paytida ishlaydi).

## Ma'lumotlar modeli (PostgreSQL)

```sql
-- Har bir Telegram foydalanuvchisi
CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  telegram_id   BIGINT UNIQUE NOT NULL,   -- kelajakda broadcast uchun chat_id sifatida ishlatiladi
  username      TEXT,
  first_name    TEXT,
  last_name     TEXT,
  language_code TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Har bir app ochilishi (session)
CREATE TABLE sessions (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Moslashuvchan event jurnali: sahifa ko'rishlar, test natijalari va h.k.
CREATE TABLE events (
  id           BIGSERIAL PRIMARY KEY,
  session_id   BIGINT NOT NULL REFERENCES sessions(id),
  user_id      BIGINT NOT NULL REFERENCES users(id),
  type         TEXT NOT NULL,            -- 'page_view' | 'quiz_result' | ...
  payload      JSONB NOT NULL DEFAULT '{}',  -- masalan: {"screen":"quiz-screen","book":"Essential 1","unit":4}
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_events_user_id ON events(user_id);
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_occurred_at ON events(occurred_at);
```

`payload`ni JSONB qilib tanlash sababi: kelajakda yangi event turlari (masalan, yangi mashq turi) qo'shilganda, baza sxemasini o'zgartirmasdan moslashish mumkin bo'ladi.

## Foydalanuvchini aniqlash oqimi

1. App ochilganda frontend Telegram WebApp SDK'dan `initData`ni oladi.
2. Frontend `POST /api/session` chaqiradi, tanasida `initData` yuboriladi.
3. Backend (`telegramAuth.service.js`) bot tokeni bilan HMAC-SHA256 imzosini tekshiradi — soxta yoki o'zgartirilgan ma'lumot rad etiladi.
4. Tasdiqlangandan so'ng: `users` jadvalida `telegram_id` bo'yicha upsert (mavjud bo'lsa `last_seen_at` yangilanadi, bo'lmasa yangi qator), yangi `sessions` yozuvi ochiladi.
5. Backend frontendga `session_id` qaytaradi — keyingi barcha event chaqiruvlarida shu ishlatiladi (har safar `initData`ni qayta yuborish shart emas).
6. Agar tekshiruv muvaffaqiyatsiz bo'lsa (masalan, app Telegram tashqarisida ochilgan) — backend xato qaytaradi, lekin **frontend bu holatda ham to'xtamaydi**, faqat tracking o'chiq holatda ishlaydi.

## Event yozib borish oqimi

- Frontendga qo'shiladigan yengil `tracking.js` moduli eventlarni **xotirada to'playdi** (masalan, har bir `showScreen()` chaqiruvida, test tugaganda `state.correctCount`/`incorrectCount` bilan).
- Har ~10 soniyada yoki foydalanuvchi ilovani yopganda (`navigator.sendBeacon` orqali — bloklamaydigan, ishonchli usul) to'plangan eventlar **bir battada** `POST /api/events`ga yuboriladi.
- Barcha tracking chaqiruvlari **fire-and-forget**: natijani kutmaydi, xatolikni jim yutadi. Tarmoq yoki backend ishlamay qolsa ham, mashq/o'yin jarayoni davom etaveradi.

## Admin panel

- `GET /admin` va `GET /api/admin/*` — HTTP Basic Auth bilan himoyalangan (`ADMIN_USERNAME`/`ADMIN_PASSWORD` atrof-muhit o'zgaruvchilari orqali).
- Ko'rsatkichlar (`stats.service.js` orqali SQL agregatsiya):
  - Jami va kunlik/haftalik faol foydalanuvchilar soni
  - Eng ko'p tashrif buyurilgan ekranlar/sahifalar
  - Eng mashhur kitob/unitlar
  - O'rtacha test natijasi, mashq turlari bo'yicha taqsimot
- Sodda statik `admin/index.html` sahifasi shu API'lardan ma'lumot olib, jadval/grafik ko'rinishida chiqaradi.

## Xatoliklarni boshqarish va tezlik

- Frontendda barcha tracking chaqiruvlari try/catch bilan o'ralgan, xatolik asosiy funksionallikka hech qachon ta'sir qilmaydi.
- Backend `express-rate-limit` bilan `POST /api/session` va `/api/events`ni ortiqcha so'rovlardan himoyalaydi.
- CORS faqat mini app joylashgan domenga ruxsat beradi.
- `pg.Pool` orqali ulanishlar qayta ishlatiladi (har bir so'rovda yangi ulanish ochilmaydi).

## Kelajakka moslik (hozir qurilmaydi, faqat sxema tayyor)

`users.telegram_id` saqlanganligi sababli, kelajakda alohida kichik skript orqali Telegram Bot API (`sendMessage`) yordamida shu ID'lar bo'yicha xabar yuborish (broadcast) qo'shimcha infratuzilmasiz amalga oshiriladi.

## Test/tekshirish yondashuvi

- `telegramAuth.service.js` uchun unit testlar (to'g'ri/soxta/eskirgan `initData` holatlari) — bu xavfsizlik uchun eng muhim nuqta.
- Qo'lda tekshirish: Telegram ichida app ochish → bazada `users`/`sessions`/`events` qatorlari to'g'ri yaratilishini tekshirish → admin panelda sonlar to'g'ri chiqishini ko'rish.
- Og'ir avtomatik test to'plami talab qilinmaydi — loyiha hajmiga nomutanosib bo'lardi (YAGNI).
