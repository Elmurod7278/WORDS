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

bot.launch();
console.log('Telegram bot polling started');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
