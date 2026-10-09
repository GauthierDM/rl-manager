// rlcs.js : moteur de saison RLCS (module ES)
// Team : { id, name, region, rating, playerIds }
// rate(team, pressure) -> { avg, ratings } et onGame(game) sont optionnels (fournis par app.js).

import { LcqRegional, MajorStage, OpenStage, WorldsStage } from "./tournament/engine.js";

// ---------- Règles (à modifier ici) ----------
export const PRESSURE = { open: 0, major: 2, lcq: 1, worlds: 3 };
export const OPEN_POINTS = [16, 12, 9, 9, 6, 6, 6, 6, 4, 4, 4, 2, 2, 2, 1, 1];
export const MAJOR_MULTIPLIER = 2; // 1er au Major = 16 x 2 = 32
export const MAJOR_SLOTS = { EU: 4, NA: 4, MENA: 2, SAM: 2, OCE: 1, APAC: 1, SSA: 1 };
export const EXTRA_SLOT_REGION = "EU"; // reçoit le 16e slot et les slots des régions absentes
export const WORLDS_QUOTA = { EU: 4, NA: 4, MENA: 2, SAM: 2, OCE: 1, APAC: 1, SSA: 1 };
export const WORLDS_BONUS_SLOTS = 1; // attribué à la région la plus performante aux Majors
export const WORLDS_DIRECT = 12; // seeds 1 à 12 : groupes directs
export const PLAY_IN_SIZE = 8; // seeds 13 à 20 : play-in, 4 qualifiés pour les groupes
export const LCQ_REGIONS = ["EU", "NA", "MENA", "SAM"]; // régions majeures avec un LCQ
export const LCQ_ENTRANTS = 8; // non-qualifiés par LCQ régional

const byRating = (x, y) => y.rating - x.rating;

// Même formule que la V2 : écart de rating / 8.
const winChance = (ra, rb) => 1 / (1 + Math.exp(-(ra - rb) / 8));

// ---------- Résolveur de série pour le moteur de tournois ----------
// Le moteur appelle (idA, idB, bestOf) et attend { winnerId, scoreA, scoreB }.
export function makeSeriesResolver(teamById, pressure, rate, onGame) {
  return (aId, bId, bo) => {
    const a = teamById[aId];
    const b = teamById[bId];
    const need = Math.floor(bo / 2) + 1;
    let wa = 0;
    let wb = 0;
    while (wa < need && wb < need) {
      const ra = rate ? rate(a, pressure) : { avg: a.rating, ratings: null };
      const rb = rate ? rate(b, pressure) : { avg: b.rating, ratings: null };
      const aWins = Math.random() < winChance(ra.avg, rb.avg);
      if (aWins) wa++;
      else wb++;
      onGame?.({ a, b, aWins, pressure, ra, rb });
    }
    return { winnerId: wa > wb ? aId : bId, scoreA: wa, scoreB: wb };
  };
}

// ---------- Adaptateurs (Opens) ----------
function toMatch(m) {
  return { a: m.teamA, b: m.teamB, scoreA: m.scoreA, scoreB: m.scoreB, winner: m.winnerId };
}

function toRounds(matches) {
  if (!matches.length) return [];
  const count = Math.max(...matches.map((m) => m.round));
  const rounds = Array.from({ length: count }, () => []);
  for (const m of matches) rounds[m.round - 1].push(toMatch(m));
  return rounds;
}

function toSwissMatches(matches) {
  return matches.map((m) => ({ round: m.round, ...toMatch(m) }));
}

// ---------- Tournois ----------
// Open régional : 16 équipes. Swiss -> top 8 -> playoffs.
export function simulateOpen(teams, playSeries, name) {
  const seeds = [...teams].sort(byRating).map((t) => t.id);
  const stage = new OpenStage(name, seeds).play(playSeries).toData();
  return {
    ranking: stage.ranking,
    points: Object.fromEntries(stage.ranking.map((id, i) => [id, OPEN_POINTS[i] ?? 0])),
    swissMatches: toSwissMatches(stage.brackets[0].matches),
    playoffRounds: toRounds(stage.brackets[1].matches),
  };
}

