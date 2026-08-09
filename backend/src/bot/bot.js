const { Telegraf, Markup } = require('telegraf');
const { getUserByTelegramId, upsertUser, updateUserPhone } = require('../services/user.service.js');

const WELCOME_CAPTION =
  "🎓 *4000 Essential English Words* — ingliz tili lug'atini oson va qiziqarli o'rganish uchun yaratilgan interaktiv ilova!\n\n" +
  "📚 5 ta kitob, 150 dan ortiq unit, minglab so'z\n" +
  "🎮 12 xil mashq turi: kartochkalar, testlar, o'yinlar va boshqalar\n" +
  "🔥 Kunlik seriya va shaxsiy statistikangizni kuzating\n\n" +
  "Xizmatlardan to'liq foydalanish uchun pastdagi tugma orqali telefon raqamingizni tasdiqlang 👇";

function buildMiniAppKeyboard(env) {
  return Markup.inlineKeyboard([
    Markup.button.webApp('📖 Ilovani ochish', env.miniAppUrl),
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
  await ctx.reply(
    `Xush kelibsiz, ${ctx.from.first_name}! Tizimga qaytganingizdan xursandmiz 🎉`,
    buildMiniAppKeyboard(env)
  );
}

async function sendOnboarding(ctx, env) {
  if (env.welcomePhotoUrl) {
    await ctx.replyWithPhoto(env.welcomePhotoUrl, {
      caption: WELCOME_CAPTION,
      parse_mode: 'Markdown',
      ...buildContactKeyboard(),
    });
  } else {
    await ctx.reply(WELCOME_CAPTION, {
      parse_mode: 'Markdown',
      ...buildContactKeyboard(),
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
