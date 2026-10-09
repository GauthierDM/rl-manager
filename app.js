import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { simulateSeason } from "./rlcs.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------- Settings ----------
const STATS = ["mechanics", "gameSpeed", "attack", "defense", "goalkeeping", "mental", "pressure"];
const STAT_WEIGHTS = { mechanics: 0.2, gameSpeed: 0.15, attack: 0.2, defense: 0.15, goalkeeping: 0.1, mental: 0.2 };
const PRIZES = [300, 150, 100, 75, 50, 40, 30, 20];
const REGIONS = ["EU", "NA", "SAM", "OCE", "APAC", "MENA", "SSA"];
// Display order of the qualification tables: 3 per row, big regions first.
const REGION_ORDER = ["EU", "NA", "MENA", "SAM", "OCE", "APAC", "SSA"];
const REGION_LEVEL = { EU: 72, NA: 68, SAM: 64, OCE: 62, APAC: 58, MENA: 60, SSA: 58 };
const REGION_BUDGET = { EU: 1000, NA: 900, SAM: 700, OCE: 600, APAC: 600, MENA: 700, SSA: 600 };
const SPONSOR_RATE = 0.3;
const PLACE_MEDALS = ["🏆", "🥈", "🥉", "🥉"];

// Player note (0 to 10), computed per game.
// raw = goals + 0.8 x saves + 0.002 x points. perf = raw / average raw of the 6 players in the game.
// note = NOTE_BASE + NOTE_SPREAD x (perf - 1) + MVP_BONUS if MVP, capped between 0 and 10.
const NOTE_WEIGHTS = { goal: 1.0, save: 0.8, point: 0.002 };
const NOTE_BASE = 6;
const NOTE_SPREAD = 6;
const MVP_BONUS = 1.5;

// Team colours by team id. Add new teams here.
const TEAM_COLORS = {
  "karmine-corp": "#1e6fd9",
  "team-vitality": "#f5c518",
  "ninjas-in-pyjamas": "#2e9e4f",
  "team-falcons": "#1f8a3b",
  nrg: "#f07c1e",
};

let players = {};
let teams = [];
let user = null;
let career = null;
let seasonStats = {};

// Pages of the season viewer (built from the saved season), and the current page index.
let viewerPages = null;
let viewerIndex = 0;

// ---------- Data ----------
function hash(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function makeStats(id, region, override) {
  const base = REGION_LEVEL[region] ?? 60;
  const stats = {};
  for (const s of STATS) {
    const jitter = (hash(id + s) % 11) - 5;
    stats[s] = Math.min(99, Math.max(1, base + jitter));
  }
  return { ...stats, ...override };
}

async function loadData() {
  const [rawTeams, overrides] = await Promise.all([
    fetch("data/teams.json").then((r) => r.json()),
    fetch("data/stats.json").then((r) => r.json()),
  ]);
  players = {};
  teams = rawTeams.map((t) => {
    const playerIds = t.players.map((p) => {
      const { salary, ...statOverride } = overrides[p.id] ?? {};
      const player = {
        id: p.id,
        name: p.name,
        teamId: t.id,
        teamName: t.name,
        region: t.region,
        stats: makeStats(p.id, t.region, statOverride),
        salary: 0,
      };
      player.salary = salary ?? Math.round(overall(player) * 1.2);
      players[p.id] = player;
      return p.id;
    });
    const team = {
      id: t.id,
      name: t.name,
      region: t.region,
      budget: REGION_BUDGET[t.region] ?? 600,
      color: TEAM_COLORS[t.id] ?? null,
      playerIds,
      rating: 0,
    };
    team.rating = teamOverall(team);
    return team;
  });
}

const teamById = (id) => teams.find((t) => t.id === id);

// ---------- Logos ----------
function initials(name) {
  const letters = name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 3);
  return (letters || name.slice(0, 2)).toUpperCase();
}

// Text colour that stays readable on the team colour.
function textOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#000" : "#fff";
}

function logoHTML(team) {
  const bg = team.color ?? `hsl(${hash(team.id) % 360} 55% 40%)`;
  const fg = team.color ? textOn(team.color) : "#fff";
  return `<span class="logo" style="background:${bg};color:${fg}"><b>${esc(initials(team.name))}</b><img src="logos/${esc(team.id)}.png" alt="" onerror="this.remove()"></span>`;
}

// ---------- Ratings ----------
function overall(p) {
  return Object.entries(STAT_WEIGHTS).reduce((sum, [k, w]) => sum + p.stats[k] * w, 0);
}

function teamOverall(team) {
  return team.playerIds.reduce((s, id) => s + overall(players[id]), 0) / team.playerIds.length;
}

