/**
 * Discord Integration - Add reaction
 */

import { fetchTextChannel, getReadyDiscordClient } from '../lib/discord.js';
import { formatDiscordError, type SkillResult } from '../lib/types.js';

export interface ReactInput {
  channelId: string;
  messageId: string;
  emoji: string;
}

export async function addDiscordReaction(
  input: ReactInput,
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

    await message.react(input.emoji);
    return {
      success: true,
      message: `Reaction ${input.emoji} added to message ${input.messageId}`,
    };
  } catch (err) {
    return formatDiscordError(err, 'Failed to add reaction');
  }
}
