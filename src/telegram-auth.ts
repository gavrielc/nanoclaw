/**
 * Telegram Bot Authentication Script
 *
 * Verifies bot token and confirms connection to Telegram API.
 * This is a one-time validation step, not a QR code authentication like WhatsApp.
 *
 * Usage: npx tsx src/telegram-auth.ts
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { Telegraf } from 'telegraf';

// Load environment variables from .env file
dotenv.config();

const ENV_FILE = '.env';
const AUTH_MARKER_FILE = './store/telegram_auth.json';

async function authenticate(): Promise<void> {
  console.log('Starting Telegram bot authentication...\n');

  // 1. Read bot token from environment
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    console.error('✗ TELEGRAM_BOT_TOKEN not found in environment');
    console.error('  Please add it to your .env file:');
    console.error('  TELEGRAM_BOT_TOKEN=your_bot_token_here\n');
    console.error('  Get your bot token from @BotFather on Telegram:');
    console.error('  1. Open Telegram and search for @BotFather');
    console.error('  2. Send /newbot and follow instructions');
    console.error('  3. Copy the token and add it to .env\n');
    process.exit(1);
  }

  // 2. Validate token format (basic check)
  if (!botToken.match(/^\d+:[A-Za-z0-9_-]+$/)) {
    console.error('✗ Invalid bot token format');
    console.error('  Expected format: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz\n');
    process.exit(1);
  }

  // 3. Test connection to Telegram API
  try {
    const bot = new Telegraf(botToken);
    const botInfo = await bot.telegram.getMe();

    console.log('✓ Successfully authenticated with Telegram!');
    console.log(`  Bot username: @${botInfo.username}`);
    console.log(`  Bot name: ${botInfo.first_name}`);
    console.log(`  Bot ID: ${botInfo.id}\n`);

    // 4. Save authentication marker
    fs.mkdirSync(path.dirname(AUTH_MARKER_FILE), { recursive: true });
    fs.writeFileSync(
      AUTH_MARKER_FILE,
      JSON.stringify(
        {
          authenticated_at: new Date().toISOString(),
          bot_username: botInfo.username,
          bot_id: botInfo.id,
          bot_name: botInfo.first_name,
        },
        null,
        2,
      ),
    );

    console.log('  You can now start the NanoClaw service with: npm run dev\n');

    await bot.stop();
    process.exit(0);
  } catch (err) {
    console.error('✗ Failed to connect to Telegram API');
    if (err instanceof Error) {
      console.error(`  Error: ${err.message}\n`);

      if (err.message.includes('401')) {
        console.error('  This usually means the bot token is invalid or revoked.');
        console.error('  Generate a new token from @BotFather and update .env\n');
      }
    }
    process.exit(1);
  }
}

authenticate().catch((err) => {
  console.error('Authentication failed:', err.message);
  process.exit(1);
});
