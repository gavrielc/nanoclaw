import { getReadyDiscordClient } from '../lib/discord.js';
import type { SkillResult } from '../lib/types.js';

export interface GetGuildInfoInput {
  guildId: string;
}

export async function getDiscordGuildInfo(
  input: GetGuildInfoInput,
): Promise<SkillResult> {
  const ready = await getReadyDiscordClient();
  if ('error' in ready) return ready.error;

  try {
    const guild = await ready.client.guilds.fetch(input.guildId);
    if (!guild) {
      return { success: false, message: `Guild ${input.guildId} not found` };
    }

    return {
      success: true,
      message: 'Guild info retrieved',
      data: {
        id: guild.id,
        name: guild.name,
        description: guild.description,
        memberCount: guild.memberCount,
        ownerId: guild.ownerId,
        createdAt: guild.createdAt.toISOString(),
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Failed to get guild info: ${errorMsg}`,
    };
  }
}
