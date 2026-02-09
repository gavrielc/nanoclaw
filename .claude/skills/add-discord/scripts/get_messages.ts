import { fetchTextChannel, getReadyDiscordClient } from '../lib/discord.js';
import type { SkillResult } from '../lib/types.js';

export interface GetMessagesInput {
  channelId: string;
  limit: number;
  before?: string;
}

export async function getDiscordMessages(
  input: GetMessagesInput,
): Promise<SkillResult> {
  const ready = await getReadyDiscordClient();
  if ('error' in ready) return ready.error;

  try {
    const channelResult = await fetchTextChannel(ready.client, input.channelId);
    if ('success' in channelResult) return channelResult;
    const channel = channelResult;

    const options: { limit: number; before?: string } = { limit: input.limit };
    if (input.before) options.before = input.before;

    const messages = await channel.messages.fetch(options);
    const messageList = messages.map((msg) => ({
      id: msg.id,
      author: {
        id: msg.author.id,
        username: msg.author.username,
        bot: msg.author.bot,
      },
      content: msg.content,
      timestamp: msg.createdAt.toISOString(),
      edited: msg.editedAt?.toISOString() || null,
    }));

    return {
      success: true,
      message: `Retrieved ${messageList.length} messages`,
      data: messageList,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Failed to fetch messages: ${errorMsg}` };
  }
}
