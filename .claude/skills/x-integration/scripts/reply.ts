#!/usr/bin/env npx tsx
/**
 * X Integration - Reply to Tweet
 * Usage: echo '{"tweetUrl":"https://x.com/user/status/123","content":"Great post!"}' | npx tsx reply.ts
 */

import { getBrowserContext, navigateToTweet, navigateTo } from '../lib/browser.js';
import { runScript, ScriptResult } from '../lib/script.js';
import {
  validateTweetUrl,
  validateContent,
  validateImagePaths,
  getFirstTweet,
  clickTweetButton,
  fillDialogAndSubmit,
  captureProfileState,
  verifyNewTweet
} from '../lib/utils.js';
import { config } from '../lib/config.js';

const btn = config.selectors.buttons;

interface ReplyInput {
  tweetUrl: string;
  content: string;
  imagePaths?: string[];
}

async function replyToTweet(input: ReplyInput): Promise<ScriptResult> {
  const { tweetUrl, content, imagePaths } = input;

  const urlError = validateTweetUrl(tweetUrl);
  if (urlError) return urlError;

  const validationError = validateContent(content, 'Reply');
  if (validationError) return validationError;

  const imageError = validateImagePaths(imagePaths);
  if (imageError) return imageError;

  let context = null;
  try {
    context = await getBrowserContext();
    const { page, success, error } = await navigateToTweet(context, tweetUrl);

    if (!success) {
      return { success: false, message: error || 'Navigation failed' };
    }

    // Capture profile state before replying
    const state = await captureProfileState(page);
    if (!state) {
      return { success: false, message: 'Could not find profile link in sidebar' };
    }

    // Navigate back to tweet page
    await navigateTo(page, tweetUrl);

    // Click reply button
    const tweet = getFirstTweet(page);
    await clickTweetButton(tweet, btn.reply, page);

    // Fill dialog and submit
    const result = await fillDialogAndSubmit({
      page,
      content,
      contentLabel: 'Reply',
      imagePaths,
    });

    if (!result.success) {
      return { success: false, message: result.error || 'Failed to submit reply' };
    }

    // Verify by comparing profile before/after
    const newUrl = await verifyNewTweet(page, state);

    if (!newUrl) {
      return { success: false, message: 'Reply not posted: profile unchanged after replying' };
    }

    return { success: true, message: `Reply posted: ${newUrl}` };

  } finally {
    if (context) await context.close();
  }
}

runScript<ReplyInput>(replyToTweet);