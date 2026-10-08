// rlcs.js : moteur de saison RLCS (module ES, sans dépendance)
// Team : { id, name, region, rating, playerIds }
// ctx (optionnel) : { pressure, rate(team, pressure) -> { avg, ratings }, onGame(game) }

// ---------- Règles (à modifier ici) ----------
export const PRESSURE = { open: 0, major: 2, worlds: 3 };
export const OPEN_POINTS = [16, 12, 9, 9, 6, 6, 6, 6, 4, 4, 4, 2, 2, 2, 1, 1];
export const MAJOR_MULTIPLIER = 2; // 1er au Major = 16 x 2 = 32
export const MAJOR_SLOTS = { EU: 4, NA: 4, MENA: 2, SAM: 2, OCE: 1, APAC: 1, SSA: 1 };
export const EXTRA_SLOT_REGION = "EU"; // reçoit le 16e slot et les slots des régions absentes
export const WORLDS_QUOTA = { EU: 4, NA: 4, MENA: 2, SAM: 2, OCE: 1, APAC: 1, SSA: 1 };
export const WORLDS_BONUS_SLOTS = 1; // attribué à la région la plus performante aux Majors
export const WORLDS_SIZE = 16;

const byRating = (x, y) => y.rating - x.rating;

// Même formule que la V2 : écart de rating / 8.
const winChance = (ra, rb) => 1 / (1 + Math.exp(-(ra - rb) / 8));

// ---------- Matchs ----------
// Chaque manche est jouée avec la note du moment (pression, forme) si ctx.rate est fourni.
export function playSeries(a, b, bo, ctx = {}) {
  const need = Math.floor(bo / 2) + 1;
  const pressure = ctx.pressure ?? 0;
  let wa = 0, wb = 0;
  while (wa < need && wb < need) {
    const ra = ctx.rate ? ctx.rate(a, pressure) : { avg: a.rating, ratings: null };
    const rb = ctx.rate ? ctx.rate(b, pressure) : { avg: b.rating, ratings: null };
    const aWins = Math.random() < winChance(ra.avg, rb.avg);
    if (aWins) wa++;
    else wb++;
    ctx.onGame?.({ a, b, aWins, pressure, ra, rb });
  }
  const aWon = wa > wb;
  return { scoreA: wa, scoreB: wb, winner: aWon ? a : b, loser: aWon ? b : a };
}

// ---------- Swiss (16 équipes -> 8 qualifiées, 8 éliminées) ----------
// Une équipe est qualifiée à 3 victoires et éliminée à 3 défaites.
export function swiss(teams, bo = 3, advanceCount = 8, ctx = {}) {
  const rec = new Map(teams.map((t) => [t.id, { team: t, w: 0, l: 0, met: new Set() }]));
  const matches = [];

  for (let round = 1; round <= 10; round++) {
    const pool = [...rec.values()]
      .filter((r) => r.w < 3 && r.l < 3)
      .sort((x, y) => y.w - x.w || x.l - y.l || y.team.rating - x.team.rating);
    if (pool.length < 2) break;

    const used = new Set();
    for (const r of pool) {
      if (used.has(r.team.id)) continue;
      // Préfère un adversaire pas encore rencontré, sinon accepte une revanche.
      const opp =
        pool.find((o) => o !== r && !used.has(o.team.id) && !r.met.has(o.team.id)) ??
        pool.find((o) => o !== r && !used.has(o.team.id));
      if (!opp) continue;

      used.add(r.team.id);
      used.add(opp.team.id);
      const m = playSeries(r.team, opp.team, bo, ctx);
      matches.push({ round, a: r.team.id, b: opp.team.id, scoreA: m.scoreA, scoreB: m.scoreB, winner: m.winner.id });
      r.met.add(opp.team.id);
      opp.met.add(r.team.id);
      if (m.winner === r.team) { r.w++; opp.l++; } else { opp.w++; r.l++; }
    }
  }

  const ranked = [...rec.values()]
    .sort((x, y) => y.w - x.w || x.l - y.l || y.team.rating - x.team.rating)
    .map((r) => r.team);
  return { matches, advance: ranked.slice(0, advanceCount), eliminated: ranked.slice(advanceCount) };
}

