/**
 * Discord Integration - Pin message
 */

import { fetchTextChannel, getReadyDiscordClient } from '../lib/discord.js';
import { formatDiscordError, type SkillResult } from '../lib/types.js';

export interface PinInput {
  channelId: string;
  messageId: string;
}

export async function pinDiscordMessage(input: PinInput): Promise<SkillResult> {
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

    await message.pin();
    return { success: true, message: `Message ${input.messageId} pinned` };
  } catch (err) {
    return formatDiscordError(err, 'Failed to pin message');
  }
}
