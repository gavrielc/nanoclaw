import { Bot } from "grammy";
import pino from "pino";
import {
  ASSISTANT_NAME,
  TRIGGER_PATTERN,
  MAIN_GROUP_FOLDER,
} from "./config.js";
import { RegisteredGroup, NewMessage } from "./types.js";
import { storeChatMetadata, storeMessageDirect } from "./db.js";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
});

export interface TelegramCallbacks {
  onMessage: (
    msg: NewMessage,
    group: RegisteredGroup,
  ) => Promise<string | null>;
  getRegisteredGroups: () => Record<string, RegisteredGroup>;
}

let bot: Bot | null = null;
let callbacks: TelegramCallbacks | null = null;

export async function connectTelegram(
  botToken: string,
  cbs: TelegramCallbacks,
): Promise<void> {
  callbacks = cbs;
  bot = new Bot(botToken);

  // Command to get chat ID (useful for registration)
  bot.command("chatid", (ctx) => {
    const chatId = ctx.chat.id;
    const chatType = ctx.chat.type;
    const chatName =
      chatType === "private"
        ? ctx.from?.first_name || "Private"
        : (ctx.chat as any).title || "Unknown";

    ctx.reply(
      `Chat ID: \`tg:${chatId}\`\nName: ${chatName}\nType: ${chatType}`,
      { parse_mode: "Markdown" },
    );
  });

  // Command to check bot status
  bot.command("ping", (ctx) => {
    ctx.reply(`${ASSISTANT_NAME} is online.`);
  });

  bot.on("message:text", async (ctx) => {
    // Skip commands
    if (ctx.message.text.startsWith("/")) return;

    const chatId = `tg:${ctx.chat.id}`;
    const content = ctx.message.text;
    const timestamp = new Date(ctx.message.date * 1000).toISOString();
    const senderName =
      ctx.from?.first_name ||
      ctx.from?.username ||
      ctx.from?.id.toString() ||
      "Unknown";
    const sender = ctx.from?.id.toString() || "";
    const msgId = ctx.message.message_id.toString();

    // Determine chat name
    const chatName =
      ctx.chat.type === "private"
        ? senderName
        : (ctx.chat as any).title || chatId;

    // Store chat metadata for discovery
    storeChatMetadata(chatId, timestamp, chatName);

    // Check if this chat is registered
    const registeredGroups = callbacks!.getRegisteredGroups();
    const group = registeredGroups[chatId];

    if (!group) {
      logger.debug(
        { chatId, chatName },
        "Message from unregistered Telegram chat",
      );
      return;
    }

    // Store message for registered chats
    storeMessageDirect({
      id: msgId,
      chat_jid: chatId,
      sender,
      sender_name: senderName,
      content,
      timestamp,
      is_from_me: false,
    });

    const isMain = group.folder === MAIN_GROUP_FOLDER;

    // Check trigger pattern (main responds to all, others need trigger)
    if (!isMain && !TRIGGER_PATTERN.test(content)) {
      return;
    }

    logger.info(
      { chatId, chatName, sender: senderName },
      "Processing Telegram message",
    );

    // Send typing indicator
    await ctx.replyWithChatAction("typing");

    const msg: NewMessage = {
      id: msgId,
      chat_jid: chatId,
      sender,
      sender_name: senderName,
      content,
      timestamp,
    };

    try {
      const response = await callbacks!.onMessage(msg, group);
      if (response) {
        await ctx.reply(`${ASSISTANT_NAME}: ${response}`);
      }
    } catch (err) {
      logger.error({ err, chatId }, "Error processing Telegram message");
    }
  });

  // Handle errors gracefully
  bot.catch((err) => {
    logger.error({ err: err.message }, "Telegram bot error");
  });

  // Start polling
  bot.start({
    onStart: (botInfo) => {
      logger.info(
        { username: botInfo.username, id: botInfo.id },
        "Telegram bot connected",
      );
      console.log(`\n  Telegram bot: @${botInfo.username}`);
      console.log(
        `  Send /chatid to the bot to get a chat's registration ID\n`,
      );
    },
  });
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<void> {
  if (!bot) {
    logger.warn("Telegram bot not initialized");
    return;
  }

  try {
    // Remove tg: prefix if present
    const numericId = chatId.replace(/^tg:/, "");
    await bot.api.sendMessage(numericId, text);
    logger.info({ chatId, length: text.length }, "Telegram message sent");
  } catch (err) {
    logger.error({ chatId, err }, "Failed to send Telegram message");
  }
}

export function isTelegramConnected(): boolean {
  return bot !== null;
}

export function stopTelegram(): void {
  if (bot) {
    bot.stop();
    bot = null;
    callbacks = null;
    logger.info("Telegram bot stopped");
  }
}
