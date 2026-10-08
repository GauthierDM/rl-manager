// @ts-check
// Run with: node tournament/test.js
import assert from "node:assert/strict";
import { playGslGroup } from "./gsl.js";
import { playSwissStage, playWorldsStage } from "./stages.js";
import { playSwiss } from "./swiss.js";

/** Fake series: each game is a coin flip, a series ends when one side reaches ceil(bo / 2). */
const fakeSeries = (rng) => (a, b, bestOf) => {
  const need = Math.ceil(bestOf / 2);
  let wa = 0;
  let wb = 0;
  while (wa < need && wb < need) (rng() < 0.5 ? wa++ : wb++);
  return { winnerId: wa === need ? a : b, scoreA: wa, scoreB: wb };
};

const teams = Array.from({ length: 16 }, (_, i) => `T${i + 1}`);
const playSeries = fakeSeries(Math.random);

for (let k = 0; k < 300; k++) {
  const swiss = playSwiss(teams, { playSeries });
  assert.equal(swiss.qualified.length, 8, "8 qualified");
  assert.equal(swiss.eliminated.length, 8, "8 eliminated");
  assert.equal(new Set([...swiss.qualified, ...swiss.eliminated]).size, 16, "every team exits once");

  const pairs = new Set();
  let rematches = 0;
  for (const m of swiss.bracket.matches) {
    const key = [m.teamA, m.teamB].sort().join("|");
    if (pairs.has(key)) rematches++;
    pairs.add(key);
  }
  assert.equal(rematches, swiss.forcedRematches, "rematches only when forced");
}

const open = playSwissStage("open", "Open", teams, { playSeries });
assert.equal(new Set(open.ranking).size, 16, "Open ranks 16 distinct teams");
assert.equal(open.ranking.length, 16);

const group = playGslGroup("A", teams.slice(0, 8), { playSeries });
assert.equal(new Set([group.first, group.second, group.third]).size, 3, "3 qualifiers");
const groupOut = [...group.out7, ...group.out9, ...group.out13];
assert.equal(groupOut.length, 5, "5 eliminated");
assert.equal(new Set([group.first, group.second, group.third, ...groupOut]).size, 8, "every group team placed once");

const worlds = playWorldsStage("worlds", "Worlds", teams, { playSeries });
assert.equal(new Set(worlds.ranking).size, 16, "Worlds ranks 16 distinct teams");

console.log("Tournament checks passed");