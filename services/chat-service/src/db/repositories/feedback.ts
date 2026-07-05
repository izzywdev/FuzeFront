// feedback.ts — chat_feedback repository (plan §6e). user_id is always the
// authenticated caller's id from the JWT (§10d), never a request-body field.

import type { Knex } from 'knex';

export type FeedbackRating = 'positive' | 'negative';

const TABLE = 'chat_feedback';

export class FeedbackRepository {
  constructor(private readonly knex: Knex) {}

  async submit(messageId: string, userId: string, rating: FeedbackRating): Promise<void> {
    await this.knex(TABLE).insert({
      message_id: messageId,
      user_id: userId,
      rating,
    });
  }
}
