import { randomUUID } from 'node:crypto';
import { InMemoryRepo } from '../in-memory-repo.js';
import { describeRepoContract } from '../contract.js';

describeRepoContract('InMemoryRepo', {
  async make() {
    return {
      repo: new InMemoryRepo(),
      household_id: randomUUID(),
      user_id: randomUUID(),
      other_user_id: randomUUID(),
    };
  },
});
