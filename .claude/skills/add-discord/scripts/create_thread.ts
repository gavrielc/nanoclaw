import type { ThreadAutoArchiveDuration, ThreadChannel } from 'discord.js';

import { fetchTextChannel, getReadyDiscordClient } from '../lib/discord.js';
import type { SkillResult } from '../lib/types.js';

export interface CreateThreadInput {
  channelId: string;
  name: string;
  messageId?: string;
  autoArchiveDuration?: ThreadAutoArchiveDuration;
}

export async function createDiscordThread(
  input: CreateThreadInput,
): Promise<SkillResult> {
  const ready = await getReadyDiscordClient();
  if ('error' in ready) return ready.error;

  try {
    const channelResult = await fetchTextChannel(ready.client, input.channelId);
    if ('success' in channelResult) return channelResult;
    const channel = channelResult;

    let thread: ThreadChannel;
    if (input.messageId) {
      const message = await channel.messages.fetch(input.messageId);
      thread = await message.startThread({
        name: input.name,
        autoArchiveDuration: input.autoArchiveDuration,
      });
    } else {
      thread = await channel.threads.create({
        name: input.name,
        autoArchiveDuration: input.autoArchiveDuration,
      });
    }

    return {
      success: true,
      message: `Thread created: ${thread.name}`,
      data: { id: thread.id, name: thread.name },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Failed to create thread: ${errorMsg}` };
  }
}