// Major : 4 groupes de 4 + playoffs double élimination. Points = Open x MAJOR_MULTIPLIER.
export function simulateMajor(teams, playSeries) {
  const seeds = [...teams].sort(byRating).map((t) => t.id);
  const stage = new MajorStage("Major", seeds).play(playSeries).toData();
  return {
    ranking: stage.ranking,
    points: Object.fromEntries(stage.ranking.map((id, i) => [id, (OPEN_POINTS[i] ?? 0) * MAJOR_MULTIPLIER])),
    stage,
  };
}

// ---------- Slots ----------
// Répartit les 16 slots de Major. Les slots d'une région absente et le 16e slot vont à EXTRA_SLOT_REGION.
export function resolveSlots(activeRegions) {
  const slots = {};
  let spare = 1; // le 16e slot
  for (const [region, n] of Object.entries(MAJOR_SLOTS)) {
    if (activeRegions.includes(region)) slots[region] = n;
    else spare += n;
  }
  slots[EXTRA_SLOT_REGION] = (slots[EXTRA_SLOT_REGION] ?? 0) + spare;
  return slots;
}

// Même principe pour les quotas Worlds. Le slot bonus est ajouté plus tard.
export function resolveWorldsQuota(activeRegions) {
  const quota = {};
  let spare = 0;
  for (const [region, n] of Object.entries(WORLDS_QUOTA)) {
    if (activeRegions.includes(region)) quota[region] = n;
    else spare += n;
  }
  quota[EXTRA_SLOT_REGION] = (quota[EXTRA_SLOT_REGION] ?? 0) + spare;
  return quota;
}

// Région dont les équipes ont accumulé le plus de points aux Majors.
function bestRegionAtMajors(majorPts, byRegion) {
  let best = null;
  let bestPts = -1;
  for (const [region, teams] of Object.entries(byRegion)) {
    const pts = teams.reduce((s, t) => s + (majorPts[t.id] ?? 0), 0);
    if (pts > bestPts) {
      best = region;
      bestPts = pts;
    }
  }
  return best;
}

// Top N de chaque région selon les points du split (départage au rating).
export function qualifyForMajor(byRegion, splitPoints, slots) {
  const field = [];
  for (const [region, teams] of Object.entries(byRegion)) {
    const n = slots[region] ?? 0;
    const sorted = [...teams].sort(
      (a, b) => (splitPoints[b.id] ?? 0) - (splitPoints[a.id] ?? 0) || b.rating - a.rating
    );
    field.push(...sorted.slice(0, n));
  }
  return field;
}

