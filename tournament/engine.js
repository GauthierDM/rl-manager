// @ts-check
// Moteur des tournois RLCS, en classes.
//
//   Match         une série entre deux équipes
//   Bracket       matchs liés par des références de slot
//   SwissStage    16 équipes : 3 victoires qualifient, 3 défaites éliminent
//   Group4        4 équipes, 3 rondes Bo3 (1er, 2e, 3e, 4e)
//   GslGroup      8 équipes, double élimination sans grande finale
//   OpenStage     Swiss 16, puis Top 8
//   MajorStage    4 groupes de 4, puis playoffs à 8
//   WorldsStage   play-in 8, puis 4 groupes de 4, puis playoffs à 8
//   LcqStage      2 Swiss de 16, 2 GSL de 8, playoffs à 8 (non utilisé en saison)
//   LcqRegional   8 équipes en Top 8 à élimination directe, 1 vainqueur
//
// Référence de slot : clé de seed ("S1", "A1"...), "W:<matchId>" (vainqueur)
// ou "L:<matchId>" (perdant). toData() renvoie des objets simples, sauvegardables.

export const BO = {
  swiss: 3,
  group: 3,
  open: { qf: 5, sf: 5, final: 7 },
  gsl: { regular: 3, upperFinal: 5, qualifier: 3 },
  major: { upperQf: 7, lowerR1: 7, lowerQf: 5, semi: 7, grand: 7 },
  worlds: { upperQf: 5, lowerR1: 5, lowerR2: 5, lowerQf: 5, semi: 7, grand: 7 },
  playIn: { upperQf: 5, upperSemi: 5, lowerQf: 5, lowerSemi: 5 },
  lcq: { upperQf: 5, lowerR1: 5, lowerQf: 5, semi: 5, grand: 7 },
};

export const LCQ_SIZE = 32;
const LETTERS = ["A", "B", "C", "D"];

// ---------- Match et Bracket ----------

export class Match {
  /** @param {{ id: string, label: string, round: number, bestOf: number }} o */
  constructor({ id, label, round, bestOf }) {
    this.id = id;
    this.label = label;
    this.round = round;
    this.bestOf = bestOf;
    this.teamA = null;
    this.teamB = null;
    this.scoreA = 0;
    this.scoreB = 0;
    this.winnerId = null;
    this.loserId = null;
  }

  get done() {
    return this.winnerId !== null;
  }

  /** Joue la série et enregistre le résultat sur le match. */
  play(teamA, teamB, playSeries) {
    const r = playSeries(teamA, teamB, this.bestOf, this);
    if (r.winnerId !== teamA && r.winnerId !== teamB) {
      throw new Error(`Unknown winner in ${this.id}`);
    }
    this.teamA = teamA;
    this.teamB = teamB;
    this.scoreA = r.scoreA;
    this.scoreB = r.scoreB;
    this.winnerId = r.winnerId;
    this.loserId = r.winnerId === teamA ? teamB : teamA;
    return this;
  }
}

export class Bracket {
  constructor(id, kind) {
    this.id = id;
    this.kind = kind;
    /** @type {Match[]} */
    this.matches = [];
    /** @type {Map<string, [string, string]>} */
    this.refs = new Map();
  }

  /** Ajoute un match dont les équipes viennent des références refA et refB. */
  add(id, label, round, bestOf, refA, refB) {
    this.matches.push(new Match({ id, label, round, bestOf }));
    this.refs.set(id, [refA, refB]);
  }

  get(id) {
    const m = this.matches.find((x) => x.id === id);
    if (!m) throw new Error(`Unknown match ${id} in ${this.id}`);
    return m;
  }

  resolve(ref, keys) {
    if (ref.startsWith("W:") || ref.startsWith("L:")) {
      const m = this.get(ref.slice(2));
      const teamId = ref[0] === "W" ? m.winnerId : m.loserId;
      if (!teamId) throw new Error(`${ref} is not played yet`);
      return teamId;
    }
    if (!(ref in keys)) throw new Error(`Unknown slot ${ref} in ${this.id}`);
    return keys[ref];
  }