// Rating of one player for one game: base + pressure effect + random form.
function gameRating(p, pressure) {
  const form = (Math.random() + Math.random() + Math.random() - 1.5) * 4;
  const pressureEffect = ((p.stats.pressure - 50) / 50) * pressure * 3;
  return overall(p) + pressureEffect + form;
}

// Used by rlcs.js for every game: average of the players' ratings, plus each player's rating.
function rateTeam(team, pressure) {
  const ratings = team.playerIds.map((id) => ({ id, r: gameRating(players[id], pressure) }));
  const avg = ratings.reduce((s, x) => s + x.r, 0) / ratings.length;
  return { avg, ratings };
}

function pickWeighted(list, weight) {
  const total = list.reduce((s, x) => s + weight(x), 0);
  let r = Math.random() * total;
  for (const x of list) {
    r -= weight(x);
    if (r <= 0) return x;
  }
  return list[list.length - 1];
}

// ---------- Stats per game ----------
// Called by rlcs.js after each game. The winner is decided by rlcs.js; this only records the stats.
function recordGame({ a, b, aWins, ra, rb }) {
  const winner = aWins ? a : b;
  const loser = aWins ? b : a;
  const winnerRatings = aWins ? ra.ratings : rb.ratings;

  const game = {};
  const bump = (id, key) => {
    (game[id] ??= { goals: 0, saves: 0 })[key]++;
  };

  const gw = 3 + Math.floor(Math.random() * 4);
  const gl = Math.floor(Math.random() * gw);
  for (let i = 0; i < gw; i++) bump(pickWeighted(winner.playerIds, (id) => players[id].stats.attack), "goals");
  for (let i = 0; i < gl; i++) bump(pickWeighted(loser.playerIds, (id) => players[id].stats.attack), "goals");

  for (const team of [a, b]) {
    const n = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      bump(pickWeighted(team.playerIds, (id) => players[id].stats.goalkeeping + players[id].stats.defense), "saves");
    }
  }

  // MVP of the game: best-rated player of the winning team.
  const mvpId = winnerRatings.reduce((best, x) => (x.r > best.r ? x : best)).id;

  // First pass: raw performance of every player in this game.
  const ids = [...a.playerIds, ...b.playerIds];
  const raw = {};
  for (const id of ids) {
    const g = game[id] ?? { goals: 0, saves: 0 };
    const points = g.goals * 100 + g.saves * 50;
    raw[id] = NOTE_WEIGHTS.goal * g.goals + NOTE_WEIGHTS.save * g.saves + NOTE_WEIGHTS.point * points;
  }
  const avgRaw = ids.reduce((s, id) => s + raw[id], 0) / ids.length || 1;

  // Second pass: per-game note and season totals.
  for (const id of ids) {
    const s = (seasonStats[id] ??= { games: 0, goals: 0, saves: 0, points: 0, mvps: 0, score: 0 });
    const g = game[id] ?? { goals: 0, saves: 0 };
    const points = g.goals * 100 + g.saves * 50;
    const isMvp = id === mvpId;
    const perf = raw[id] / avgRaw;
    const note = Math.min(10, Math.max(0, NOTE_BASE + NOTE_SPREAD * (perf - 1) + (isMvp ? MVP_BONUS : 0)));

    s.games++;
    s.goals += g.goals;
    s.saves += g.saves;
    s.points += points;
    if (isMvp) s.mvps++;
    s.score += note;
  }
}

// Season note = average of the per-game notes (0 to 10).
const noteOf = (s) => (s?.games ? (s.score / s.games).toFixed(2) : "-");

// ---------- Simulation ----------
function runSeason(season) {
  seasonStats = {};
  return simulateSeason(teams, { season, rate: rateTeam, onGame: recordGame });
}

// ---------- Career ----------
const salaryCost = (team) => team.playerIds.reduce((sum, id) => sum + players[id].salary, 0);

async function saveCareer() {
  await sb.from("saves").upsert({ user_id: user.id, state: career ?? {}, updated_at: new Date().toISOString() });
}

// Last season played with the current format (older saves are ignored).
const lastSeason = () => career?.history?.filter((h) => h.splits).at(-1) ?? null;

// The season must be watched before the next one can be simulated.
const mustWatchFirst = () => Boolean(lastSeason()) && career?.seenSeason !== true;

// ---------- Display helpers ----------
function show(view) {
  ["auth", "setup", "game"].forEach((v) => ($(v).style.display = v === view ? "block" : "none"));
}

