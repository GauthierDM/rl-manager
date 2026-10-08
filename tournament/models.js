// @ts-check
/**
 * Shared data model for every tournament format.
 *
 * A Match is a series between two teams. At build time a match does not know its teams:
 * sourceA / sourceB say where each team comes from (a seed key, the winner of a match, the loser
 * of a match). Teams are filled in when the match is played, so a bracket is a plain graph.
 */

/**
 * @typedef {{ type: "key", key: string | number }
 *   | { type: "winner", matchId: string }
 *   | { type: "loser", matchId: string }} Source
 */

/**
 * @typedef {Object} Match
 * @property {string} id
 * @property {string} label
 * @property {number} round                 Round index inside its bracket, starting at 1.
 * @property {number} bestOf
 * @property {Source} sourceA
 * @property {Source} sourceB
 * @property {string|null} winnerNextMatchId
 * @property {string|null} loserNextMatchId
 * @property {string|null} teamA
 * @property {string|null} teamB
 * @property {number} scoreA                 Games won by teamA.
 * @property {number} scoreB                 Games won by teamB.
 * @property {string|null} winnerId
 * @property {string|null} loserId
 * @property {"pending"|"done"} status
 */

/**
 * @typedef {Object} Bracket
 * @property {string} id
 * @property {"swiss"|"elimination"|"gsl-group"|"hybrid"} kind
 * @property {Match[]} matches              Ordered: a match always comes after the matches feeding it.
 * @property {string|null} finalMatchId     Match deciding 1st place, when there is one.
 */

/**
 * @typedef {Object} TournamentStage
 * @property {string} id
 * @property {string} name
 * @property {Bracket[]} brackets
 * @property {string|null} championId
 * @property {string[]} ranking             Team ids, best first (16 for Opens, Majors and Worlds).
 */

/** @param {string | number} key @returns {Source} */
export const keySrc = (key) => ({ type: "key", key });
/** @param {string} matchId @returns {Source} */
export const winnerOf = (matchId) => ({ type: "winner", matchId });
/** @param {string} matchId @returns {Source} */
export const loserOf = (matchId) => ({ type: "loser", matchId });

/** @returns {Match} */
export function createMatch({ id, label, round, bestOf, sourceA, sourceB }) {
  return {
    id,
    label,
    round,
    bestOf,
    sourceA,
    sourceB,
    winnerNextMatchId: null,
    loserNextMatchId: null,
    teamA: null,
    teamB: null,
    scoreA: 0,
    scoreB: 0,
    winnerId: null,
    loserId: null,
    status: "pending",
  };
}

/**
 * Fills winnerNextMatchId / loserNextMatchId from the sources of the later matches.
 * Call once after the matches of a bracket are built.
 * @param {Match[]} matches
 * @returns {Match[]}
 */
export function wireMatches(matches) {
  const byId = new Map(matches.map((m) => [m.id, m]));
  for (const m of matches) {
    for (const src of [m.sourceA, m.sourceB]) {
      if (src.type === "key") continue;
      const from = byId.get(src.matchId);
      if (!from) throw new Error(`Unknown source match ${src.matchId} for ${m.id}`);
      if (src.type === "winner") from.winnerNextMatchId = m.id;
      else from.loserNextMatchId = m.id;
    }
  }
  return matches;
}

/**
 * Winner of the match that decides 1st place of a bracket.
 * @param {Bracket} bracket
 * @returns {string|null}
 */
export function finalWinner(bracket) {
  if (!bracket.finalMatchId) return null;
  return bracket.matches.find((m) => m.id === bracket.finalMatchId)?.winnerId ?? null;
}