// feedback.test.ts — feedback repo stamps user_id from the JWT (§10d).

import { FeedbackRepository } from '../../../src/db/repositories/feedback';

function makeKnex() {
  const state: any = {};
  const qb: any = {
    insert: jest.fn((row: any) => {
      state.inserted = row;
      return Promise.resolve([1]);
    }),
  };
  const knex: any = jest.fn(() => qb);
  return { knex, qb, state };
}

describe('FeedbackRepository.submit', () => {
  it('inserts message_id, user_id, rating', async () => {
    const { knex, state } = makeKnex();
    const repo = new FeedbackRepository(knex);
    await repo.submit('m1', 'user-1', 'positive');
    expect(state.inserted).toEqual({ message_id: 'm1', user_id: 'user-1', rating: 'positive' });
  });
});
