const { loadEnv } = require('./config/env.js');
const { createPool } = require('./config/db.js');
const { createApp } = require('./app.js');
const { createBot } = require('./bot/bot.js');

const env = loadEnv();
const pool = createPool(env);
const app = createApp({ env, pool });
const bot = createBot({ env, pool });

app.listen(env.port, () => {
  console.log(`Server listening on port ${env.port}`);
});

bot.launch().then(() => {
  console.log('Telegram bot polling started');
}).catch((err) => {
  console.error('Telegram bot polling launch error (ignoring for web server):', err.message);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
