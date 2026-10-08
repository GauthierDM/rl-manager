// @ts-check
import { buildTop8 } from "./elimination.js";
import { buildHybridTop6 } from "./hybrid.js";
import { playGslGroup } from "./gsl.js";
import { finalWinner } from "./models.js";
import { gameDiffIn, playBracket, rankingOf } from "./runner.js";
import { playSwiss } from "./swiss.js";

/**
 * @typedef {Object} StageOptions
 * @property {import("./runner.js").SeriesResolver} playSeries
 * @property {(m: import("./models.js").Match) => void} [onMatch]
 * @property {() => number} [rng]
 */

/**
 * Open or Major: 16 teams, Swiss, then Top 8 playoffs.
 * @param {string} id
 * @param {string} name
 * @param {string[]} teamIds   Seed order, 16 teams.
 * @param {StageOptions} opts
 * @returns {import("./models.js").TournamentStage & { forcedRematches: number }}
 */
export function playSwissStage(id, name, teamIds, opts) {
  if (teamIds.length !== 16) throw new Error(`${name} needs 16 teams, got ${teamIds.length}`);

  const swiss = playSwiss(teamIds, opts);
  const playoffs = buildTop8();
  const keys = Object.fromEntries(swiss.qualified.map((teamId, i) => [i + 1, teamId]));
  const eliminated = playBracket(playoffs.matches, { keys, playSeries: opts.playSeries, onMatch: opts.onMatch });

  const championId = finalWinner(playoffs);
  if (!championId) throw new Error(`${name}: no champion`);

  return {
    id,
    name,
    brackets: [swiss.bracket, playoffs],
    championId,
    ranking: [...rankingOf(championId, eliminated), ...swiss.eliminated],
    forcedRematches: swiss.forcedRematches,
  };
}

/**
 * World Championship: two GSL groups of 8, then the Top 6 hybrid playoffs.
 * Groups are split by serpentine seeding:
 *   A = seeds 1, 4, 5, 8, 9, 12, 13, 16
 *   B = seeds 2, 3, 6, 7, 10, 11, 14, 15
 * Places 7 to 16 come from the group exits (by exit round), ties broken by game difference.
 * @param {string} id
 * @param {string} name
 * @param {string[]} teamIds   Seed order, 16 teams.
 * @param {StageOptions} opts
 * @returns {import("./models.js").TournamentStage}
 */
export function playWorldsStage(id, name, teamIds, opts) {
  if (teamIds.length !== 16) throw new Error(`${name} needs 16 teams, got ${teamIds.length}`);

  const groupA = teamIds.filter((_, i) => i % 4 === 0 || i % 4 === 3);
  const groupB = teamIds.filter((_, i) => i % 4 === 1 || i % 4 === 2);
  const a = playGslGroup("A", groupA, opts);
  const b = playGslGroup("B", groupB, opts);

  const hybrid = buildHybridTop6();
  const keys = { A1: a.first, A2: a.second, A3: a.third, B1: b.first, B2: b.second, B3: b.third };
  playBracket(hybrid.matches, { keys, playSeries: opts.playSeries, onMatch: opts.onMatch });

  const championId = finalWinner(hybrid);
  if (!championId) throw new Error(`${name}: no champion`);

  const byId = new Map(hybrid.matches.map((m) => [m.id, m]));
  const lostIn = (/** @type {string} */ mid) => /** @type {string} */ (byId.get(mid)?.loserId);

  // Every match of the Worlds, used for game-difference tie-breaks.
  const allMatches = [...a.bracket.matches, ...b.bracket.matches, ...hybrid.matches];
  /** @param {string[]} teams */
  const byDiff = (teams) => [...teams].sort((x, y) => gameDiffIn(allMatches, y) - gameDiffIn(allMatches, x));

  const ranking = [
    championId,
    lostIn("gf"),          // 2nd: grand final loser
    lostIn("hlf"),         // 3rd: lower final loser
    lostIn("hl2"),         // 4th: hybrid lower R2 loser
    ...byDiff([lostIn("hl1a"), lostIn("hl1b")]),       // 5th-6th
    ...byDiff([...a.out7, ...b.out7]),                 // 7th-8th
    ...byDiff([...a.out9, ...b.out9]),                 // 9th-12th
    ...byDiff([...a.out13, ...b.out13]),               // 13th-16th
  ];

  return {
    id,
    name,
    brackets: [a.bracket, b.bracket, hybrid],
    championId,
    ranking,
  };
}