import { WebhookClient, type WebhookMessageCreateOptions } from 'discord.js';

import type { SkillResult } from '../lib/types.js';

export interface WebhookInput {
  webhookUrl: string;
  content: string;
  username?: string;
  avatarUrl?: string;
}

export async function sendDiscordWebhook(
  input: WebhookInput,
): Promise<SkillResult> {
  try {
    const webhook = new WebhookClient({ url: input.webhookUrl });

    const options: WebhookMessageCreateOptions = {
      content: input.content.slice(0, 2000),
    };
    if (input.username) options.username = input.username;
    if (input.avatarUrl) options.avatarURL = input.avatarUrl;

    await webhook.send(options);
    return { success: true, message: 'Webhook message sent' };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Failed to send webhook: ${errorMsg}` };
  }
}
