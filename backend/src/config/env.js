require('dotenv').config();

const REQUIRED_VARS = [
  'DATABASE_URL',
  'TELEGRAM_BOT_TOKEN',
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD',
  'MINI_APP_URL',
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
    miniAppUrl: source.MINI_APP_URL,
    welcomePhotoUrl: source.WELCOME_PHOTO_URL || null,
  };
}

module.exports = { loadEnv };
