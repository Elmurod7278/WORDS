# "Asosiy" va "Mashqlar" Ekranlarini Qayta Loyihalash — Dizayn

**Sana:** 2026-07-11
**Holat:** Tasdiqlangan (brainstorming bosqichi)

## Muammo

Mini appning pastki navigatsiyasida 4 ta tugma bor: Asosiy, Kitob, Mashqlar, Sozlamalar (`index.html:751-774`, `app.js:24549`dagi `showScreen()` orqali boshqariladi). Foydalanuvchi (loyiha egasi) uchta aniq muammoni ko'rsatdi:

1. **"Asosiy" (Home) mantiqsiz.** `welcome-screen` (`index.html:30-68`) — bu bir martalik statik salomlashish karta (shior + pastga strelka), qaytib kelgan foydalanuvchi uchun hech qanday amaliy foyda bermaydi, lekin ilovaning standart (default active) ekrani aynan shu.
2. **"Kitob" va "Mashqlar" orasida vazifaviy chalkashlik.** Ikkalasi ham kitobga tegishli tuyuladi, lekin turlicha ishlaydi — foydalanuvchi qaysi birida nima borligini bilmaydi.
3. **"Mashqlar" ekrani (`setup-screen`, `index.html:71-232`) haddan tashqari zich.** Bitta uzun scroll ichida: 30 ta unit tugmasi (tanlangani ajralib turmaydi), yo'nalish/so'z-soni sozlamalari, va 12 xil mashq turi — barchasi bir vaqtda ko'rsatiladi.

## Maqsad va qamrov

**Maqsad:** Yuqoridagi uchta muammoni hal qilish + loyiha egasining uzoq muddatli maqsadiga mos ravishda (har bir bo'limning qanchalik ishlatilishini kuzatish, kelajakda yangi bo'limlar qo'shish) tracking hooklarini yangilash.

**Qamrovga kiradi:**
- `welcome-screen` (Asosiy) — progress dashboard'ga aylantiriladi
- `setup-screen` (Mashqlar) — ichki tuzilishi qayta tashkil etiladi (kompakt tanlov ko'rsatkichi + yig'iladigan qo'shimcha sozlamalar)
- Yangi frontend tracking hooklari (Home'dagi "Davom ettirish" tugmasi uchun)

**Qamrovga kirmaydi** (alohida so'raladi/keyinroq qilinadi):
- `book-screen` (Kitob) — o'zgarishsiz qoladi, u allaqachon o'z vazifasini bajaradi (o'qish/ko'rish) va foydalanuvchi undan shikoyat qilmagan
- `settings-screen` (Sozlamalar) — o'zgarishsiz
- 12 ta mashq turining o'zining ichki mexanikasi (Kartochka, Test va h.k. qanday ishlashi) — faqat ularni **tanlash** interfeysi tozalanadi, o'zlari emas
- Telefon raqamini saqlash — alohida, keyingi spec

## "Asosiy" (Home) — yangi dizayn

`welcome-screen` ikki holatga ega bo'ladi:

**Birinchi marta kirgan foydalanuvchi uchun** (hali birorta test yakunlanmagan — ya'ni `vocab_total_correct_answers` localStorage'da mavjud emas): hozirgi holat saqlanadi — shior karta + pastga strelka bilan "boshlash uchun pastdan tanlang" xabari.

**Qaytib kelgan foydalanuvchi uchun** (kamida bitta test yakunlangan): statik karta o'rniga:
- **Kunlik seriya (streak) ko'rsatkichi** — necha kun ketma-ket kamida bitta test yakunlangani. Bu **yangi, mustaqil hisoblagich** bo'ladi (mavjud `state.streak`/`state.maxStreak` bilan aralashtirilmaydi — ular bitta test ichidagi ketma-ket to'g'ri javoblar sonini hisoblaydi, butunlay boshqa narsa). Yangi hisoblagich `localStorage`da ikkita qiymat bilan saqlanadi: `vocab_daily_streak_count` (son) va `vocab_last_active_date` (ISO sana, faqat kun aniqligida). Har safar `finishQuiz()` chaqirilganda (test yakunlanganda): agar oxirgi faol sana — bugun bo'lsa, hech narsa o'zgarmaydi; agar kecha bo'lsa, seriya +1 oshadi; agar undan oldinroq bo'lsa (kun o'tkazib yuborilgan), seriya 1 ga qaytadi; agar birinchi marta bo'lsa, seriya 1dan boshlanadi.
- **Jami o'rganilgan so'zlar** — barcha vaqt davomida to'g'ri javob berilgan so'zlarning yig'indisi. Yangi `localStorage` hisoblagich: `vocab_total_correct_answers`, har safar `finishQuiz()` chaqirilganda `state.correctCount` shu hisoblagichga qo'shiladi (kümulativ, hech qachon kamaymaydi yoki reset bo'lmaydi).
- **"▶ Davom ettirish" tugmasi** — bosilganda, oxirgi ishlatilgan sozlamalar bilan (`state.selectedBooks`, `state.selectedUnits`, `state.mode`, `state.direction`, `state.limit` — bular allaqachon `localStorage`da saqlanadi, `app.js:25125-25181` orqali tiklanadi) darhol `startQuiz(false)` chaqiriladi, foydalanuvchi "Mashqlar" ekraniga umuman kirmasdan.

## "Mashqlar" (setup-screen) — ichki qayta tashkil etish

Uchta o'zgarish, barchasi mavjud `state` va HTML strukturasidan foydalanadi (yangi backend/state maydoni kerak emas):

1. **Tepada doimiy "joriy tanlov" chip'i.** `book-screen`da allaqachon shunga o'xshash naqsh bor (`super-control-trigger` tugmasi, `index.html:260-266`: "📖 ES-1 • Unit 1"). Xuddi shu vizual naqsh `setup-screen` tepasiga qo'shiladi: "📘 Essential 1 · Unit 4 · 2 unit ▾" ko'rinishida, bosilganda pastdagi to'liq kitob/unit tanlov panjarasiga scroll qiladi (yangi modal kerak emas).
2. **"Qo'shimcha sozlamalar" — yig'iladigan bo'lim.** Hozirgi yo'nalish tugmalari (EN→UZ/UZ→EN/Aralash) va so'z-soni slider'i standart holatda yopiq (`<details>` yoki shunga o'xshash) bo'ladi, standart qiymatlar bilan (`direction: "en-uz"`, `limit: 20` — bular allaqachon standart qiymatlar). Foydalanuvchi ochib o'zgartirishi mumkin, lekin ko'pchilik uchun bu qadam butunlay o'tkazib yuboriladi.
3. **Mashq turlari — vizual tozalash.** 12 turning 4 guruhga bo'lingan tuzilishi (`index.html:130-218`: Yodlash va Takrorlash, Sinov va Savol-javob, Eshitish va Yozish, O'yinlar va Qidiruv) allaqachon mantiqan to'g'ri tashkil etilgan — bu qayta qurilmaydi, faqat tanlangan turni yanada aniqroq ajratib ko'rsatish uchun CSS/vizual ta'kidlash kuchaytiriladi (masalan aniqroq chegara/soya tanlangan kartada).

## Tracking yangilanishi

`tracking.js`ning `window.trackEvent` interfeysi o'zgarmaydi (`type`, `payload`). Faqat yangi chaqiruv qo'shiladi:

- Home'dagi "Davom ettirish" tugmasi bosilganda: `window.trackEvent("continue_clicked", { book: state.selectedBooks.join(", "), mode: state.mode })` — shu orqali admin panelda "Davom ettirish" qanchalik ishlatilayotgani (to'liq "Mashqlar" oqimiga nisbatan) ko'rinadi. Backend tomonda hech narsa o'zgarmaydi — `events.payload` JSONB bo'lgani uchun yangi `type` qiymati avtomatik qabul qilinadi (Task 4'dagi validatsiya faqat `type`ning bo'sh bo'lmagan satr ekanini tekshiradi).
- Mavjud `page_view` va `quiz_result` hooklari (`app.js`dagi `showScreen`/`finishQuiz`) o'zgarishsiz qoladi — ekran ID'lari (`welcome-screen`, `setup-screen`) o'zgarmaydi, faqat ularning ICHIDAGI HTML/CSS o'zgaradi.