  /** Joue les matchs dans l'ordre d'ajout. */
  play(keys, playSeries, onMatch) {
    for (const m of this.matches) {
      const [ra, rb] = this.refs.get(m.id);
      m.play(this.resolve(ra, keys), this.resolve(rb, keys), playSeries);
      onMatch?.(m);
    }
    return this;
  }

  toData() {
    return { id: this.id, kind: this.kind, matches: this.matches };
  }
}

// ---------- Outils de classement ----------

/** Classement d'un groupe : victoires, différentiel de manches, seed. */
export function standingsOf(teamIds, matches) {
  const rows = teamIds.map((id, i) => ({ id, seed: i + 1, w: 0, l: 0, gw: 0, gl: 0 }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const m of matches) {
    if (!m.done) continue;
    const a = byId.get(m.teamA);
    const b = byId.get(m.teamB);
    if (!a || !b) continue;
    a.gw += m.scoreA;
    a.gl += m.scoreB;
    b.gw += m.scoreB;
    b.gl += m.scoreA;
    if (m.winnerId === m.teamA) {
      a.w++;
      b.l++;
    } else {
      b.w++;
      a.l++;
    }
  }
  return rows.sort((x, y) => y.w - x.w || (y.gw - y.gl) - (x.gw - x.gl) || x.seed - y.seed);
}

function gameDiffOf(teamId, matches) {
  let diff = 0;
  for (const m of matches) {
    if (!m.done) continue;
    if (m.teamA === teamId) diff += m.scoreA - m.scoreB;
    else if (m.teamB === teamId) diff += m.scoreB - m.scoreA;
  }
  return diff;
}

/** Trie des équipes par différentiel de manches sur l'ensemble des matchs donnés. */
const byDiff = (ids, matches) => [...ids].sort((a, b) => gameDiffOf(b, matches) - gameDiffOf(a, matches));

/** Répartition en serpentin : seeds[0] = seed 1. A : 1,8,9,16 ; B : 2,7,10,15 ; C : 3,6,11,14 ; D : 4,5,12,13. */
export function serpentineGroups(seeds) {
  const idx = [
    [0, 7, 8, 15],
    [1, 6, 9, 14],
    [2, 5, 10, 13],
    [3, 4, 11, 12],
  ];
  return idx.map((row) => row.map((i) => seeds[i]));
}

/** Clés A1..D4 : place de chaque équipe dans les groupes. */
function groupKeys(groups) {
  const keys = {};
  for (const g of groups) g.standings.forEach((r, i) => (keys[`${g.id}${i + 1}`] = r.id));
  return keys;
}

// ---------- Swiss ----------

/** Appariement dans un bilan donné, sans revanche si possible. */
function pairWithin(list, allowRematch) {
  if (list.length === 0) return [];
  const [first, ...rest] = list;
  for (let i = 0; i < rest.length; i++) {
    const other = rest[i];
    if (!allowRematch && first.met.has(other.id)) continue;
    const tail = pairWithin(rest.filter((_, j) => j !== i), allowRematch);
    if (tail) return [[first, other], ...tail];
  }
  return null;
}

function pairSwissRound(active) {
  /** @type {Map<string, any[]>} */
  const buckets = new Map();
  for (const r of active) {
    const key = `${r.w}-${r.l}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)?.push(r);
  }
  const pairs = [];
  const ordered = [...buckets.values()].sort((x, y) => y[0].w - x[0].w);
  for (const list of ordered) {
    const sorted = [...list].sort((a, b) => a.seed - b.seed);
    pairs.push(...(pairWithin(sorted, false) ?? pairWithin(sorted, true) ?? []));
  }
  return pairs;
}

export class SwissStage {
  constructor(id, teamIds) {
    if (teamIds.length !== 16) throw new Error(`${id} needs 16 teams, got ${teamIds.length}`);
    this.id = id;
    this.teamIds = teamIds;
    this.bracket = new Bracket(id, "swiss");
    this.ranking = [];
    this.qualified = [];
    this.eliminated = [];
  }

  play(playSeries, onMatch) {
    const rec = this.teamIds.map((id, i) => ({ id, seed: i + 1, w: 0, l: 0, met: new Set() }));
    let active = rec;
    let round = 0;
    while (active.length > 0) {
      round++;
      const pairs = pairSwissRound(active);
      if (pairs.length === 0) break;
      pairs.forEach(([a, b], i) => {
        const m = new Match({ id: `${this.id}-r${round}-${i + 1}`, label: `Round ${round}`, round, bestOf: BO.swiss });
        m.play(a.id, b.id, playSeries);
        this.bracket.matches.push(m);
        onMatch?.(m);
        a.met.add(b.id);
        b.met.add(a.id);
        if (m.winnerId === a.id) {
          a.w++;
          b.l++;
        } else {
          b.w++;
          a.l++;
        }
      });
      active = active.filter((r) => r.w < 3 && r.l < 3);
    }
    this.ranking = this.standings.map((r) => r.id);
    this.qualified = this.ranking.slice(0, 8);
    this.eliminated = this.ranking.slice(8);
    return this;
  }

  get standings() {
    return standingsOf(this.teamIds, this.bracket.matches);
  }

  toData() {
    return { id: this.id, matches: this.bracket.matches, standings: this.standings };
  }
}

// ---------- Groupe de 4 (Major, Worlds) ----------

export class Group4 {
  constructor(id, teamIds) {
    this.id = id;
    this.teamIds = teamIds;
    /** @type {Match[]} */
    this.matches = [];
  }

  get standings() {
    return standingsOf(this.teamIds, this.matches);
  }

  pick(filter) {
    return this.standings.filter(filter).sort((x, y) => x.seed - y.seed);
  }

  pair(a, b, round, playSeries, onMatch) {
    const m = new Match({ id: `${this.id}-${this.matches.length + 1}`, label: `Group ${this.id} · Round ${round}`, round, bestOf: BO.group });
    m.play(a, b, playSeries);
    this.matches.push(m);
    onMatch?.(m);
  }

  play(playSeries, onMatch) {
    const t = this.teamIds;
    this.pair(t[0], t[1], 1, playSeries, onMatch);
    this.pair(t[2], t[3], 1, playSeries, onMatch);

    const winners = this.pick((r) => r.w === 1);
    const losers = this.pick((r) => r.l === 1);
    this.pair(winners[0].id, winners[1].id, 2, playSeries, onMatch);
    this.pair(losers[0].id, losers[1].id, 2, playSeries, onMatch);

    const top = this.pick((r) => r.w === 2)[0];
    const bottom = this.pick((r) => r.l === 2)[0];
    const mid = this.pick((r) => r.w === 1 && r.l === 1);
    this.pair(top.id, bottom.id, 3, playSeries, onMatch);
    this.pair(mid[0].id, mid[1].id, 3, playSeries, onMatch);
    return this;
  }

  toData() {
    return { id: this.id, matches: this.matches, standings: this.standings };
  }
}

// ---------- Groupe GSL à 8 (LCQ) ----------

export class GslGroup {
  constructor(id, teamIds) {
    if (teamIds.length !== 8) throw new Error(`GSL group ${id} needs 8 teams, got ${teamIds.length}`);
    this.id = id;
    this.teamIds = teamIds;
    this.bracket = new Bracket(`gsl-${id}`, "gsl-group");
  }

  play(playSeries, onMatch) {
    const keys = Object.fromEntries(this.teamIds.map((t, i) => [`S${i + 1}`, t]));
    const b = this.bracket;
    const g = BO.gsl;
    b.add("u1", "Upper round 1", 1, g.regular, "S1", "S2");
    b.add("u2", "Upper round 1", 1, g.regular, "S3", "S4");
    b.add("u3", "Upper round 1", 1, g.regular, "S5", "S6");
    b.add("u4", "Upper round 1", 1, g.regular, "S7", "S8");
    b.add("l1a", "Lower round 1 (a)", 1, g.regular, "L:u1", "L:u2");
    b.add("l1b", "Lower round 1 (b)", 1, g.regular, "L:u3", "L:u4");
    b.add("us1", "Upper semi 1", 2, g.regular, "W:u1", "W:u2");
    b.add("us2", "Upper semi 2", 2, g.regular, "W:u3", "W:u4");
    b.add("l2a", "Lower round 2 (a)", 2, g.regular, "L:us1", "W:l1a");
    b.add("l2b", "Lower round 2 (b)", 2, g.regular, "L:us2", "W:l1b");
    b.add("uf", "Upper final", 3, g.upperFinal, "W:us1", "W:us2");
    b.add("l3", "Lower round 3 (qualifier)", 3, g.qualifier, "W:l2a", "W:l2b");
    b.play(keys, playSeries, onMatch);
    return this;
  }

  /** Places 1 à 4 : upper final gagnant, perdant, qualifier gagnant, perdant. */
  ranking() {
    const b = this.bracket;
    return [b.get("uf").winnerId, b.get("uf").loserId, b.get("l3").winnerId, b.get("l3").loserId];
  }

  get standings() {
    return standingsOf(this.teamIds, this.bracket.matches);
  }

  toData() {
    return { id: this.id, matches: this.bracket.matches, standings: this.standings };
  }
}

// ---------- Arbres de playoffs ----------

/** Top 8 d'un Open, seeds 1 à 8 selon le Swiss. */
function addTop8(b) {
  const o = BO.open;
  b.add("qf1", "Quarter-final 1", 1, o.qf, "S1", "S8");
  b.add("qf2", "Quarter-final 2", 1, o.qf, "S4", "S5");
  b.add("qf3", "Quarter-final 3", 1, o.qf, "S2", "S7");
  b.add("qf4", "Quarter-final 4", 1, o.qf, "S3", "S6");
  b.add("sf1", "Semi-final 1", 2, o.sf, "W:qf1", "W:qf2");
  b.add("sf2", "Semi-final 2", 2, o.sf, "W:qf3", "W:qf4");
  b.add("final", "Final", 3, o.final, "W:sf1", "W:sf2");
}

/** Playoffs du Major : 8 équipes, double élimination, 9 matchs. */
function addMajorPlayoffs(b) {
  const m = BO.major;
  b.add("uq1", "Upper QF 1", 1, m.upperQf, "A1", "D1");
  b.add("uq2", "Upper QF 2", 1, m.upperQf, "B1", "C1");
  b.add("lr1a", "Lower R1 · 1", 1, m.lowerR1, "B2", "C2");
  b.add("lr1b", "Lower R1 · 2", 1, m.lowerR1, "A2", "D2");
  b.add("lqf1", "Lower QF 1", 2, m.lowerQf, "L:uq1", "W:lr1a");
  b.add("lqf2", "Lower QF 2", 2, m.lowerQf, "L:uq2", "W:lr1b");
  b.add("sf1", "Semi 1", 3, m.semi, "W:uq2", "W:lqf1");
  b.add("sf2", "Semi 2", 3, m.semi, "W:uq1", "W:lqf2");
  b.add("gf", "Grand final", 4, m.grand, "W:sf1", "W:sf2");
}

/** Playoffs du Worlds : 8 équipes, double élimination avec Lower R2, 13 matchs. */
function addWorldsPlayoffs(b) {
  const w = BO.worlds;
  b.add("uq1", "Upper QF 1", 1, w.upperQf, "A1", "D1");
  b.add("uq2", "Upper QF 2", 1, w.upperQf, "B1", "C1");
  b.add("lr1a", "Lower R1 · 1", 1, w.lowerR1, "B2", "A3");
  b.add("lr1b", "Lower R1 · 2", 1, w.lowerR1, "C2", "D3");
  b.add("lr1c", "Lower R1 · 3", 1, w.lowerR1, "A2", "B3");
  b.add("lr1d", "Lower R1 · 4", 1, w.lowerR1, "C3", "D2");
  b.add("lr2a", "Lower R2 · 1", 2, w.lowerR2, "W:lr1a", "W:lr1b");
  b.add("lr2b", "Lower R2 · 2", 2, w.lowerR2, "W:lr1c", "W:lr1d");
  b.add("lqf1", "Lower QF 1", 3, w.lowerQf, "L:uq1", "W:lr2a");
  b.add("lqf2", "Lower QF 2", 3, w.lowerQf, "L:uq2", "W:lr2b");
  b.add("sf1", "Semi 1", 4, w.semi, "W:uq2", "W:lqf1");
  b.add("sf2", "Semi 2", 4, w.semi, "W:uq1", "W:lqf2");
  b.add("gf", "Grand final", 5, w.grand, "W:sf1", "W:sf2");
}

/** Play-in du Worlds : 8 équipes (P1 = meilleur seed), 10 matchs, 4 qualifiés. */
function addPlayIn(b) {
  const p = BO.playIn;
  b.add("pu1", "Upper QF 1", 1, p.upperQf, "P1", "P2");
  b.add("pu2", "Upper QF 2", 1, p.upperQf, "P3", "P4");
  b.add("pu3", "Upper QF 3", 1, p.upperQf, "P5", "P6");
  b.add("pu4", "Upper QF 4", 1, p.upperQf, "P7", "P8");
  b.add("pus1", "Upper SF 1", 2, p.upperSemi, "W:pu1", "W:pu2");
  b.add("pus2", "Upper SF 2", 2, p.upperSemi, "W:pu3", "W:pu4");
  b.add("pl1", "Lower QF 1", 2, p.lowerQf, "L:pu1", "L:pu2");
  b.add("pl2", "Lower QF 2", 2, p.lowerQf, "L:pu3", "L:pu4");
  b.add("pls1", "Lower SF 1", 3, p.lowerSemi, "L:pus2", "W:pl1");
  b.add("pls2", "Lower SF 2", 3, p.lowerSemi, "L:pus1", "W:pl2");
}

/** Playoffs du LCQ : A1..A4 et B1..B4 (places des GSL), 9 matchs, 1 vainqueur. */
function addLcqPlayoffs(b) {
  const l = BO.lcq;
  b.add("uq1", "Upper QF 1", 1, l.upperQf, "A1", "B2");
  b.add("uq2", "Upper QF 2", 1, l.upperQf, "B1", "A2");
  b.add("lr1a", "Lower R1 · 1", 1, l.lowerR1, "A3", "B4");
  b.add("lr1b", "Lower R1 · 2", 1, l.lowerR1, "B3", "A4");
  b.add("lqf1", "Lower QF 1", 2, l.lowerQf, "L:uq1", "W:lr1a");
  b.add("lqf2", "Lower QF 2", 2, l.lowerQf, "L:uq2", "W:lr1b");
  b.add("sf1", "Semi 1", 3, l.semi, "W:uq2", "W:lqf1");
  b.add("sf2", "Semi 2", 3, l.semi, "W:uq1", "W:lqf2");
  b.add("gf", "Grand final", 4, l.grand, "W:sf1", "W:sf2");
}

// ---------- Étapes ----------

export class OpenStage {
  constructor(name, teamIds) {
    if (teamIds.length !== 16) throw new Error(`${name} needs 16 teams, got ${teamIds.length}`);
    this.name = name;
    this.teamIds = teamIds;
    this.swiss = null;
    this.playoffs = new Bracket(`${name}-playoffs`, "elimination");
  }

  play(playSeries, onMatch) {
    this.swiss = new SwissStage(`${this.name}-swiss`, this.teamIds).play(playSeries, onMatch);
    addTop8(this.playoffs);
    const keys = Object.fromEntries(this.swiss.qualified.map((id, i) => [`S${i + 1}`, id]));
    this.playoffs.play(keys, playSeries, onMatch);
    return this;
  }

  get ranking() {
    const po = this.playoffs;
    const lost = (id) => po.get(id).loserId;
    return [
      po.get("final").winnerId,
      po.get("final").loserId,
      lost("sf1"),
      lost("sf2"),
      lost("qf1"),
      lost("qf2"),
      lost("qf3"),
      lost("qf4"),
      ...this.swiss.eliminated,
    ];
  }

  toData() {
    return {
      name: this.name,
      ranking: this.ranking,
      championId: this.playoffs.get("final").winnerId,
      brackets: [this.swiss.bracket.toData(), this.playoffs.toData()],
    };
  }
}

export class MajorStage {
  constructor(name, seeds) {
    if (seeds.length !== 16) throw new Error(`${name} needs 16 teams, got ${seeds.length}`);
    this.name = name;
    this.seeds = seeds;
    /** @type {Group4[]} */
    this.groups = [];
    this.playoffs = new Bracket(`${name}-playoffs`, "elimination");
  }

  play(playSeries, onMatch) {
    this.groups = serpentineGroups(this.seeds).map((ids, i) => new Group4(LETTERS[i], ids).play(playSeries, onMatch));
    addMajorPlayoffs(this.playoffs);
    this.playoffs.play(groupKeys(this.groups), playSeries, onMatch);
    return this;
  }

  get ranking() {
    const po = this.playoffs;
    const all = [...this.groups.flatMap((g) => g.matches), ...po.matches];
    const lost = (id) => po.get(id).loserId;
    return [
      po.get("gf").winnerId,
      po.get("gf").loserId,
      ...byDiff(["sf1", "sf2"].map(lost), all),
      ...byDiff(["lqf1", "lqf2"].map(lost), all),
      ...byDiff(["lr1a", "lr1b"].map(lost), all),
      ...byDiff(this.groups.map((g) => g.standings[2].id), all),
      ...byDiff(this.groups.map((g) => g.standings[3].id), all),
    ];
  }

  toData() {
    return {
      name: this.name,
      groups: this.groups.map((g) => g.toData()),
      playoffs: this.playoffs.toData(),
      ranking: this.ranking,
    };
  }
}

export class WorldsStage {
  /**
   * @param {string} name
   * @param {string[]} directSeeds 12 équipes, seed 1 en premier
   * @param {string[]} playInSeeds 8 équipes, P1 = meilleur seed
   */
  constructor(name, directSeeds, playInSeeds) {
    if (directSeeds.length !== 12) throw new Error(`${name} needs 12 direct teams, got ${directSeeds.length}`);
    if (playInSeeds.length !== 8) throw new Error(`${name} needs 8 play-in teams, got ${playInSeeds.length}`);
    this.name = name;
    this.directSeeds = directSeeds;
    this.playInSeeds = playInSeeds;
    this.playIn = new Bracket(`${name}-playin`, "elimination");
    this.playInQualifiers = [];
    /** @type {Group4[]} */
    this.groups = [];
    this.playoffs = new Bracket(`${name}-playoffs`, "elimination");
  }

  play(playSeries, onMatch) {
    addPlayIn(this.playIn);
    const playInKeys = Object.fromEntries(this.playInSeeds.map((t, i) => [`P${i + 1}`, t]));
    this.playIn.play(playInKeys, playSeries, onMatch);
    this.playInQualifiers = ["pus1", "pus2", "pls1", "pls2"].map((id) => this.playIn.get(id).winnerId);

    const seeds = [...this.directSeeds, ...this.playInQualifiers];
    this.groups = serpentineGroups(seeds).map((ids, i) => new Group4(LETTERS[i], ids).play(playSeries, onMatch));
    addWorldsPlayoffs(this.playoffs);
    this.playoffs.play(groupKeys(this.groups), playSeries, onMatch);
    return this;
  }

  get ranking() {
    const po = this.playoffs;
    const pi = this.playIn;
    const all = [...this.groups.flatMap((g) => g.matches), ...po.matches, ...pi.matches];
    const lost = (id) => po.get(id).loserId;
    const piLost = (id) => pi.get(id).loserId;
    return [
      po.get("gf").winnerId,
      po.get("gf").loserId,
      ...byDiff(["sf1", "sf2"].map(lost), all),
      ...byDiff(["lqf1", "lqf2"].map(lost), all),
      ...byDiff(["lr2a", "lr2b"].map(lost), all),
      ...byDiff(["lr1a", "lr1b", "lr1c", "lr1d"].map(lost), all),
      ...byDiff(this.groups.map((g) => g.standings[3].id), all),
      ...byDiff(["pls1", "pls2"].map(piLost), all),
      ...byDiff(["pl1", "pl2"].map(piLost), all),
    ];
  }

  toData() {
    return {
      name: this.name,
      playIn: this.playIn.toData(),
      playInQualifiers: this.playInQualifiers,
      groups: this.groups.map((g) => g.toData()),
      playoffs: this.playoffs.toData(),
      ranking: this.ranking,
    };
  }
}

export class LcqStage {
  /** @param {string[]} teamIds 32 équipes, meilleur seed en premier */
  constructor(teamIds) {
    if (teamIds.length !== LCQ_SIZE) throw new Error(`LCQ needs ${LCQ_SIZE} teams, got ${teamIds.length}`);
    this.teamIds = teamIds;
    /** @type {SwissStage[]} */
    this.swiss = [];
    /** @type {GslGroup[]} */
    this.gsl = [];
    this.playoffs = new Bracket("lcq-playoffs", "elimination");
    this.winnerId = null;
  }

  play(playSeries, onMatch) {
    const halves = [
      this.teamIds.filter((_, i) => i % 4 === 0 || i % 4 === 3),
      this.teamIds.filter((_, i) => i % 4 === 1 || i % 4 === 2),
    ];
    this.swiss = halves.map((ids, i) => new SwissStage(`lcq-swiss-${LETTERS[i]}`, ids).play(playSeries, onMatch));
    this.gsl = this.swiss.map((s, i) => new GslGroup(LETTERS[i], s.qualified).play(playSeries, onMatch));

    const keys = {};
    this.gsl.forEach((g, i) => g.ranking().forEach((id, j) => (keys[`${LETTERS[i]}${j + 1}`] = id)));
    addLcqPlayoffs(this.playoffs);
    this.playoffs.play(keys, playSeries, onMatch);
    this.winnerId = this.playoffs.get("gf").winnerId;
    return this;
  }

  toData() {
    return {
      winnerId: this.winnerId,
      swiss: this.swiss.map((s) => s.toData()),
      gsl: this.gsl.map((g) => g.toData()),
      playoffs: this.playoffs.toData(),
    };
  }
}

// ---------- LCQ régional : 8 équipes, Top 8 à élimination directe, 1 vainqueur ----------
export class LcqRegional {
  /** @param {string} region  @param {string[]} teamIds 8 équipes, meilleur seed en premier */
  constructor(region, teamIds) {
    if (teamIds.length !== 8) throw new Error(`LCQ ${region} needs 8 teams, got ${teamIds.length}`);
    this.region = region;
    this.teamIds = teamIds;
    this.bracket = new Bracket(`lcq-${region}`, "elimination");
    this.winnerId = null;
  }

  play(playSeries, onMatch) {
    addTop8(this.bracket);
    const keys = Object.fromEntries(this.teamIds.map((id, i) => [`S${i + 1}`, id]));
    this.bracket.play(keys, playSeries, onMatch);
    this.winnerId = this.bracket.get("final").winnerId;
    return this;
  }

  toData() {
    return { region: this.region, winnerId: this.winnerId, bracket: this.bracket.toData() };
  }
}