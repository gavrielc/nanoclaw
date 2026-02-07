import { getReadyDiscordClient } from '../lib/discord.js';
import type { SkillResult } from '../lib/types.js';

export interface ListMembersInput {
  guildId: string;
  limit: number;
}

export async function listDiscordMembers(
  input: ListMembersInput,
): Promise<SkillResult> {
  const ready = await getReadyDiscordClient();
  if ('error' in ready) return ready.error;

  try {
    const guild = await ready.client.guilds.fetch(input.guildId);
    if (!guild) {
      return { success: false, message: `Guild ${input.guildId} not found` };
    }

    const members = await guild.members.fetch({ limit: input.limit });
    const memberList = members.map((member) => ({
      id: member.id,
      username: member.user.username,
      nickname: member.nickname,
      roles: member.roles.cache.map((role) => role.name),
      joinedAt: member.joinedAt?.toISOString(),
    }));

    return {
      success: true,
      message: `Found ${memberList.length} members`,
      data: memberList,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Failed to list members: ${errorMsg}` };
  }
}
