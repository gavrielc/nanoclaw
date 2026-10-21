import type { Migration } from './index.js';

/**
 * `card_message_id` on `pending_channel_approvals`: the card a registration's
 * question currently lives on. The question moves to a second card with new
 * options (the agent choice) under the same id, so only a click from this
 * card may count. NULL = not recorded (an adapter that returns no id, or a row
 * from before this column): no check. '' = a new card is on its way.
 */
export const migration029: Migration = {
  version: 29,
  name: 'channel-approval-card-message',
  async up(db) {
    await db.exec(`ALTER TABLE pending_channel_approvals ADD COLUMN card_message_id TEXT;`);
  },
};
