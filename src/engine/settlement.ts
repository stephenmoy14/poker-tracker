import type { Cents, GameState, NetResult, Payment } from "./types";
import { isBetweenHands } from "./hand";

/**
 * Each player's result: final stack (or stack when they left) minus total
 * buy-ins. Includes players who left. Only available between hands, because
 * during a hand some chips are in the middle rather than in stacks.
 */
export function netResults(state: GameState): NetResult[] {
  if (!isBetweenHands(state)) throw new Error("Finish the current hand before settling up");
  const results = Object.values(state.players)
    .sort((a, b) => a.seat - b.seat || a.id.localeCompare(b.id))
    .map((p) => ({ playerId: p.id, net: p.stack - p.totalBuyIn }));
  const total = results.reduce((sum, r) => sum + r.net, 0);
  if (total !== 0) throw new Error(`Results don't balance (off by ${total} cents)`);
  return results;
}

/**
 * The fewest payments that settle everyone up.
 *
 * Plain language: every payment zeroes out at least one person, so with k
 * people who are up or down you never need more than k − 1 payments. You can
 * do better when the group splits into smaller groups that each balance on
 * their own (e.g. Ann is down $20 exactly what Ben is up). Each such group of
 * size m needs m − 1 payments, so the fewest payments is k minus the largest
 * number of separate balancing groups.
 *
 * Finding that largest number means trying combinations of people. That's
 * instant for a home game (we check all subsets for up to 18 people who are
 * up or down). Beyond that we fall back to the simple method: biggest loser
 * pays biggest winner, repeated, which is never more than k − 1 payments.
 *
 * Within each group, payments go biggest loser → biggest winner.
 */
export function settleUp(nets: readonly NetResult[]): Payment[] {
  const total = nets.reduce((sum, r) => sum + r.net, 0);
  if (total !== 0) throw new Error(`Results don't balance (off by ${total} cents)`);
  const people = nets.filter((r) => r.net !== 0);
  const groups = people.length <= EXACT_LIMIT ? balancingGroups(people) : [people];
  return groups.flatMap(payWithinGroup);
}

const EXACT_LIMIT = 18;

/** Splits people into the most groups that each sum to zero. */
function balancingGroups(people: readonly NetResult[]): NetResult[][] {
  const k = people.length;
  if (k === 0) return [];
  const size = 1 << k;
  const sum = new Array<number>(size).fill(0);
  for (let mask = 1; mask < size; mask++) {
    const low = mask & -mask;
    sum[mask] = sum[mask ^ low]! + people[31 - Math.clz32(low)]!.net;
  }
  // best[mask] = most zero-sum groups the people in `mask` can be split into,
  // counting a leftover remainder as part of the last group.
  const best = new Array<number>(size).fill(0);
  for (let mask = 1; mask < size; mask++) {
    let most = 0;
    for (let i = 0; i < k; i++) {
      if (mask & (1 << i)) most = Math.max(most, best[mask ^ (1 << i)]!);
    }
    best[mask] = most + (sum[mask] === 0 ? 1 : 0);
  }
  // Walk back from everyone, removing one person at a time along an optimal
  // path. Each time the remaining set balances, the people removed since the
  // last balancing point form one group.
  const groups: NetResult[][] = [];
  let mask = size - 1;
  let current: NetResult[] = [];
  while (mask) {
    const target = best[mask]! - (sum[mask] === 0 ? 1 : 0);
    let pick = -1;
    for (let i = 0; i < k; i++) {
      if (mask & (1 << i) && best[mask ^ (1 << i)] === target) {
        pick = i;
        break;
      }
    }
    if (sum[mask] === 0 && current.length) {
      groups.push(current);
      current = [];
    }
    current.push(people[pick]!);
    mask ^= 1 << pick;
  }
  groups.push(current);
  return groups;
}

function payWithinGroup(group: readonly NetResult[]): Payment[] {
  const owes = group.filter((r) => r.net < 0).map((r) => ({ id: r.playerId, left: -r.net }));
  const gets = group.filter((r) => r.net > 0).map((r) => ({ id: r.playerId, left: r.net }));
  const payments: Payment[] = [];
  for (;;) {
    owes.sort(byLeft);
    gets.sort(byLeft);
    const debtor = owes.find((o) => o.left > 0);
    const creditor = gets.find((g) => g.left > 0);
    if (!debtor || !creditor) break;
    const amount: Cents = Math.min(debtor.left, creditor.left);
    payments.push({ from: debtor.id, to: creditor.id, amount });
    debtor.left -= amount;
    creditor.left -= amount;
  }
  return payments;
}

// Largest first; stable, so ties keep seat order.
const byLeft = (a: { left: number }, b: { left: number }) => b.left - a.left;

/** Convenience for the settlement screen. */
export function settlement(state: GameState): { nets: NetResult[]; payments: Payment[] } {
  const nets = netResults(state);
  return { nets, payments: settleUp(nets) };
}
