import { getReadyDiscordClient } from '../lib/discord.js';
import type { SkillResult } from '../lib/types.js';

export interface DmInput {
  userId: string;
  content: string;
}

export async function sendDiscordDM(input: DmInput): Promise<SkillResult> {
  const ready = await getReadyDiscordClient();
  if ('error' in ready) return ready.error;

  try {
    const user = await ready.client.users.fetch(input.userId);
    if (!user) {
      return { success: false, message: `User ${input.userId} not found` };
    }

    await user.send(input.content.slice(0, 2000));
    return { success: true, message: `DM sent to ${user.username}` };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Failed to send DM: ${errorMsg}` };
  }
}
