import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------- Settings ----------
const STATS = ["mechanics", "gameSpeed", "attack", "defense", "goalkeeping", "mental", "pressure"];
const STAT_WEIGHTS = { mechanics: 0.2, gameSpeed: 0.15, attack: 0.2, defense: 0.15, goalkeeping: 0.1, mental: 0.2 };
const PRESSURE = { open: 0, regional: 1, major: 2, worlds: 3 };
const PRIZES = [300, 150, 100, 75, 50, 40, 30, 20];
const REGIONS = ["EU", "NA", "SAM", "OCE", "APAC"];
const REGION_LEVEL = { EU: 72, NA: 68, SAM: 64, OCE: 62, APAC: 58 };
const REGION_BUDGET = { EU: 1000, NA: 900, SAM: 700, OCE: 600, APAC: 600 };
const SPONSOR_RATE = 0.3;
const PLACE_NAMES = ["Champion", "Runner-up", "3rd place", "4th place"];
const PLACE_MEDALS = ["🏆", "🥈", "🥉", "🥉"];

let players = {};
let teams = [];
let user = null;
let career = null;
let seasonStats = {};

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
      players[p.id] = {
        id: p.id,
        name: p.name,
        teamId: t.id,
        teamName: t.name,
        region: t.region,
        stats: makeStats(p.id, t.region, statOverride),
        salary: 0,
      };
      players[p.id].salary = salary ?? Math.round(overall(players[p.id]) * 1.2);
      return p.id;
    });
    return { id: t.id, name: t.name, region: t.region, budget: REGION_BUDGET[t.region] ?? 600, playerIds };
  });
}

const teamById = (id) => teams.find((t) => t.id === id);

// ---------- Logos (generated unless logos/<team-id>.png exists) ----------
function initials(name) {
  const letters = name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 3);
  return (letters || name.slice(0, 2)).toUpperCase();
}

function logoHTML(team) {
  const hue = hash(team.id) % 360;
  return `<span class="logo" style="background:hsl(${hue} 55% 40%)"><b>${esc(initials(team.name))}</b><img src="logos/${esc(team.id)}.png" alt="" onerror="this.remove()"></span>`;
}

// ---------- Ratings ----------
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

function gameRating(p, pressure) {
  const form = (Math.random() + Math.random() + Math.random() - 1.5) * 4;
  const pressureEffect = ((p.stats.pressure - 50) / 50) * pressure * 3;
  return overall(p) + pressureEffect + form;
}

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

// ---------- Season stats ----------
function addStat(id, key, n = 1) {
  const s = (seasonStats[id] ??= { games: 0, goals: 0, saves: 0, mvps: 0 });
  s[key] += n;
}

const pointsOf = (s) => (s ? s.goals * 100 + s.saves * 50 : 0);
const noteOf = (s) => (s?.games ? (10 * s.mvps / s.games).toFixed(1) : "-");

// ---------- Simulation ----------
function playGame(a, b, pressure) {
  const ra = rateTeam(a, pressure);
  const rb = rateTeam(b, pressure);
  const aWins = Math.random() < 1 / (1 + Math.exp(-(ra.avg - rb.avg) / 8));
  const winner = aWins ? a : b;
  const loser = aWins ? b : a;
  const winnerRatings = aWins ? ra.ratings : rb.ratings;

  for (const id of [...a.playerIds, ...b.playerIds]) addStat(id, "games");

  // Goals: winner scores 3 to 6, loser scores fewer.
  const gw = 3 + Math.floor(Math.random() * 4);
  const gl = Math.floor(Math.random() * gw);
  for (let i = 0; i < gw; i++) addStat(pickWeighted(winner.playerIds, (id) => players[id].stats.attack), "goals");
  for (let i = 0; i < gl; i++) addStat(pickWeighted(loser.playerIds, (id) => players[id].stats.attack), "goals");

  // Saves: each team makes 1 to 4 saves, weighted by goalkeeping and defense.
  for (const team of [a, b]) {
    const n = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      addStat(pickWeighted(team.playerIds, (id) => players[id].stats.goalkeeping + players[id].stats.defense), "saves");
    }
  }

  // MVP: best-rated player of the winning team.
  const mvp = winnerRatings.reduce((best, x) => (x.r > best.r ? x : best));
  addStat(mvp.id, "mvps");

  return aWins;
}