// ---------- Saison complète ----------
// options : { season, rate, onGame } (rate et onGame sont optionnels)
export function simulateSeason(teams, { season = 1, rate, onGame } = {}) {
  const teamById = Object.fromEntries(teams.map((t) => [t.id, t]));
  const resolverFor = (pressure) => makeSeriesResolver(teamById, pressure, rate, onGame);

  const byRegion = {};
  for (const t of teams) (byRegion[t.region] ??= []).push(t);
  const regions = Object.keys(byRegion);
  const slots = resolveSlots(regions);
  const totals = Object.fromEntries(teams.map((t) => [t.id, 0]));
  const majorPts = Object.fromEntries(teams.map((t) => [t.id, 0]));
  const byTotals = (a, b) => totals[b.id] - totals[a.id] || b.rating - a.rating;
  const splits = [];

  for (const split of [1, 2]) {
    const splitPoints = Object.fromEntries(teams.map((t) => [t.id, 0]));
    const opens = [];

    // 3 Opens par région et par split.
    for (const region of regions) {
      for (let k = 1; k <= 3; k++) {
        const n = (split - 1) * 3 + k;
        const name = `Open ${n} (${region})`;
        const res = simulateOpen(byRegion[region], resolverFor(PRESSURE.open), name);
        opens.push({ name, split, region, ...res });
        for (const [id, pts] of Object.entries(res.points)) {
          splitPoints[id] += pts;
          totals[id] += pts;
        }
      }
    }

    // Major du split : seuls les points de ce split comptent pour la qualification.
    const qualified = qualifyForMajor(byRegion, splitPoints, slots);
    const major = simulateMajor(qualified, resolverFor(PRESSURE.major));
    for (const [id, pts] of Object.entries(major.points)) {
      totals[id] += pts;
      majorPts[id] += pts;
    }

    splits.push({
      split,
      splitPoints,
      opens,
      major: { name: `Major ${split}`, field: qualified.map((t) => t.id), ...major },
    });
  }

  // Qualifiés régionaux : quota par région + slot bonus pour la meilleure région aux Majors.
  const quota = resolveWorldsQuota(regions);
  const bonusRegion = bestRegionAtMajors(majorPts, byRegion);
  if (bonusRegion) quota[bonusRegion] = (quota[bonusRegion] ?? 0) + WORLDS_BONUS_SLOTS;

  const qualifiers = [];
  for (const region of regions) {
    const sorted = [...byRegion[region]].sort(byTotals);
    qualifiers.push(...sorted.slice(0, quota[region] ?? 0));
  }
  const qualifiedIds = new Set(qualifiers.map((t) => t.id));

  // Seeds 1 à 12 : groupes directs. Seeds 13 et suivants : play-in.
  const orderedQualifiers = [...qualifiers].sort(byTotals);
  const worldsDirect = orderedQualifiers.slice(0, WORLDS_DIRECT);
  const qualifiersToPlayIn = orderedQualifiers.slice(WORLDS_DIRECT);

  // LCQ régional : les 8 meilleurs non-qualifiés de chaque région majeure, un vainqueur par région.
  const lcqEntrantIds = new Set();
  const lcqWinners = [];
  const lcq = [];
  for (const region of LCQ_REGIONS) {
    const pool = (byRegion[region] ?? [])
      .filter((t) => !qualifiedIds.has(t.id))
      .sort(byTotals)
      .slice(0, LCQ_ENTRANTS);
    if (pool.length < LCQ_ENTRANTS) continue; // région absente ou trop petite : pas de LCQ
    const data = new LcqRegional(region, pool.map((t) => t.id)).play(resolverFor(PRESSURE.lcq)).toData();
    lcq.push(data);
    lcqWinners.push(teamById[data.winnerId]);
    for (const t of pool) lcqEntrantIds.add(t.id);
  }

  // Places restantes du play-in : meilleurs non-qualifiés hors LCQ, par points.
  const freeSpots = Math.max(0, PLAY_IN_SIZE - qualifiersToPlayIn.length - lcqWinners.length);
  const fillers = teams
    .filter((t) => !qualifiedIds.has(t.id) && !lcqEntrantIds.has(t.id))
    .sort(byTotals)
    .slice(0, freeSpots);

  const playInPool = [...qualifiersToPlayIn, ...lcqWinners, ...fillers].sort(byTotals);

  const qualifiedVia = {};
  for (const t of worldsDirect) qualifiedVia[t.id] = "direct";
  for (const t of playInPool) qualifiedVia[t.id] = "play_in";

  const stage = new WorldsStage(
    "World Championship",
    worldsDirect.map((t) => t.id),
    playInPool.map((t) => t.id)
  )
    .play(resolverFor(PRESSURE.worlds))
    .toData();

  return {
    season,
    slots,
    splits,
    totals,
    majorPoints: majorPts,
    worlds: {
      quota,
      bonusRegion,
      direct: worldsDirect.map((t) => t.id),
      playIn: playInPool.map((t) => t.id),
      lcqWinners: lcqWinners.map((t) => t.id),
      lcq,
      qualifiedVia,
      field: [...worldsDirect, ...playInPool].map((t) => t.id),
      ranking: stage.ranking,
      stage,
    },
  };
}