## Nima o'zgarmaydi (aniqlik uchun)

- Ekranlarning ID'lari va navigatsiya mantiqi (`showScreen()`, pastki tugmalar soni va joylashuvi) — o'zgarmaydi
- Backend — hech qanday o'zgarish kerak emas (mavjud `POST /api/events` yangi `continue_clicked` turini ham qabul qiladi)
- 12 ta mashq turining ichki ishlash mexanikasi — o'zgarmaydi
- Vizual uslub (rang, shrift, umumiy "dark theme") — mavjud `styles.css` tizimidan foydalaniladi, butunlay yangi vizual yo'nalish emas, balki tuzilishni tozalash va aniqlik kiritish

## Testlash yondashuvi

Loyihada frontend uchun avtomatik test infratuzilmasi yo'q (oldingi tracking integratsiyasida ham shunday qaror qilingan). Tekshiruv qo'lda bo'ladi:
- Yangi foydalanuvchi holatini simulyatsiya qilish (localStorage tozalab) — "Asosiy" hali statik xabarni ko'rsatishini tekshirish
- Test yakunlab, "Asosiy"ga qaytib, streak/jami-so'z hisoblagichlari to'g'ri yangilanganini tekshirish
- Ikkinchi kun (sana o'zgartirib, dev tools orqali) test yakunlab, streak +1 oshganini tekshirish
- "Davom ettirish" tugmasi to'g'ri sozlamalar bilan testni boshlashini tekshirish
- "Mashqlar" ekranida chip bosilganda tanlov panjarasiga scroll qilishini tekshirish
