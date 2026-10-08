// @ts-check
/**
 * @typedef {Object} SeriesResult
 * @property {string} winnerId
 * @property {number} scoreA     Games won by teamA (not by the winner).
 * @property {number} scoreB     Games won by teamB.
 */

/**
 * The game engine. Given two teams and a best-of length, it plays the series
 * (calling the rating and stats code game by game) and returns the result.
 * @typedef {(teamA: string, teamB: string, bestOf: number, match: import("./models.js").Match) => SeriesResult} SeriesResolver
 */

import { finalWinner } from "./models.js";

/**
 * Plays one match between two known teams and records the result on it.
 * @param {import("./models.js").Match} match
 * @param {string} teamA
 * @param {string} teamB
 * @param {SeriesResolver} playSeries
 */
export function playMatch(match, teamA, teamB, playSeries) {
  const r = playSeries(teamA, teamB, match.bestOf, match);
  if (r.winnerId !== teamA && r.winnerId !== teamB) {
    throw new Error(`playSeries returned an unknown winner for ${match.id}`);
  }
  match.teamA = teamA;
  match.teamB = teamB;
  match.scoreA = r.scoreA;
  match.scoreB = r.scoreB;
  match.winnerId = r.winnerId;
  match.loserId = r.winnerId === teamA ? teamB : teamA;
  match.status = "done";
  return match;
}

/**
 * Plays a bracket in the order of its matches. Each team is resolved from its source at play time.
 * `keys` maps the keys used by "key" sources (seeds, group places...) to team ids.
 * @param {import("./models.js").Match[]} matches
 * @param {{ keys: Record<string, string>, playSeries: SeriesResolver, onMatch?: (m: import("./models.js").Match) => void }} opts
 * @returns {string[]} Teams eliminated by this bracket, first out first.
 */
export function playBracket(matches, { keys, playSeries, onMatch }) {
  const byId = new Map(matches.map((m) => [m.id, m]));
  /** @type {string[]} */
  const eliminated = [];

  /** @param {import("./models.js").Source} src */
  const resolve = (src) => {
    if (src.type === "key") {
      if (!(src.key in keys)) throw new Error(`Unknown key ${src.key}`);
      return keys[src.key];
    }
    const ref = byId.get(src.matchId);
    if (!ref || ref.status !== "done") throw new Error(`Match ${src.matchId} not played yet`);
    return src.type === "winner" ? /** @type {string} */ (ref.winnerId) : /** @type {string} */ (ref.loserId);
  };

  for (const m of matches) {
    playMatch(m, resolve(m.sourceA), resolve(m.sourceB), playSeries);
    // A loser with no next match is out of the bracket.
    if (m.loserNextMatchId === null && m.loserId) eliminated.push(m.loserId);
    onMatch?.(m);
  }
  return eliminated;
}

/**
 * Full ranking from a champion and the elimination order.
 * The last team eliminated is 2nd, the first one out is last.
 * @param {string} championId
 * @param {string[]} eliminated
 * @returns {string[]}
 */
export function rankingOf(championId, eliminated) {
  return [championId, ...[...eliminated].reverse()];
}

/**
 * Game difference (games won minus games lost) of one team across the given matches.
 * Used to break ties inside a placement tier.
 * @param {import("./models.js").Match[]} matches
 * @param {string} teamId
 * @returns {number}
 */
export function gameDiffIn(matches, teamId) {
  let diff = 0;
  for (const m of matches) {
    if (m.status !== "done") continue;
    if (m.teamA === teamId) diff += m.scoreA - m.scoreB;
    else if (m.teamB === teamId) diff += m.scoreB - m.scoreA;
  }
  return diff;
}

export { finalWinner };