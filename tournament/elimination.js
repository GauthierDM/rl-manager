// @ts-check
import { FORMATS } from "./formats.js";
import { createMatch, keySrc, winnerOf, wireMatches } from "./models.js";

/**
 * @param {string} id
 * @param {string} label
 * @param {number} round
 * @param {number} bestOf
 * @param {import("./models.js").Source} sourceA
 * @param {import("./models.js").Source} sourceB
 */
const M = (id, label, round, bestOf, sourceA, sourceB) =>
  createMatch({ id, label, round, bestOf, sourceA, sourceB });

/**
 * Top 8 single elimination, fed by Swiss seeds 1 to 8.
 * Quarter-finals: 1v8, 4v5, 2v7, 3v6. Semis: QF1 vs QF2, QF3 vs QF4.
 */
export function buildTop8() {
  const f = FORMATS.playoffs;
  const matches = [
    M("qf1", "Quarter-final 1", 1, f.quarter, keySrc(1), keySrc(8)),
    M("qf2", "Quarter-final 2", 1, f.quarter, keySrc(4), keySrc(5)),
    M("qf3", "Quarter-final 3", 1, f.quarter, keySrc(2), keySrc(7)),
    M("qf4", "Quarter-final 4", 1, f.quarter, keySrc(3), keySrc(6)),
    M("sf1", "Semi-final 1", 2, f.semi, winnerOf("qf1"), winnerOf("qf2")),
    M("sf2", "Semi-final 2", 2, f.semi, winnerOf("qf3"), winnerOf("qf4")),
    M("final", "Final", 3, f.final, winnerOf("sf1"), winnerOf("sf2")),
  ];
  return {
    id: "top8",
    kind: /** @type {const} */ ("elimination"),
    matches: wireMatches(matches),
    finalMatchId: "final",
  };
}