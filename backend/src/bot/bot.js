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
  "🔒 <b>Xavfsiz Xotira</b> — Ma'lumotlaringiz shaxsiy va mutlaqo himoyalangan\n\n";

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
      caption: `Xush kelibsiz, <b>${ctx.from.first_name || 'Foydalanuvchi'}</b>! 👋\n\n` + WELCOME_CAPTION + "👇 <b>Ilovani ochish uchun pastdagi tugmani bosing:</b>",
      parse_mode: 'HTML',
      ...buildMiniAppKeyboard(env)
    });
  } catch (e) {
    await ctx.reply(WELCOME_CAPTION + "👇 <b>Ilovani ochish uchun pastdagi tugmani bosing:</b>", {
      parse_mode: 'HTML',
      ...buildMiniAppKeyboard(env)
    });
  }
}

async function sendPhonePrompt(ctx, env) {
  const photoUrl = env.welcomePhotoUrl || DEFAULT_WELCOME_PHOTO;
  const promptText = WELCOME_CAPTION +
    "⚠️ <b>Ilovadan foydalanish uchun telefon raqamingizni tasdiqlashingiz shart!</b>\n\n" +
    "Iltimos, pastdagi <b>'Telefon raqamini yuborish 📱'</b> tugmasini bosing (o'zingiz qo'lda kiritmang). 👇";
  try {
    await ctx.replyWithPhoto(photoUrl, {
      caption: promptText,
      parse_mode: 'HTML',
      ...buildContactKeyboard()
    });
  } catch (e) {
    await ctx.reply(promptText, {
      parse_mode: 'HTML',
      ...buildContactKeyboard()
    });
  }
}

function createBot({ env, pool }) {
  const bot = new Telegraf(env.telegramBotToken);

  bot.start(async (ctx) => {
    const existingUser = await getUserByTelegramId(pool, ctx.from.id);

    if (existingUser && existingUser.phone_number) {
      await sendWelcomeBack(ctx, env);
      return;
    }

    await sendPhonePrompt(ctx, env);
  });

  // Share Contact handler
  bot.on('contact', async (ctx) => {
    const contact = ctx.message.contact;

    if (contact.user_id !== ctx.from.id) {
      await ctx.reply(
        "⚠️ Iltimos, faqat o'zingizning raqamingizni yuboring. Pastdagi 'Telefon raqamini yuborish 📱' tugmasini bosing.",
        buildContactKeyboard()
      );
      return;
    }

    const user = await upsertUser(pool, ctx.from);
    await updateUserPhone(pool, user.id, contact.phone_number);

    await ctx.reply(
      `✅ Raqamingiz (<b>${contact.phone_number}</b>) muvaffaqiyatli tasdiqlandi va bazaga saqlandi! 🎉\n\n` +
      `Endi ilovadan to'liq foydalanishingiz mumkin 👇`,
      { parse_mode: 'HTML', ...Markup.removeKeyboard() }
    );
    await ctx.reply('Boshlash uchun quyidagi tugmani bosing:', buildMiniAppKeyboard(env));
  });

  // Handle manual text input when phone is not verified
  bot.on('message', async (ctx) => {
    const existingUser = await getUserByTelegramId(pool, ctx.from.id);

    if (existingUser && existingUser.phone_number) {
      await ctx.reply("Ilovani ochish uchun pastdagi tugmani bosing:", buildMiniAppKeyboard(env));
      return;
    }

    await ctx.reply(
      "⚠️ <b>Iltimos, raqamni qo'lda kiritmang!</b>\n\n" +
      "Pastdagi <b>'Telefon raqamini yuborish 📱'</b> tugmasini bosing 👇",
      { parse_mode: 'HTML', ...buildContactKeyboard() }
    );
  });

  bot.catch((error, ctx) => {
    console.error(`Bot error for update ${ctx.updateType}`, error);
  });

  return bot;
}

module.exports = { createBot };