// Smallest power of 2 >= n: the bracket round the team reached (9th-16th -> Top 16, 5th-8th -> Top 8...).
const nextPow2 = (n) => {
  let p = 1;
  while (p < n) p *= 2;
  return p;
};
const topText = (place) => (place === 1 ? "Top 1 (winner)" : `Top ${nextPow2(place)}`);

// Medal and "Top N" label for a team in a ranking (1st place first).
function placement(ranking, id) {
  const i = ranking.indexOf(id);
  if (i < 0) return { medal: "", text: "Not qualified" };
  return { medal: PLACE_MEDALS[i] ?? "", text: topText(i + 1) };
}

// Ordinal: 1st, 2nd, 3rd, 4th...
const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// Sort teams by points (from an object id -> points), then by rating.
const sortByPoints = (list, points) => [...list].sort((a, b) => (points[b.id] - points[a.id]) || b.rating - a.rating);

const ROUND_NAMES = ["Final", "Semi-finals", "Quarter-finals", "Round of 16"];
function roundName(r, count) {
  return ROUND_NAMES[count - 1 - r] ?? `Round ${r + 1}`;
}

function matchHTML(m, uid) {
  if (m.bye) {
    const t = teamById(m.a);
    return `<div class="match"><div class="side">${logoHTML(t)}<span class="name">${esc(t.name)}</span><i>bye</i></div></div>`;
  }
  const aWon = m.winner === m.a;
  const row = (id, score, won) => {
    const t = teamById(id);
    return `<div class="side ${won ? "win" : "lose"}">${logoHTML(t)}<span class="name">${esc(t.name)}</span><b>${score}</b></div>`;
  };
  const mine = m.a === uid || m.b === uid ? " mine" : "";
  return `<div class="match${mine}">${row(m.a, m.scoreA, aWon)}${row(m.b, m.scoreB, !aWon)}</div>`;
}

// Bracket of an Open (Top 8 single elimination, from the old format).
function bracketHTML(rounds, uid) {
  if (!rounds || !rounds.length) return "<p>No matches.</p>";
  const cols = rounds
    .map((matches, r) => `<div class="round"><h5>${roundName(r, rounds.length)}</h5>${matches.map((m) => matchHTML(m, uid)).join("")}</div>`)
    .join("");
  return `<div class="wide"><div class="bracket">${cols}</div></div>`;
}

// One match from the tournament engine (teamA, teamB, label, bestOf, winnerId).
function engineMatchHTML(m, uid) {
  const row = (id, score) => {
    const t = teamById(id);
    const won = m.winnerId === id;
    return `<div class="side ${won ? "win" : "lose"}">${logoHTML(t)}<span class="name">${esc(t.name)}</span><b>${score}</b></div>`;
  };
  const mine = m.teamA === uid || m.teamB === uid ? " mine" : "";
  return `<div class="match${mine}">
    <div class="match-label">${esc(m.label)} · BO${m.bestOf}</div>
    ${row(m.teamA, m.scoreA)}${row(m.teamB, m.scoreB)}
  </div>`;
}

// Swiss stage (Opens): grouped by round, one line per match, winner in bold.
function swissHTML(matches, uid) {
  const byRound = {};
  for (const m of matches) (byRound[m.round] ??= []).push(m);
  return Object.entries(byRound)
    .map(([round, list]) => {
      const lines = list
        .map((m) => {
          const a = teamById(m.a), b = teamById(m.b);
          const aWon = m.winner === m.a;
          const mine = m.a === uid || m.b === uid ? " mine" : "";
          return `<div class="swiss-game${mine}"><span class="${aWon ? "w" : ""}">${esc(a.name)}</span> ${m.scoreA}-${m.scoreB} <span class="${aWon ? "" : "w"}">${esc(b.name)}</span></div>`;
        })
        .join("");
      return `<div class="swiss-round"><b>Round ${round}</b>${lines}</div>`;
    })
    .join("");
}

// Final ranking of an Open, 1st to 16th, with the points won.
function rankingHTML(open, uid) {
  const items = open.ranking
    .map((id, i) => {
      const t = teamById(id);
      const mine = id === uid ? " mine" : "";
      return `<li class="${mine.trim()}"><span>${i + 1}.</span>${logoHTML(t)}<span>${esc(t.name)}</span><span class="pts">${open.points[id] ?? 0} pts</span></li>`;
    })
    .join("");
  return `<ol class="ranking">${items}</ol>`;
}