// ---------- Élimination directe ----------
// seeds : équipes dans l'ordre de tête de série. Renvoie les tours et le classement (1er en premier).
export function elimination(seeds, bo, finalBo = bo, ctx = {}) {
  if (seeds.length < 2) return { rounds: [], ranking: [...seeds] };

  let size = 1;
  while (size < seeds.length) size *= 2;
  const padded = [...seeds, ...Array(size - seeds.length).fill(null)];

  // Tête de série standard : 1 contre dernier, 2 contre avant-dernier, etc.
  let current = [];
  for (let i = 0; i < size / 2; i++) current.push([padded[i], padded[size - 1 - i]]);

  const rounds = [];
  const losersByRound = [];

  while (true) {
    const isFinal = current.length === 1;
    const matches = [], next = [], losers = [];

    for (const [a, b] of current) {
      if (!a || !b) { // bye (seulement si le nombre de seeds n'est pas une puissance de 2)
        const w = a || b;
        matches.push({ a: w.id, b: null, bye: true, winner: w.id });
        next.push(w);
        continue;
      }
      const m = playSeries(a, b, isFinal ? finalBo : bo, ctx);
      matches.push({ a: a.id, b: b.id, scoreA: m.scoreA, scoreB: m.scoreB, winner: m.winner.id });
      next.push(m.winner);
      losers.push(m.loser);
    }

    rounds.push(matches);
    losersByRound.push(losers.sort(byRating));

    if (isFinal) {
      // Vainqueur 1er, finaliste 2e, puis demi-finalistes (3e-4e), quarts (5e-8e), etc.
      return { rounds, ranking: [next[0], ...losersByRound.reverse().flat()] };
    }

    current = [];
    for (let i = 0; i < next.length; i += 2) current.push([next[i], next[i + 1]]);
  }
}

// ---------- Tournois ----------
// Open régional : 16 équipes. Swiss -> top 8 -> playoffs. Renvoie le classement 1er à 16e.
export function simulateOpen(teams, ctx = {}) {
  const sw = swiss(teams, 3, 8, ctx);
  const pl = elimination(sw.advance, 5, 7, ctx);
  const ranking = [...pl.ranking, ...sw.eliminated];
  return {
    ranking: ranking.map((t) => t.id),
    points: Object.fromEntries(ranking.map((t, i) => [t.id, OPEN_POINTS[i] ?? 0])),
    swissMatches: sw.matches,
    playoffRounds: pl.rounds,
  };
}

// Major : 16 équipes en élimination directe BO5, finale BO7. Points = Open x MAJOR_MULTIPLIER.
export function simulateMajor(teams, ctx = {}) {
  const seeds = [...teams].sort(byRating);
  const res = elimination(seeds, 5, 7, ctx);
  return {
    ranking: res.ranking.map((t) => t.id),
    points: Object.fromEntries(res.ranking.map((t, i) => [t.id, (OPEN_POINTS[i] ?? 0) * MAJOR_MULTIPLIER])),
    rounds: res.rounds,
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
  let best = null, bestPts = -1;
  for (const [region, teams] of Object.entries(byRegion)) {
    const pts = teams.reduce((s, t) => s + (majorPts[t.id] ?? 0), 0);
    if (pts > bestPts) { best = region; bestPts = pts; }
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
  const ctxFor = (pressure) => ({ pressure, rate, onGame });

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

    // 3 Opens par région et par split. Les 16 équipes de la région jouent les 3.
    for (const region of regions) {
      for (let k = 1; k <= 3; k++) {
        const res = simulateOpen(byRegion[region], ctxFor(PRESSURE.open));
        const n = (split - 1) * 3 + k;
        opens.push({ name: `Open ${n} (${region})`, split, region, ...res });
        for (const [id, pts] of Object.entries(res.points)) {
          splitPoints[id] += pts;
          totals[id] += pts;
        }
      }
    }

    // Major du split : seuls les points de ce split comptent pour la qualification.
    const qualified = qualifyForMajor(byRegion, splitPoints, slots);
    const major = simulateMajor(qualified, ctxFor(PRESSURE.major));
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

  // Worlds : quota par région + slot bonus pour la meilleure région aux Majors.
  const quota = resolveWorldsQuota(regions);
  const bonusRegion = bestRegionAtMajors(majorPts, byRegion);
  if (bonusRegion) quota[bonusRegion] = (quota[bonusRegion] ?? 0) + WORLDS_BONUS_SLOTS;

  const qualifiedVia = {};
  const direct = [];
  for (const region of regions) {
    const sorted = [...byRegion[region]].sort(byTotals);
    const picked = sorted.slice(0, quota[region] ?? 0);
    for (const t of picked) qualifiedVia[t.id] = "direct";
    direct.push(...picked);
  }

  // LCQ : ticket de repêchage. Les meilleures équipes restantes complètent le tableau.
  const missing = Math.max(0, WORLDS_SIZE - direct.length);
  const lcq = teams
    .filter((t) => !qualifiedVia[t.id])
    .sort(byTotals)
    .slice(0, missing);
  for (const t of lcq) qualifiedVia[t.id] = "qualified_via_lcq";

  const worldsField = [...direct, ...lcq].sort(byTotals);
  const bracket = elimination(worldsField, 5, 7, ctxFor(PRESSURE.worlds));

  return {
    season,
    slots,
    splits,
    totals,
    majorPoints: majorPts,
    worlds: {
      quota,
      bonusRegion,
      direct: direct.map((t) => t.id),
      lcq: lcq.map((t) => t.id),
      qualifiedVia,
      field: worldsField.map((t) => t.id),
      ranking: bracket.ranking.map((t) => t.id),
      rounds: bracket.rounds,
    },
  };
}