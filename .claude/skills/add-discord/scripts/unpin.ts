import { fetchTextChannel, getReadyDiscordClient } from '../lib/discord.js';
import { formatDiscordError, type SkillResult } from '../lib/types.js';

export interface UnpinInput {
  channelId: string;
  messageId: string;
}

export async function unpinDiscordMessage(
  input: UnpinInput,
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

    await message.unpin();
    return { success: true, message: `Message ${input.messageId} unpinned` };
  } catch (err) {
    return formatDiscordError(err, 'Failed to unpin message');
  }
}
