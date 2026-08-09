const { Telegraf, Markup } = require('telegraf');
const { getUserByTelegramId, upsertUser, updateUserPhone } = require('../services/user.service.js');

const DEFAULT_WELCOME_PHOTO = "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?q=80&w=1000&auto=format&fit=crop";

const WELCOME_CAPTION =
  "✨ <b>WORDS — Zamonaviy Ko'p Tilli Lug'at & Amaliyot Ilovasi</b> 🌐\n\n" +
  "<b>WORDS</b> — chet tillarini (Ingliz, Arab, Rus, Nemis, Fransuz, Turk va b.) oson va samarali o'rganish uchun yaratilgan interaktiv Telegram Mini App ilovasi! 🚀\n\n" +
  "<b>💡 Asosiy Imkoniyatlar:</b>\n" +
  "📖 <b>Shaxsiy Lug'at</b> — O'zingiz xohlagan so'zlar va to'plamlarni kiritib boring\n" +
  "📁 <b>To'plamlar (Units)</b> — So'zlaringizni guruhlab, to'plam tarzida tahrirlang\n" +
  "🔊 <b>Jonli Ovozli Talaffuz</b> — Arab, Ingliz, Rus va barcha tillarda tiniq talaffuz (TTS Engine)\n" +
  "🎮 <b>12 xil Interaktiv Mashqlar</b> — Flashcards, Quiz, Yozish va Eshitish o'yinlari\n" +
  "🔥 <b>Statistika & Seriya</b> — O'rganish ko'rsatkichlaringiz va kunlik faolligingizni kuzatib boring\n" +
  "🔒 <b>Xavfsiz Xotira</b> — Ma'lumotlaringiz shaxsiy va mutlaqo himoyalangan\n\n" +
  "👇 <b>Ilovani ochish uchun pastdagi tugmani bosing:</b>";

function buildMiniAppKeyboard(env) {
  const url = (env && env.miniAppUrl && env.miniAppUrl.startsWith('http')) ? env.miniAppUrl : "https://words.reach.uz/";
  return Markup.inlineKeyboard([
    [Markup.button.webApp("🚀 Lug'atni ochish (Mini App)", url)],
    [Markup.button.webApp("📚 Shaxsiy Lug'atim", url)]
  ]);
}

function buildContactKeyboard() {
  return Markup.keyboard([
    Markup.button.contactRequest('Telefon raqamini yuborish 📱'),
  ])
    .resize()
    .oneTime();
}

async function sendWelcomeBack(ctx, env) {
  const photoUrl = env.welcomePhotoUrl || DEFAULT_WELCOME_PHOTO;
  try {
    await ctx.replyWithPhoto(photoUrl, {
      caption: `Xush kelibsiz, <b>${ctx.from.first_name || 'Foydalanuvchi'}</b>! 👋\n\n` + WELCOME_CAPTION,
      parse_mode: 'HTML',
      ...buildMiniAppKeyboard(env)
    });
  } catch (e) {
    await ctx.reply(WELCOME_CAPTION, {
      parse_mode: 'HTML',
      ...buildMiniAppKeyboard(env)
    });
  }
}

async function sendOnboarding(ctx, env) {
  const photoUrl = env.welcomePhotoUrl || DEFAULT_WELCOME_PHOTO;
  try {
    await ctx.replyWithPhoto(photoUrl, {
      caption: WELCOME_CAPTION,
      parse_mode: 'HTML',
      ...buildMiniAppKeyboard(env)
    });
  } catch (e) {
    await ctx.reply(WELCOME_CAPTION, {
      parse_mode: 'HTML',
      ...buildMiniAppKeyboard(env)
    });
  }
}

function createBot({ env, pool }) {
  const bot = new Telegraf(env.telegramBotToken);

  bot.start(async (ctx) => {
    const existingUser = await getUserByTelegramId(pool, ctx.from.id);

    if (existingUser) {
      await sendWelcomeBack(ctx, env);
      return;
    }

    await sendOnboarding(ctx, env);
  });

  // A shared contact card can name someone other than the sender —
  // request_contact only ever produces the sender's own card, but we
  // verify anyway since this must not silently accept the wrong number.
  bot.on('contact', async (ctx) => {
    const contact = ctx.message.contact;

    if (contact.user_id !== ctx.from.id) {
      await ctx.reply("Iltimos, faqat o'zingizning raqamingizni yuboring.");
      return;
    }

    const user = await upsertUser(pool, ctx.from);
    await updateUserPhone(pool, user.id, contact.phone_number);

    await ctx.reply(
      'Raqamingiz muvaffaqiyatli tasdiqlandi! Endi ilovadan foydalanishingiz mumkin 🎉',
      Markup.removeKeyboard()
    );
    await ctx.reply('Boshlash uchun quyidagi tugmani bosing:', buildMiniAppKeyboard(env));
  });

  // Any other message: known users get pointed at /start again, unknown
  // users are re-prompted to share their contact before anything else.
  bot.on('message', async (ctx) => {
    const existingUser = await getUserByTelegramId(pool, ctx.from.id);

    if (existingUser) {
      await ctx.reply("Ilovani ochish uchun /start buyrug'ini yuboring.", buildMiniAppKeyboard(env));
      return;
    }

    await ctx.reply(
      'Xizmatlardan foydalanish uchun avval telefon raqamingizni tasdiqlang 👇',
      buildContactKeyboard()
    );
  });

  bot.catch((error, ctx) => {
    console.error(`Bot error for update ${ctx.updateType}`, error);
  });

  return bot;
}

module.exports = { createBot };