// One Open, with its ranking, Swiss and playoffs. expanded = all parts open by default.
function openCard(open, uid, expanded = false) {
  const place = open.ranking.indexOf(uid) + 1;
  const o = expanded ? " open" : "";
  return `<details class="open"${o}>
    <summary>${esc(open.name)} : ${ordinal(place)}, ${topText(place)} (${open.points[uid] ?? 0} pts)</summary>
    <p class="hint">Format: 16 teams. Swiss BO3 (top 8 advance), then single-elimination playoffs (BO5, final BO7). Teams 9 to 16 are ranked by their Swiss record.</p>
    <details${o}><summary>Final ranking and points</summary>${rankingHTML(open, uid)}</details>
    <details${o}><summary>Swiss stage (BO3)</summary>${swissHTML(open.swissMatches, uid)}</details>
    <details${o}><summary>Playoffs (BO5, final BO7)</summary>${bracketHTML(open.playoffRounds, uid)}</details>
  </details>`;
}

// ---------- Major and Worlds: groups of 4, double-elimination playoffs ----------
// Group table: green = Upper QF, yellow = Lower R1, red = eliminated.
function groupHTML(g, uid) {
  const rows = g.standings
    .map((r, i) => {
      const t = teamById(r.id);
      const cls = i === 0 ? "adv-upper" : i < 3 ? "adv-lower" : "elim";
      const mine = r.id === uid ? " mine" : "";
      const diff = r.gw - r.gl;
      return `<tr class="${cls}${mine}"><td>${i + 1}</td><td>${logoHTML(t)} ${esc(t.name)}</td><td>${r.w}-${r.l}</td><td>${diff > 0 ? "+" : ""}${diff}</td></tr>`;
    })
    .join("");
  const matches = g.matches
    .map((m) => {
      const a = teamById(m.teamA), b = teamById(m.teamB);
      const aWin = m.winnerId === m.teamA;
      const mine = m.teamA === uid || m.teamB === uid ? " mine" : "";
      return `<div class="gm${mine}"><span class="gm-r">R${m.round}</span><span class="${aWin ? "w" : ""}">${esc(a.name)}</span><b>${m.scoreA}-${m.scoreB}</b><span class="${aWin ? "" : "w"}">${esc(b.name)}</span></div>`;
    })
    .join("");
  return `<div class="group">
    <h5>Group ${esc(g.id)}</h5>
    <table class="group-table"><tr><th>#</th><th>Team</th><th>W-L</th><th>Games</th></tr>${rows}</table>
    <div class="group-matches">${matches}</div>
  </div>`;
}

// Columns of the double-elimination playoffs, in reading order (Major and Worlds).
const PO_COLUMNS = [
  ["Upper QF", ["uq1", "uq2"]],
  ["Lower R1", ["lr1a", "lr1b", "lr1c", "lr1d"]],
  ["Lower R2", ["lr2a", "lr2b"]],
  ["Lower QF", ["lqf1", "lqf2"]],
  ["Semifinals", ["sf1", "sf2"]],
  ["Grand Final", ["gf"]],
];

// Columns of the Worlds play-in.
const PLAYIN_COLUMNS = [
  ["Upper QF", ["pu1", "pu2", "pu3", "pu4"]],
  ["Upper SF", ["pus1", "pus2"]],
  ["Lower QF", ["pl1", "pl2"]],
  ["Lower SF", ["pls1", "pls2"]],
];

// Columns of a regional LCQ (8 teams, Top 8).
const LCQ_COLUMNS = [
  ["Quarter-finals", ["qf1", "qf2", "qf3", "qf4"]],
  ["Semifinals", ["sf1", "sf2"]],
  ["Final", ["final"]],
];

function playoffsHTML(matches, uid, columns = PO_COLUMNS) {
  const byId = Object.fromEntries(matches.map((m) => [m.id, m]));
  const cols = columns
    .map(
      ([title, ids]) =>
        `<div class="po-col"><h5>${title}</h5>${ids.filter((id) => byId[id]).map((id) => engineMatchHTML(byId[id], uid)).join("")}</div>`
    )
    .join("");
  return `<div class="wide"><div class="playoffs">${cols}</div></div>`;
}

// Groups then playoffs (Major, and Worlds without the play-in).
function groupsPlayoffsHTML(stage, uid, title) {
  const groups = stage.groups.map((g) => groupHTML(g, uid)).join("");
  return `<div class="stage-view">
    <h4>${esc(title)} · Group stage</h4>
    <div class="groups">${groups}</div>
    <h4>${esc(title)} · Playoffs</h4>
    ${playoffsHTML(stage.playoffs.matches, uid)}
  </div>`;
}

// Play-in of the Worlds (8 teams, 4 reach the groups).
function playInHTML(stage, uid) {
  if (!stage.playIn) return "<p>No play-in data.</p>";
  return `<div class="stage-view">
    <h4>Play-in</h4>
    ${playoffsHTML(stage.playIn.matches, uid, PLAYIN_COLUMNS)}
    <p class="hint">The 4 play-in winners of the upper and lower brackets reach the groups.</p>
  </div>`;
}

