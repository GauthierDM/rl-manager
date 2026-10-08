// @ts-check
import { FORMATS } from "./formats.js";
import { createMatch, keySrc, loserOf, winnerOf, wireMatches } from "./models.js";

/**
 * Worlds playoffs, Top 6 hybrid bracket. Keys: A1, A2, A3, B1, B2, B3 (group places).
 *
 * Upper match:  A1 vs B1. Winner goes to the grand final, loser drops to the lower final.
 * Lower R1:     A2 vs B3 and B2 vs A3 (losers are 5th-6th).
 * Lower R2:     the two Lower R1 winners play (loser is 4th).
 * Lower final:  Lower R2 winner vs the upper match loser (loser is 3rd).
 * Grand final:  upper match winner vs lower final winner, Bo7, no reset.
 *
 * Match ids: hu1, hl1a, hl1b, hl2, hlf, gf.
 */
export function buildHybridTop6() {
  const f = FORMATS.hybrid;
  const M = (/** @type {string} */ id, /** @type {string} */ label, /** @type {number} */ round, /** @type {number} */ bo, /** @type {any} */ a, /** @type {any} */ b) =>
    createMatch({ id, label, round, bestOf: bo, sourceA: a, sourceB: b });

  const matches = [
    M("hu1", "Upper match", 1, f.upperMatch, keySrc("A1"), keySrc("B1")),
    M("hl1a", "Lower round 1 (a)", 1, f.lowerRound1, keySrc("A2"), keySrc("B3")),
    M("hl1b", "Lower round 1 (b)", 1, f.lowerRound1, keySrc("B2"), keySrc("A3")),
    M("hl2", "Lower round 2", 2, f.lowerRound2, winnerOf("hl1a"), winnerOf("hl1b")),
    M("hlf", "Lower final", 3, f.lowerFinal, winnerOf("hl2"), loserOf("hu1")),
    M("gf", "Grand final", 4, f.grandFinal, winnerOf("hu1"), winnerOf("hlf")),
  ];
  return {
    id: "hybrid",
    kind: /** @type {const} */ ("hybrid"),
    matches: wireMatches(matches),
    finalMatchId: "gf",
  };
}