function playSeries(a, b, bo, pressure) {
  const need = Math.floor(bo / 2) + 1;
  let wa = 0, wb = 0;
  while (wa < need && wb < need) {
    if (playGame(a, b, pressure)) wa++; else wb++;
  }
  return { scoreA: wa, scoreB: wb, winner: wa > wb ? a : b, loser: wa > wb ? b : a };
}

// Single-elimination bracket. The list must be in seed order.
// Returns every round (for display) and the final ranking (best first).
function knockout(list, bo, pressure) {
  let size = 1;
  while (size < list.length) size *= 2;
  const seeds = [...list, ...Array(size - list.length).fill(null)];

  let round = [];
  for (let i = 0; i < size / 2; i++) round.push([seeds[i], seeds[size - 1 - i]]);

  const rounds = [];
  const eliminated = [];
  while (true) {
    const matches = [], next = [], losers = [];
    for (const [a, b] of round) {
      if (!a || !b) {
        const w = a || b;
        matches.push({ a: w.id, b: null, bye: true, winner: w.id });
        next.push(w);
        continue;
      }
      const r = playSeries(a, b, bo, pressure);
      matches.push({ a: a.id, b: b.id, scoreA: r.scoreA, scoreB: r.scoreB, winner: r.winner.id });
      next.push(r.winner);
      losers.push(r.loser);
    }
    rounds.push(matches);
    eliminated.unshift(losers);
    if (next.length === 1) return { rounds, ranking: [next[0], ...eliminated.flat()] };
    round = [];
    for (let i = 0; i < next.length; i += 2) round.push([next[i], next[i + 1]]);
  }
}

function runSeason() {
  seasonStats = {};
  const stages = [];
  const stage = (name, key, list, bo, pressure, region = null) => {
    const res = knockout(list, bo, pressure);
    stages.push({ name, key, region, bo, rounds: res.rounds, ranking: res.ranking.map((t) => t.id) });
    return res.ranking;
  };

  // 1. Open: 64 random teams, BO3. Top 2 go to the Major.
  const openRank = stage("Open", "open", shuffle([...teams]).slice(0, 64), 3, PRESSURE.open);

  // 2. Regionals: 16 random teams per region, BO5. Top 2 of each region go to the Major.
  const regionalQualifiers = [];
  for (const region of REGIONS) {
    const field = shuffle(teams.filter((t) => t.region === region)).slice(0, 16);
    const rank = stage(`Regional ${region}`, "regional", field, 5, PRESSURE.regional, region);
    regionalQualifiers.push(...rank.slice(0, 2));
  }

  // 3. Major: BO5, seeded by rating. Duplicates removed. The top seeds get byes.
  const majorField = [...new Set([...openRank.slice(0, 2), ...regionalQualifiers])]
    .sort((a, b) => teamOverall(b) - teamOverall(a));
  const majorRank = stage("Major", "major", majorField, 5, PRESSURE.major);

  // 4. World Championship: top 8 of the Major, BO7.
  const worldsRank = stage("World Championship", "worlds", majorRank.slice(0, 8), 7, PRESSURE.worlds);

  return { stages, worldsRank };
}

// ---------- Career ----------
const salaryCost = (team) => team.playerIds.reduce((sum, id) => sum + players[id].salary, 0);

async function saveCareer() {
  await sb.from("saves").upsert({ user_id: user.id, state: career ?? {}, updated_at: new Date().toISOString() });
}

// ---------- Display ----------
function show(view) {
  ["auth", "setup", "game"].forEach((v) => ($(v).style.display = v === view ? "block" : "none"));
}

function placement(ranking, teamId) {
  const i = ranking.indexOf(teamId);
  if (i < 0) return { medal: "", text: "Did not qualify" };
  return { medal: PLACE_MEDALS[i] ?? "", text: PLACE_NAMES[i] ?? `Place ${i + 1}` };
}