// Summary of every regional LCQ of the season: winner, then the bracket.
function lcqSummaryHTML(result, uid) {
  if (!result.worlds.lcq?.length) return "<p>No LCQ this season.</p>";
  return result.worlds.lcq
    .map(
      (l) => `<div class="card region">
        <h4>LCQ ${esc(l.region)} · winner: ${esc(teamById(l.winnerId).name)}</h4>
        ${playoffsHTML(l.bracket.matches, uid, LCQ_COLUMNS)}
      </div>`
    )
    .join("");
}

// ---------- Qualification tables, one per region ----------
// rowCls: highlights the user's team and qualified teams.
function rowCls(t, team, qualified) {
  const c = [];
  if (t.id === team.id) c.push("mine");
  if (qualified) c.push("qualified");
  return c.length ? ` class="${c.join(" ")}"` : "";
}

function regionCard(title, hint, headers, rows) {
  return `<div class="card region">
    <h4>${title}</h4>
    <p class="hint">${hint}</p>
    <div class="scroll"><table>
      <tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>${rows}
    </table></div>
  </div>`;
}

// Major table for one region, using only the points of that split.
function majorRegionCard(result, split, team, region) {
  const field = new Set(split.major.field);
  const list = sortByPoints(teams.filter((t) => t.region === region), split.splitPoints);
  const rows = list
    .map((t, i) => {
      const q = field.has(t.id);
      return `<tr${rowCls(t, team, q)}><td>${i + 1}</td><td>${logoHTML(t)} ${esc(t.name)}</td><td>${split.splitPoints[t.id] ?? 0}</td><td>${q ? "Major" : ""}</td></tr>`;
    })
    .join("");
  const slots = result.slots[region] ?? 0;
  return regionCard(
    esc(region),
    `${slots} slot(s) at this Major. Split ${split.split} points only.`,
    ["#", "Team", "Split pts", "Status"],
    rows
  );
}

// Worlds table for one region, using total season points.
function worldsRegionCard(result, team, region) {
  const q = result.worlds.qualifiedVia;
  const list = sortByPoints(teams.filter((t) => t.region === region), result.totals);
  const rows = list
    .map((t, i) => {
      const status = q[t.id] === "direct" ? "Worlds" : q[t.id] === "play_in" ? "Play-in" : "";
      return `<tr${rowCls(t, team, !!status)}><td>${i + 1}</td><td>${logoHTML(t)} ${esc(t.name)}</td><td>${result.totals[t.id] ?? 0}</td><td>${result.majorPoints[t.id] ?? 0}</td><td>${status}</td></tr>`;
    })
    .join("");
  const quota = result.worlds.quota[region] ?? 0;
  const bonus = result.worlds.bonusRegion === region ? " (includes the bonus slot)" : "";
  return regionCard(
    esc(region),
    `${quota} Worlds qualifier(s)${bonus}. Top 12 qualifiers go direct, the others play the play-in. Total = 6 Opens + 2 Majors.`,
    ["#", "Team", "Total", "Majors", "Worlds"],
    rows
  );
}

function worldsTablesHTML(result, team) {
  const tables = REGION_ORDER.filter((r) => teams.some((t) => t.region === r))
    .map((r) => worldsRegionCard(result, team, r))
    .join("");
  return `<h4>Worlds qualification (total season points)</h4><div class="tables">${tables}</div>`;
}

function majorTablesHTML(result, split, team) {
  const tables = REGION_ORDER.filter((r) => teams.some((t) => t.region === r))
    .map((r) => majorRegionCard(result, split, team, r))
    .join("");
  return `<h4>Major ${split.split} qualification (split ${split.split} points)</h4><div class="tables">${tables}</div>`;
}

// ---------- Season viewer: one page per step ----------
// Each page is { title, html() }. Pages are built from the saved season.

function openPageHTML(open, uid) {
  return openCard(open, uid, true);
}

function majorPageHTML(result, split, team) {
  return `${majorTablesHTML(result, split, team)}
    <p class="hint">Teams: ${split.major.field.map((id) => esc(teamById(id).name)).join(", ")}</p>
    ${groupsPlayoffsHTML(split.major.stage, team.id, split.major.name)}`;
}

// LCQ of the user's region: the user is an entrant.
function lcqPageHTML(l, team) {
  const won = l.winnerId === team.id;
  const text = won
    ? "Your team wins the LCQ and goes to the Worlds play-in."
    : `Your team is eliminated. Winner: ${esc(teamById(l.winnerId).name)}.`;
  return `<p>${text}</p>${playoffsHTML(l.bracket.matches, team.id, LCQ_COLUMNS)}`;
}

