import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

// ---------- Settings ----------
const STATS = ["mechanics", "gameSpeed", "attack", "defense", "goalkeeping", "mental", "pressure"];
// Weights for a player's overall rating (they add up to 1). Pressure is not included.
const STAT_WEIGHTS = { mechanics: 0.2, gameSpeed: 0.15, attack: 0.2, defense: 0.15, goalkeeping: 0.1, mental: 0.2 };
// Pressure level of each competition (0 = none, 3 = Worlds).
const PRESSURE = { open: 0, regional: 1, major: 2, worlds: 3 };
// Worlds prize money by placement, in $K.
const PRIZES = [300, 150, 100, 75, 50, 40, 30, 20];
const REGIONS = ["EU", "NA", "SAM", "OCE", "APAC"];
// Average level of players per region. Each player gets a small fixed variation around it.
const REGION_LEVEL = { EU: 72, NA: 68, SAM: 64, OCE: 62, APAC: 58 };
// Starting budget per region, in $K.
const REGION_BUDGET = { EU: 1000, NA: 900, SAM: 700, OCE: 600, APAC: 600 };
// Each season, sponsors bring in this share of the starting budget (placeholder until V2).
const SPONSOR_RATE = 0.3;

let players = {};
let teams = [];
let user = null;
let career = null;

// ---------- Data ----------
function hash(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

// Same player always gets the same base stats. Values from stats.json override them.
function makeStats(id, region, override) {
  const base = REGION_LEVEL[region] ?? 60;
  const stats = {};
  for (const s of STATS) {
    const jitter = (hash(id + s) % 11) - 5; // -5 to +5
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
      const player = { name: p.name, region: t.region, stats: makeStats(p.id, t.region, statOverride) };
      player.salary = salary ?? Math.round(overall(player) * 1.2);
      players[p.id] = player;
      return p.id;
    });
    return { id: t.id, name: t.name, region: t.region, budget: REGION_BUDGET[t.region] ?? 600, playerIds };
  });
}

const teamById = (id) => teams.find((t) => t.id === id);

// ---------- Simulation ----------
const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

function overall(p) {
  return Object.entries(STAT_WEIGHTS).reduce((sum, [k, w]) => sum + p.stats[k] * w, 0);
}

const teamOverall = (team) => team.playerIds.reduce((s, id) => s + overall(players[id]), 0) / team.playerIds.length;

// Rating of one player for one game: base + pressure effect + random form.
function gameRating(p, pressure) {
  const form = (Math.random() + Math.random() + Math.random() - 1.5) * 4; // about -6 to +6
  const pressureEffect = ((p.stats.pressure - 50) / 50) * pressure * 3;   // up to about ±9 at max pressure
  return overall(p) + pressureEffect + form;
}

function teamRating(team, pressure) {
  const list = team.playerIds.map((id) => players[id]);
  return list.reduce((sum, p) => sum + gameRating(p, pressure), 0) / list.length;
}

// Plays a best-of series game by game. Each game is recalculated (form and pressure).
function playSeries(a, b, bo, pressure) {
  const need = Math.floor(bo / 2) + 1;
  let wa = 0, wb = 0;
  while (wa < need && wb < need) {
    const diff = teamRating(a, pressure) - teamRating(b, pressure);
    const pA = 1 / (1 + Math.exp(-diff / 8));
    if (Math.random() < pA) wa++; else wb++;
  }
  return { a: a.name, b: b.name, scoreA: wa, scoreB: wb, winner: wa > wb ? a : b, loser: wa > wb ? b : a };
}

// Single-elimination bracket. The list must already be in seed order.
// If the size is not a power of 2, the top seeds get a bye in round 1.
// Returns the matches and the final ranking (best first).
function knockout(list, bo, pressure) {
  let size = 1;
  while (size < list.length) size *= 2;
  const seeds = [...list, ...Array(size - list.length).fill(null)];

  let round = [];
  for (let i = 0; i < size / 2; i++) round.push([seeds[i], seeds[size - 1 - i]]);

  const matches = [];
  const eliminated = [];
  while (true) {
    const next = [], losers = [];
    for (const [a, b] of round) {
      if (!a || !b) { next.push(a || b); continue; } // bye
      const { winner, loser, ...match } = playSeries(a, b, bo, pressure);
      matches.push(match);
      next.push(winner);
      losers.push(loser);
    }
    eliminated.unshift(losers);
    if (next.length === 1) return { matches, ranking: [next[0], ...eliminated.flat()] };
    round = [];
    for (let i = 0; i < next.length; i += 2) round.push([next[i], next[i + 1]]);
  }
}

