// @ts-check
import { FORMATS } from "./formats.js";
import { createMatch, keySrc } from "./models.js";
import { playMatch } from "./runner.js";

const WINS_TO_QUALIFY = 3;
const LOSSES_TO_ELIMINATE = 3;

/**
 * @typedef {Object} SwissRecord
 * @property {string} id
 * @property {number} seed          Initial seed, 1 = best.
 * @property {number} draw          Random tie-break, used for pairing only.
 * @property {number} wins
 * @property {number} losses
 * @property {number} gamesWon
 * @property {number} gamesLost
 * @property {string[]} opponents
 * @property {number} buchholz      Sum of the final wins of the opponents, set at the end.
 */

const gameDiff = (/** @type {SwissRecord} */ r) => r.gamesWon - r.gamesLost;
const pairKey = (/** @type {string} */ a, /** @type {string} */ b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Standings: wins, then game diff, then Buchholz, then initial seed. */
export const compareStandings = (/** @type {SwissRecord} */ a, /** @type {SwissRecord} */ b) =>
  b.wins - a.wins || gameDiff(b) - gameDiff(a) || b.buchholz - a.buchholz || a.seed - b.seed;

/**
 * Pairs teams that share the same record, avoiding rematches.
 * Backtracks until it finds a rematch-free pairing, or returns null.
 * @param {SwissRecord[]} list
 * @param {Set<string>} played
 * @returns {Array<[SwissRecord, SwissRecord]> | null}
 */
function pairWithin(list, played) {
  if (list.length === 0) return [];
  const [first, ...rest] = list;
  for (let i = 0; i < rest.length; i++) {
    const other = rest[i];
    if (played.has(pairKey(first.id, other.id))) continue;
    const tail = pairWithin(rest.filter((_, j) => j !== i), played);
    if (tail) return [[first, other], ...tail];
  }
  return null;
}

/**
 * Pairs one Swiss round. Teams are grouped by record (2-0 with 2-0, 1-1 with 1-1, ...),
 * best game diff first inside a group. If no rematch-free pairing exists (rare), a rematch
 * is allowed and counted in `forced`.
 * @param {SwissRecord[]} active
 * @param {Set<string>} played
 * @returns {{ pairs: Array<[SwissRecord, SwissRecord]>, forced: number }}
 */
export function pairSwissRound(active, played) {
  /** @type {Map<string, { wins: number, list: SwissRecord[] }>} */
  const groups = new Map();
  for (const r of active) {
    const key = `${r.wins}-${r.losses}`;
    if (!groups.has(key)) groups.set(key, { wins: r.wins, list: [] });
    groups.get(key)?.list.push(r);
  }
  const ordered = [...groups.values()].sort((a, b) => b.wins - a.wins);

  /** @type {Array<[SwissRecord, SwissRecord]>} */
  const pairs = [];
  let forced = 0;
  for (const { list } of ordered) {
    const sorted = [...list].sort((a, b) => gameDiff(b) - gameDiff(a) || a.draw - b.draw);
    let paired = pairWithin(sorted, played);
    if (!paired) {
      forced++;
      paired = pairWithin(sorted, new Set()) ?? [];
    }
    pairs.push(...paired);
  }
  return { pairs, forced };
}

/**
 * Plays a full Swiss stage for 16 teams: 3 wins qualify (top 8), 3 losses are eliminated.
 * @param {string[]} teamIds                       Seed order, index 0 = seed 1.
 * @param {{ playSeries: import("./runner.js").SeriesResolver, onMatch?: (m: import("./models.js").Match) => void, rng?: () => number, bestOf?: number }} opts
 */
export function playSwiss(teamIds, { playSeries, onMatch, rng = Math.random, bestOf = FORMATS.swissStage }) {
  /** @type {Map<string, SwissRecord>} */
  const records = new Map(
    teamIds.map((id, i) => [
      id,
      { id, seed: i + 1, draw: rng(), wins: 0, losses: 0, gamesWon: 0, gamesLost: 0, opponents: [], buchholz: 0 },
    ])
  );
  const played = new Set();
  const matches = [];
  /** @type {SwissRecord[]} */
  const qualifiedOrder = [];
  /** @type {SwissRecord[]} */
  const eliminatedOrder = [];
  let forcedRematches = 0;
  let round = 0;
  let active = [...records.values()];

  while (active.length > 0) {
    round++;
    const { pairs, forced } = pairSwissRound(active, played);
    forcedRematches += forced;

    pairs.forEach(([a, b], i) => {
      const m = createMatch({
        id: `swiss-r${round}-${i + 1}`,
        label: `Round ${round}`,
        round,
        bestOf,
        sourceA: keySrc(a.id),
        sourceB: keySrc(b.id),
      });
      playMatch(m, a.id, b.id, playSeries);
      matches.push(m);
      onMatch?.(m);

      played.add(pairKey(a.id, b.id));
      a.gamesWon += m.scoreA;
      a.gamesLost += m.scoreB;
      b.gamesWon += m.scoreB;
      b.gamesLost += m.scoreA;
      a.opponents.push(b.id);
      b.opponents.push(a.id);
      if (m.winnerId === a.id) {
        a.wins++;
        b.losses++;
      } else {
        b.wins++;
        a.losses++;
      }
    });

    for (const r of active) {
      if (r.wins === WINS_TO_QUALIFY) qualifiedOrder.push(r);
      else if (r.losses === LOSSES_TO_ELIMINATE) eliminatedOrder.push(r);
    }
    active = active.filter((r) => r.wins < WINS_TO_QUALIFY && r.losses < LOSSES_TO_ELIMINATE);
  }

  for (const r of records.values()) {
    r.buchholz = r.opponents.reduce((sum, id) => sum + (records.get(id)?.wins ?? 0), 0);
  }
  const qualified = [...qualifiedOrder].sort(compareStandings);
  const eliminated = [...eliminatedOrder].sort(compareStandings);

  return {
    bracket: { id: "swiss", kind: /** @type {const} */ ("swiss"), matches, finalMatchId: null },
    /** Qualified teams, seed 1 first (index 0 = Swiss seed 1). */
    qualified: qualified.map((r) => r.id),
    /** Eliminated teams, best first (places 9 to 16). */
    eliminated: eliminated.map((r) => r.id),
    forcedRematches,
  };
}