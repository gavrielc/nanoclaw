import { getReadyDiscordClient } from '../lib/discord.js';
import type { SkillResult } from '../lib/types.js';

export interface ListChannelsInput {
  guildId: string;
}

export async function listDiscordChannels(
  input: ListChannelsInput,
): Promise<SkillResult> {
  const ready = await getReadyDiscordClient();
  if ('error' in ready) return ready.error;

  try {
    const guild = await ready.client.guilds.fetch(input.guildId);
    if (!guild) {
      return { success: false, message: `Guild ${input.guildId} not found` };
    }

    const channels = await guild.channels.fetch();
    const channelList = channels.map((ch) => ({
      id: ch?.id,
      name: ch?.name,
      type: ch?.type,
    }));

    return {
      success: true,
      message: `Found ${channelList.length} channels`,
      data: channelList,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Failed to list channels: ${errorMsg}` };
  }
}
