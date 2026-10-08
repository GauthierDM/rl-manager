// @ts-check
import { FORMATS } from "./formats.js";
import { createMatch, keySrc, loserOf, winnerOf, wireMatches } from "./models.js";
import { playBracket } from "./runner.js";

/**
 * One GSL group: 8 teams, double elimination, no grand final.
 * teamIds[0] is seed 1; first round is 1v2, 3v4, 5v6, 7v8.
 *
 * Upper: U1-U4 -> upper semis -> upper final (winner = place 1, loser = place 2).
 * Lower: losers of U1-U4 play Lower R1, losers of upper semis meet Lower R1 survivors (Lower R2),
 *        then the Lower R2 winners play the qualifier (winner = place 3).
 *
 * @param {string} groupId       "A" or "B", used as a prefix for match ids.
 * @param {string[]} teamIds
 */
export function buildGslGroup(groupId, teamIds) {
  if (teamIds.length !== 8) throw new Error(`GSL group ${groupId} needs 8 teams`);
  const f = FORMATS.gslGroup;
  const p = (/** @type {string} */ id) => `${groupId}-${id}`;
  const t = (/** @type {number} */ i) => keySrc(teamIds[i]);
  const w = (/** @type {string} */ id) => winnerOf(p(id));
  const l = (/** @type {string} */ id) => loserOf(p(id));
  const M = (/** @type {string} */ id, /** @type {string} */ label, /** @type {number} */ round, /** @type {number} */ bo, /** @type {any} */ a, /** @type {any} */ b) =>
    createMatch({ id: p(id), label, round, bestOf: bo, sourceA: a, sourceB: b });

  const matches = [
    M("u1", "Upper round 1", 1, f.regular, t(0), t(1)),
    M("u2", "Upper round 1", 1, f.regular, t(2), t(3)),
    M("u3", "Upper round 1", 1, f.regular, t(4), t(5)),
    M("u4", "Upper round 1", 1, f.regular, t(6), t(7)),
    M("l1a", "Lower round 1 (a)", 1, f.regular, l("u1"), l("u2")),
    M("l1b", "Lower round 1 (b)", 1, f.regular, l("u3"), l("u4")),
    M("us1", "Upper semi 1", 2, f.regular, w("u1"), w("u2")),
    M("us2", "Upper semi 2", 2, f.regular, w("u3"), w("u4")),
    M("uf", "Upper final", 3, f.upperFinal, w("us1"), w("us2")),
    M("l2a", "Lower round 2 (a)", 2, f.regular, l("us1"), w("l1a")),
    M("l2b", "Lower round 2 (b)", 2, f.regular, l("us2"), w("l1b")),
    M("l3", "Lower round 3 (qualifier)", 3, f.qualifier, w("l2a"), w("l2b")),
  ];
  return {
    id: `gsl-${groupId}`,
    kind: /** @type {const} */ ("gsl-group"),
    matches: wireMatches(matches),
    finalMatchId: null,
  };
}

/**
 * Plays one GSL group.
 * Places: 1 = upper final winner, 2 = upper final loser, 3 = qualifier winner.
 * Eliminated teams are grouped by exit round, so the stage can rank them without re-reading the bracket:
 *   out7  : lost the qualifier (7th-8th)
 *   out9  : lost Lower R2 (9th-12th)
 *   out13 : lost Lower R1 (13th-16th)
 * @param {string} groupId
 * @param {string[]} teamIds
 * @param {{ playSeries: import("./runner.js").SeriesResolver, onMatch?: (m: import("./models.js").Match) => void }} opts
 */
export function playGslGroup(groupId, teamIds, { playSeries, onMatch }) {
  const bracket = buildGslGroup(groupId, teamIds);
  const keys = Object.fromEntries(teamIds.map((id) => [id, id]));
  playBracket(bracket.matches, { keys, playSeries, onMatch });

  const byId = new Map(bracket.matches.map((m) => [m.id, m]));
  const g = (/** @type {string} */ id) => /** @type {import("./models.js").Match} */ (byId.get(`${groupId}-${id}`));
  const lost = (/** @type {string} */ id) => /** @type {string} */ (g(id).loserId);

  return {
    bracket,
    first: /** @type {string} */ (g("uf").winnerId),
    second: lost("uf"),
    third: /** @type {string} */ (g("l3").winnerId),
    out7: [lost("l3")],
    out9: [lost("l2a"), lost("l2b")],
    out13: [lost("l1a"), lost("l1b")],
  };
}