// Worlds page for a qualified team: groups and playoffs (play-in and LCQ are separate pages).
function worldsPageHTML(result, team) {
  return `${worldsTablesHTML(result, team)}${groupsPlayoffsHTML(result.worlds.stage, team.id, "World Championship")}`;
}

// Worlds page for a team that did not qualify: everything in one page, as a spectator.
function worldsSpectatorHTML(result, team) {
  return `<p>Your team is not in the Worlds. You are watching the whole event.</p>
    <h4>LCQ summary</h4>${lcqSummaryHTML(result, team.id)}
    <h4>Play-in</h4>${playInHTML(result.worlds.stage, team.id)}
    ${worldsTablesHTML(result, team)}
    ${groupsPlayoffsHTML(result.worlds.stage, team.id, "World Championship")}`;
}

function buildPages(result, team) {
  const uid = team.id;
  const pages = [];

  for (const s of result.splits) {
    s.opens
      .filter((o) => o.region === team.region)
      .forEach((o) => pages.push({ title: `Split ${s.split} · ${o.name}`, html: () => openPageHTML(o, uid) }));
    if (s.major.field.includes(uid)) {
      pages.push({ title: `Split ${s.split} · ${s.major.name}`, html: () => majorPageHTML(result, s, team) });
    }
  }

  // Your regional LCQ, if you were an entrant.
  const lcqMine = result.worlds.lcq?.find((l) => l.bracket.matches.some((m) => m.teamA === uid || m.teamB === uid));
  if (lcqMine) pages.push({ title: `LCQ · ${lcqMine.region}`, html: () => lcqPageHTML(lcqMine, team) });

  const status = result.worlds.qualifiedVia[uid];
  if (status) {
    // Qualified (direct or play-in): one page each for the LCQ summary, the play-in and the Worlds.
    if (result.worlds.lcq?.length) {
      pages.push({ title: "LCQ · summary", html: () => lcqSummaryHTML(result, uid) });
    }
    pages.push({ title: "Worlds · Play-in", html: () => playInHTML(result.worlds.stage, uid) });
    pages.push({ title: "World Championship", html: () => worldsPageHTML(result, team) });
  } else {
    // Not qualified: play-in, LCQ and Worlds stay together in one page.
    pages.push({ title: "World Championship (spectator)", html: () => worldsSpectatorHTML(result, team) });
  }
  return pages;
}

function renderPage(i) {
  if (!viewerPages?.length) return;
  viewerIndex = Math.max(0, Math.min(i, viewerPages.length - 1));
  const page = viewerPages[viewerIndex];
  $("home").style.display = "none";
  $("viewer").style.display = "block";
  $("v-progress").textContent = `${viewerIndex + 1} / ${viewerPages.length}`;
  $("v-title").textContent = page.title;
  $("v-content").innerHTML = page.html();
  $("v-prev").disabled = viewerIndex === 0;
  $("v-next").textContent = viewerIndex === viewerPages.length - 1 ? "End" : "Next";
  window.scrollTo(0, 0);
}

// Moves to a page. The URL hash follows, so the browser back button works.
function goPage(i) {
  location.hash = `p${i}`;
  renderPage(i);
}

// Opening the viewer marks the season as watched, which unlocks the next simulation.
async function markSeasonSeen() {
  if (career && career.seenSeason !== true) {
    career.seenSeason = true;
    await saveCareer();
    $("sim").disabled = false;
  }
}

async function enterViewer(i = 0) {
  if (!lastSeason()) return;
  viewerPages ??= buildPages(lastSeason(), teamById(career.userTeamId));
  await markSeasonSeen();
  goPage(i);
}

function closeViewer() {
  viewerPages = null;
  $("viewer").style.display = "none";
  $("home").style.display = "block";
}

function exitViewer() {
  if (location.hash) location.hash = "";
  closeViewer();
}