function roundName(r, count) {
  const fromEnd = count - 1 - r;
  return ["Final", "Semi-finals", "Quarter-finals"][fromEnd] ?? `Round ${r + 1}`;
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

function stageHTML(stage, uid) {
  const rounds = stage.rounds
    .map((matches, r) => `<div class="round"><h5>${roundName(r, stage.rounds.length)}</h5>${matches.map((m) => matchHTML(m, uid)).join("")}</div>`)
    .join("");
  return `<section class="card"><h3>${esc(stage.name)} <small>BO${stage.bo}</small></h3><div class="scroll"><div class="bracket">${rounds}</div></div></section>`;
}

function summaryHTML(season, team) {
  const relevant = season.stages.filter((s) => s.key !== "regional" || s.region === team.region);
  const rows = relevant
    .map((s) => {
      const p = placement(s.ranking, team.id);
      return `<div class="row"><span class="medal">${p.medal}</span><b>${esc(s.name)}</b> : ${p.text}</div>`;
    })
    .join("");
  return `<p>Season ${season.season} champion: <b>${esc(teamById(season.champion).name)}</b></p>${rows}`;
}

function rosterHTML(team, sp) {
  return `<tr><th>Player</th><th>OVR</th><th>Pressure</th><th>Salary ($K)</th><th>Goals</th><th>Saves</th><th>Points</th><th>Note</th></tr>` +
    team.playerIds
      .map((id) => {
        const p = players[id];
        const s = sp[id];
        return `<tr><td>${esc(p.name)}</td><td>${Math.round(overall(p))}</td><td>${p.stats.pressure}</td><td>${p.salary}</td><td>${s?.goals ?? 0}</td><td>${s?.saves ?? 0}</td><td>${pointsOf(s)}</td><td>${noteOf(s)}</td></tr>`;
      })
      .join("");
}

function leadersHTML(sp) {
  const rows = Object.entries(sp)
    .filter(([, s]) => s.games > 0)
    .map(([id, s]) => ({
      name: players[id].name,
      goals: s.goals,
      saves: s.saves,
      points: pointsOf(s),
      note: (10 * s.mvps) / s.games,
    }));
  const block = (title, key, fmt) => {
    const top = [...rows].sort((a, b) => b[key] - a[key]).slice(0, 5);
    return `<div><h4>${title}</h4><ol>${top.map((r) => `<li>${esc(r.name)} : ${fmt(r)}</li>`).join("")}</ol></div>`;
  };
  return (
    block("Points", "points", (r) => r.points) +
    block("Average note", "note", (r) => r.note.toFixed(1)) +
    block("Goals", "goals", (r) => r.goals) +
    block("Saves", "saves", (r) => r.saves)
  );
}

function allPlayersHTML(sp) {
  const list = Object.values(players).sort((a, b) => overall(b) - overall(a));
  return (
    `<tr><th>Player</th><th>Team</th><th>OVR</th><th>Note</th></tr>` +
    list
      .map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.teamName)}</td><td>${Math.round(overall(p))}</td><td>${noteOf(sp[p.id])}</td></tr>`)
      .join("")
  );
}

function render() {
  if (!career) {
    show("setup");
    $("team-select").innerHTML = REGIONS.map(
      (r) => `<optgroup label="${r}">${teams.filter((t) => t.region === r).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</optgroup>`
    ).join("");
    return;
  }
  show("game");
  const team = teamById(career.userTeamId);
  const last = career.history.filter((s) => s.stages).at(-1) ?? null;
  const sp = last?.players ?? {};
  $("team-title").textContent = `${team.name}: Season ${career.season}`;
  $("team-info").textContent = `Budget: $${Math.round(career.budgets[team.id])}K | Salary cost per season: $${salaryCost(team)}K`;
  $("summary").innerHTML = last ? summaryHTML(last, team) : "<p>No season played yet.</p>";
  $("brackets").innerHTML = last ? last.stages.map((s) => stageHTML(s, team.id)).join("") : "";
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
    history: [],
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

$("sim").onclick = async () => {
  $("sim").disabled = true;
  $("sim").textContent = "Simulating...";
  const { stages, worldsRank } = runSeason();
  for (const t of teams) {
    career.budgets[t.id] += Math.round(t.budget * SPONSOR_RATE) - salaryCost(t);
  }
  worldsRank.forEach((t, i) => (career.budgets[t.id] += PRIZES[i] ?? 0));
  career.history.push({ season: career.season, champion: worldsRank[0].id, stages, players: seasonStats });
  career.season++;
  await saveCareer();
  $("sim").disabled = false;
  $("sim").textContent = "Simulate season";
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