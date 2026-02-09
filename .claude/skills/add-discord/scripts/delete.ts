/**
 * Discord Integration - Delete message
 */

import { fetchTextChannel, getReadyDiscordClient } from '../lib/discord.js';
import type { SkillResult } from '../lib/types.js';

export interface DeleteInput {
  channelId: string;
  messageId: string;
}

export async function deleteDiscordMessage(
  input: DeleteInput,
): Promise<SkillResult> {
  const ready = await getReadyDiscordClient();
  if ('error' in ready) return ready.error;

  try {
    const channelResult = await fetchTextChannel(ready.client, input.channelId);
    if ('success' in channelResult) return channelResult;
    const channel = channelResult;

    const message = await channel.messages.fetch(input.messageId);
    if (!message) {
      return {
        success: false,
        message: `Message ${input.messageId} not found`,
      };
    }

    await message.delete();
    return { success: true, message: `Message ${input.messageId} deleted` };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Failed to delete message: ${errorMsg}` };
  }
}