// Back and forward buttons of the browser, and manual hash changes.
window.addEventListener("hashchange", () => {
  const m = location.hash.match(/^#p(\d+)$/);
  if (m && lastSeason()) {
    viewerPages ??= buildPages(lastSeason(), teamById(career.userTeamId));
    renderPage(+m[1]);
  } else {
    closeViewer();
  }
});

// ---------- Home: summary, roster, leaders, all players ----------
function summaryHTML(result, team) {
  const status = result.worlds.qualifiedVia[team.id];
  const worldsText =
    status === "direct" ? "Qualified for Worlds (direct)"
    : status === "play_in" ? "Worlds play-in"
    : "Not qualified for Worlds";

  const splitRows = result.splits
    .map((s) => {
      const p = placement(s.major.ranking, team.id);
      const pts = s.splitPoints[team.id] ?? 0;
      return `<div class="row"><span class="medal">${p.medal}</span><b>${esc(s.major.name)}</b> : ${p.text} | split points: ${pts}</div>`;
    })
    .join("");

  const w = placement(result.worlds.ranking, team.id);
  const wRow = status ? `<div class="row"><span class="medal">${w.medal}</span><b>World Championship</b> : ${w.text}</div>` : "";

  const mvp = result.mvp;
  const mvpBox = mvp
    ? `<div class="mvp-box">🏆 Season MVP: <b>${esc(players[mvp]?.name ?? "?")}</b> (${esc(players[mvp]?.teamName ?? "")}) | note ${noteOf(result.players[mvp])} / 10</div>`
    : "";

  return `<p>Season ${result.season} champion: <b>${esc(teamById(result.champion).name)}</b></p>
    <p>Season total points: <b>${result.totals[team.id] ?? 0}</b> | ${worldsText}</p>
    ${whyHTML(result, team)}
    ${mvpBox}${splitRows}${wRow}`;
}

// Explains, in plain words, why the team is or is not qualified for the Worlds.
function whyHTML(result, team) {
  const status = result.worlds.qualifiedVia[team.id];
  const regionTeams = sortByPoints(teams.filter((t) => t.region === team.region), result.totals);
  const rank = regionTeams.findIndex((t) => t.id === team.id) + 1;
  const quota = result.worlds.quota[team.region] ?? 0;
  const total = result.totals[team.id] ?? 0;

  if (status === "direct") {
    return `<p>You have ${total} season points. You are ${ordinal(rank)} in ${esc(team.region)}, which has ${quota} Worlds qualifier(s). The 12 best qualifiers by season points go straight to the groups, so you qualify directly.</p>`;
  }
  if (status === "play_in") {
    return `<p>You have ${total} season points. You are ${ordinal(rank)} in ${esc(team.region)}. You are not among the 12 best qualifiers, so you play the Worlds play-in: 4 of the 8 play-in teams reach the groups.</p>`;
  }
  return `<p>You have ${total} season points and are ${ordinal(rank)} in ${esc(team.region)}. ${esc(team.region)} has ${quota} Worlds qualifier(s), and you did not earn one.</p>`;
}

function rosterHTML(team, sp) {
  const head = `<tr><th>Player</th><th>OVR</th><th>Pressure</th><th>Salary ($K)</th><th>Worlds</th><th>Goals</th><th>Saves</th><th>Points</th><th>Note</th></tr>`;
  const rows = team.playerIds
    .map((id) => {
      const p = players[id];
      const s = sp[id];
      return `<tr><td>${esc(p.name)}</td><td>${Math.round(overall(p))}</td><td>${p.stats.pressure}</td><td>${p.salary}</td><td>${career.worlds?.[id] ?? 0}</td><td>${s?.goals ?? 0}</td><td>${s?.saves ?? 0}</td><td>${s?.points ?? 0}</td><td>${noteOf(s)}</td></tr>`;
    })
    .join("");
  return head + rows;
}

function leadersHTML(sp) {
  const rows = Object.entries(sp)
    .filter(([, s]) => s.games > 0)
    .map(([id, s]) => ({
      name: players[id]?.name ?? id,
      goals: s.goals,
      saves: s.saves,
      points: s.points,
      note: s.score / s.games,
    }));
  const block = (title, key, fmt) => {
    const top = [...rows].sort((a, b) => b[key] - a[key]).slice(0, 5);
    return `<div><h4>${title}</h4><ol>${top.map((r) => `<li>${esc(r.name)} : ${fmt(r)}</li>`).join("")}</ol></div>`;
  };
  return (
    block("Note", "note", (r) => r.note.toFixed(2)) +
    block("Points", "points", (r) => r.points) +
    block("Goals", "goals", (r) => r.goals) +
    block("Saves", "saves", (r) => r.saves)
  );
}

// Sorted by season note when a season has been played (then by OVR), otherwise by OVR.
function allPlayersHTML(sp) {
  const seasonNote = (id) => (sp[id]?.games ? sp[id].score / sp[id].games : -1);
  const list = Object.values(players).sort(
    (a, b) => seasonNote(b.id) - seasonNote(a.id) || overall(b) - overall(a)
  );
  const head = `<tr><th>Player</th><th>Team</th><th>OVR</th><th>Worlds</th><th>Note</th></tr>`;
  const rows = list
    .map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.teamName)}</td><td>${Math.round(overall(p))}</td><td>${career.worlds?.[p.id] ?? 0}</td><td>${noteOf(sp[p.id])}</td></tr>`)
    .join("");
  return head + rows;
}

function render() {
  closeViewer();
  if (!career) {
    show("setup");
    $("team-select").innerHTML = REGIONS.map((r) => {
      const list = teams.filter((t) => t.region === r);
      if (!list.length) return "";
      return `<optgroup label="${r}">${list.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</optgroup>`;
    }).join("");
    return;
  }
  show("game");
  const team = teamById(career.userTeamId);
  const last = lastSeason();
  const sp = last?.players ?? {};
  $("team-title").textContent = `${team.name}: Season ${career.season}`;
  $("team-info").textContent = `Budget: $${Math.round(career.budgets[team.id])}K | Salary cost per season: $${salaryCost(team)}K`;
  $("view-season").style.display = last ? "inline-block" : "none";
  $("sim").disabled = mustWatchFirst();
  $("summary").innerHTML = last ? summaryHTML(last, team) : "<p>No season played yet.</p>";
  $("roster").innerHTML = rosterHTML(team, sp);
  $("leaders").innerHTML = last ? leadersHTML(sp) : "";
  $("all-players").innerHTML = allPlayersHTML(sp);
}

// ---------- Events ----------
$("signup").onclick = async () => {
  const { data, error } = await sb.auth.signUp({ email: $("email").value, password: $("password").value });
  if (error) $("msg").textContent = error.message;
  else if (data.session) start();
  else $("msg").textContent = "Account created. Confirm your email, then log in.";
};

$("login").onclick = async () => {
  const { error } = await sb.auth.signInWithPassword({ email: $("email").value, password: $("password").value });
  if (error) $("msg").textContent = error.message;
  else start();
};

$("logout").onclick = async () => {
  await sb.auth.signOut();
  location.reload();
};

$("new-career").onclick = async () => {
  career = {
    season: 1,
    userTeamId: $("team-select").value,
    budgets: Object.fromEntries(teams.map((t) => [t.id, t.budget])),
    worlds: {},
    history: [],
    seenSeason: true,
  };
  await saveCareer();
  render();
};

$("reset").onclick = async () => {
  if (!confirm("Delete your career and start over?")) return;
  career = null;
  await saveCareer();
  render();
};

$("view-season").onclick = () => enterViewer(0);
$("v-back").onclick = () => exitViewer();
$("v-prev").onclick = () => goPage(viewerIndex - 1);
$("v-next").onclick = () => (viewerIndex === viewerPages.length - 1 ? exitViewer() : goPage(viewerIndex + 1));

$("sim").onclick = async () => {
  if (mustWatchFirst()) return;
  $("sim").disabled = true;
  $("sim").textContent = "Simulating...";

  const result = runSeason(career.season);

  // Budgets: sponsors minus salaries, then Worlds prize money.
  for (const t of teams) {
    career.budgets[t.id] += Math.round(t.budget * SPONSOR_RATE) - salaryCost(t);
  }
  result.worlds.ranking.forEach((id, i) => (career.budgets[id] += PRIZES[i] ?? 0));

  // Worlds appearances per player.
  career.worlds ??= {};
  for (const id of result.worlds.field) {
    for (const pid of teamById(id).playerIds) career.worlds[pid] = (career.worlds[pid] ?? 0) + 1;
  }

  // Season MVP: best average note among players who played.
  const mvp = Object.entries(seasonStats)
    .filter(([, s]) => s.games > 0)
    .sort((a, b) => b[1].score / b[1].games - a[1].score / a[1].games)[0]?.[0] ?? null;

  career.history.push({
    season: career.season,
    champion: result.worlds.ranking[0],
    slots: result.slots,
    splits: result.splits,
    totals: result.totals,
    majorPoints: result.majorPoints,
    worlds: result.worlds,
    players: seasonStats,
    mvp,
  });
  career.season++;
  // A new season is unlocked only after it has been watched.
  career.seenSeason = false;

  await saveCareer();
  $("sim").disabled = false;
  $("sim").textContent = "Simulate season";
  if (location.hash) location.hash = "";
  render();
};

// ---------- Start ----------
async function start() {
  const { data } = await sb.auth.getUser();
  user = data.user;
  $("logout").style.display = user ? "inline-block" : "none";
  if (!user) return show("auth");
  await loadData();
  const { data: row } = await sb.from("saves").select("state").eq("user_id", user.id).maybeSingle();
  career = row?.state?.userTeamId ? row.state : null;
  render();
  // Reopen the viewer at the same page after a reload (e.g. "#p3").
  const m = location.hash.match(/^#p(\d+)$/);
  if (m) enterViewer(+m[1]);
}

start();