function runSeason() {
  const log = [];
  const stage = (name, list, bo, pressure) => {
    const res = knockout(list, bo, pressure);
    log.push({ stage: name, matches: res.matches });
    return res.ranking;
  };

  // 1. Open: 64 random teams, BO3, no pressure. Top 2 go to the Major.
  const openRank = stage("Open", shuffle([...teams]).slice(0, 64), 3, PRESSURE.open);

  // 2. Regionals: 16 random teams per region, BO5. Top 2 of each region go to the Major.
  const regionalQualifiers = [];
  for (const region of REGIONS) {
    const field = shuffle(teams.filter((t) => t.region === region)).slice(0, 16);
    regionalQualifiers.push(...stage(`Regional ${region}`, field, 5, PRESSURE.regional).slice(0, 2));
  }

  // 3. Major: 12 teams, BO5, seeded by rating. The top 4 seeds get a bye.
  const majorField = [...openRank.slice(0, 2), ...regionalQualifiers]
    .sort((a, b) => teamOverall(b) - teamOverall(a));
  const majorRank = stage("Major", majorField, 5, PRESSURE.major);

  // 4. World Championship: top 8 of the Major, BO7, maximum pressure.
  const worldsRank = stage("World Championship", majorRank.slice(0, 8), 7, PRESSURE.worlds);

  return { log, worldsRank };
}

// ---------- Career ----------
const salaryCost = (team) => team.playerIds.reduce((sum, id) => sum + players[id].salary, 0);

async function saveCareer() {
  await sb.from("saves").upsert({ user_id: user.id, state: career, updated_at: new Date().toISOString() });
}

// ---------- Display ----------
function show(view) {
  ["auth", "setup", "game"].forEach((v) => ($(v).style.display = v === view ? "block" : "none"));
}

function renderSeason(season, myTeamName) {
  const stages = season.log.map((s) => {
    const rows = s.matches
      .map((m) => {
        const mine = m.a === myTeamName || m.b === myTeamName;
        return `<li class="${mine ? "mine" : ""}">${m.a} ${m.scoreA}-${m.scoreB} ${m.b}</li>`;
      })
      .join("");
    return `<h4>${s.stage}</h4><ul>${rows}</ul>`;
  }).join("");
  return `<p><b>Season ${season.season} champion: ${season.champion}</b></p>${stages}`;
}

function render() {
  if (!career) {
    show("setup");
    $("team-select").innerHTML = teams.map((t) => `<option value="${t.id}">${t.name} (${t.region})</option>`).join("");
    return;
  }
  show("game");
  const team = teamById(career.userTeamId);
  $("team-title").textContent = `${team.name}: Season ${career.season}`;
  $("team-info").textContent = `Budget: $${Math.round(career.budgets[team.id])}K | Salary cost per season: $${salaryCost(team)}K`;
  $("roster").innerHTML =
    `<tr><th>Player</th><th>Overall</th><th>Pressure</th><th>Salary ($K)</th></tr>` +
    team.playerIds
      .map((id) => {
        const p = players[id];
        return `<tr><td>${p.name}</td><td>${Math.round(overall(p))}</td><td>${p.stats.pressure}</td><td>${p.salary}</td></tr>`;
      })
      .join("");
  const last = career.history.at(-1);
  $("results").innerHTML = last ? renderSeason(last, team.name) : "<p>No season played yet.</p>";
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
    history: [],
  };
  await saveCareer();
  render();
};

$("sim").onclick = async () => {
  const { log, worldsRank } = runSeason();
  for (const t of teams) {
    const sponsors = Math.round(t.budget * SPONSOR_RATE);
    career.budgets[t.id] += sponsors - salaryCost(t);
  }
  worldsRank.forEach((t, i) => (career.budgets[t.id] += PRIZES[i] ?? 0));
  career.history.push({ season: career.season, champion: worldsRank[0].name, log });
  career.season++;
  await saveCareer();
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
}

start();