// @ts-check
// Run with: & "C:\Program Files\nodejs\node.exe" tournament/test.js
import assert from "node:assert/strict";
import { LcqStage, MajorStage, OpenStage, SwissStage, WorldsStage, serpentineGroups } from "./engine.js";

/** Fausse série : pile ou face par manche. */
const fakeSeries = (rng) => (a, b, bestOf) => {
  const need = Math.ceil(bestOf / 2);
  let wa = 0;
  let wb = 0;
  while (wa < need && wb < need) (rng() < 0.5 ? wa++ : wb++);
  return { winnerId: wa === need ? a : b, scoreA: wa, scoreB: wb };
};

const playSeries = fakeSeries(Math.random);
const t16 = Array.from({ length: 16 }, (_, i) => `T${i + 1}`);
const t20 = Array.from({ length: 20 }, (_, i) => `T${i + 1}`);
const t32 = Array.from({ length: 32 }, (_, i) => `T${i + 1}`);

assert.equal(new Set(serpentineGroups(t16).flat()).size, 16, "serpentine uses each seed once");

// Swiss.
for (let k = 0; k < 300; k++) {
  const swiss = new SwissStage("swiss", t16).play(playSeries);
  assert.equal(swiss.qualified.length, 8, "Swiss: 8 qualified");
  assert.equal(swiss.eliminated.length, 8, "Swiss: 8 eliminated");
  assert.equal(new Set(swiss.ranking).size, 16, "Swiss: 16 distinct places");
}

// Open.
const open = new OpenStage("Open", t16).play(playSeries);
assert.equal(new Set(open.ranking).size, 16, "Open: 16 distinct places");

for (let k = 0; k < 300; k++) {
  // Major : 4 groupes de 4, 9 matchs de playoffs.
  const major = new MajorStage("Major", t16).play(playSeries);
  assert.equal(major.groups.length, 4, "Major: 4 groups");
  for (const g of major.groups) {
    assert.equal(g.standings.length, 4, "Major: 4 teams per group");
    assert.equal(g.matches.length, 6, "Major: 6 group matches");
  }
  assert.equal(major.playoffs.matches.length, 9, "Major: 9 playoff matches");
  assert.equal(new Set(major.ranking).size, 16, "Major: 16 distinct places");

  // Worlds : play-in 10 matchs, 4 qualifiés, 4 groupes, playoffs 13 matchs.
  const worlds = new WorldsStage("World Championship", t20.slice(0, 12), t20.slice(12)).play(playSeries);
  assert.equal(worlds.playIn.matches.length, 10, "Worlds: 10 play-in matches");
  assert.equal(worlds.playInQualifiers.length, 4, "Worlds: 4 play-in qualifiers");
  assert.equal(worlds.groups.length, 4, "Worlds: 4 groups");
  assert.equal(worlds.playoffs.matches.length, 13, "Worlds: 13 playoff matches");
  assert.equal(new Set(worlds.ranking).size, 20, "Worlds: 20 distinct places");
}

// LCQ : 2 Swiss, 2 GSL, playoffs, un seul vainqueur.
for (let k = 0; k < 100; k++) {
  const lcq = new LcqStage(t32).play(playSeries);
  assert.equal(lcq.swiss.length, 2, "LCQ: 2 Swiss");
  for (const s of lcq.swiss) assert.equal(s.qualified.length, 8, "LCQ: 8 qualified per Swiss");
  assert.equal(lcq.gsl.length, 2, "LCQ: 2 GSL groups");
  for (const g of lcq.gsl) assert.equal(new Set(g.ranking()).size, 4, "LCQ: 4 advance per GSL");
  assert.equal(lcq.playoffs.matches.length, 9, "LCQ: 9 playoff matches");
  assert.ok(t32.includes(lcq.winnerId), "LCQ: winner is an entrant");
}

console.log("Tournament checks passed");