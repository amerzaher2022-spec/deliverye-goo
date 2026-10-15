// Cancelling a mission: free for an accidental accept, then it costs coins.
import { describe, expect, it } from 'vitest';
import { cancelPenalty, CANCEL_GRACE_S } from '../shared/rules';

describe('mission cancel penalty', () => {
  const t0 = Date.parse('2026-10-14T12:00:00Z');
  const run = (collected: boolean, reward = 60) => ({ reward_coins: reward, accepted_at: new Date(t0).toISOString(), collected_at: collected ? new Date(t0 + 60_000).toISOString() : null });
  it('is free within the grace period before collecting', () => {
    expect(cancelPenalty(run(false), t0 + (CANCEL_GRACE_S - 1) * 1000)).toBe(0);
  });
  it('costs 20 % of the reward (at least 5) after the grace period', () => {
    expect(cancelPenalty(run(false), t0 + (CANCEL_GRACE_S + 1) * 1000)).toBe(12);
    expect(cancelPenalty(run(false, 10), t0 + 120_000)).toBe(5);
  });
  it('costs half the reward once the order is collected, even right away', () => {
    expect(cancelPenalty(run(true), t0 + 61_000)).toBe(30);
  });
});
