#!/usr/bin/env node
// Build src/data/activity.json from the public GitHub API: what happened in github.com/amontlabs over the last
// 30 days, reduced to what a visitor can read at a glance (Node 22+; GITHUB_TOKEN advised: a busy repo needs a
// dozen requests).
//   scope      every public repository of the organisation with commits in the window, except EXCLUDE. Private,
//              archived and forked repositories are never read.
//   per repo   commits per day (30 values), totals for 30 and 7 days, and what GitHub knows about it: stars, forks,
//              licence, languages, when it started, its latest release. Plus a short explanation of what the
//              project is, written by Claude from its README and rewritten only when the README changes
//              (src/data/activity-explainers.json).
//   journal    one entry per active day, newest first: which projects moved and by how much, what was released,
//              and one short summary of the day written by Claude. The model is reached with ANTHROPIC_API_KEY
//              (the API, through the SDK) or, without one, with CLAUDE_CODE_OAUTH_TOKEN (a Claude subscription,
//              through the Claude Code CLI; the token comes from `claude setup-token`). With neither, the
//              journal quotes pull request titles instead.
//   summaries  kept in src/data/activity-summaries.json with a hash of what they were written from. A day is sent
//              to the model once, and again only if its commits, pull requests or releases changed: in practice
//              the current day on each run, and each day one last time after it ends.
// What the model is given for a day: every active project's description and README, the previous ten
// summaries, and per project the merged pull requests (title and description), the commit messages and the
// release notes. `--dry=<file>` writes those requests to a file without calling the model, to read or to size them.
// Days are Europe/Paris days. Always exits 0; a repo the API could not reach keeps its previous data.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

// not project work: the organisation profile, this site, and the brand repository
const EXCLUDE = new Set([".github", "amontlabs.com", "amont"]);
// names as the site writes them; any other repository goes by its GitHub name
const NAMES = { silo: "Silo", fjord: "Fjord", sic: "Sic", atelier: "atelier", lcu: "LCU", lastdrop: "lastdrop", hartlib: "Hartlib" };
const FILE = new URL("../src/data/activity.json", import.meta.url);
const SUMMARIES = new URL("../src/data/activity-summaries.json", import.meta.url);
const EXPLAINERS = new URL("../src/data/activity-explainers.json", import.meta.url);
// Provider chain: Claude subscription 1 -> Claude subscription 2 -> OpenRouter -> Anthropic API
const getProviders = () => {
  const list = [];
  const token1 = process.env.CLAUDE_CODE_OAUTH_TOKEN_1 || process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (token1) list.push({ kind: "claude-code", id: "claude-subscription-1", token: token1 });
  const token2 = process.env.CLAUDE_CODE_OAUTH_TOKEN_2;
  if (token2 && token2 !== token1) list.push({ kind: "claude-code", id: "claude-subscription-2", token: token2 });
  if (process.env.OPENROUTER_API_KEY) list.push({ kind: "openrouter", id: "openrouter", key: process.env.OPENROUTER_API_KEY });
  if (process.env.ANTHROPIC_API_KEY) list.push({ kind: "api", id: "anthropic-api", key: process.env.ANTHROPIC_API_KEY });
  return list;
};

const providers = getProviders();
const VIA = providers.length > 0;
const MODEL = process.env.ACTIVITY_MODEL ?? "claude-opus-5-5";
const DRY = process.argv.find((a) => a.startsWith("--dry="))?.slice(6);
const DAYS = 30,
  LOG_DAYS = 30;
// What the model reads is not trimmed for size: these ceilings are only there so that an accident (a generated
// file pasted into a commit message, a release note with a full changelog) cannot swamp a request.
const MAX_COMMITS = 600; // commit messages per project and day; the rest are counted, and it is told so
const MAX = { pull: 20000, commit: 8000, release: 20000, readme: 30000 }; // characters
const PREVIOUS = 10; // earlier summaries it is shown, for continuity
const AIM = 280, // characters the summary is asked to stay within
  LIMIT = 360; // past this it is asked to shorten what it wrote
const headers = { Accept: "application/vnd.github+json", "User-Agent": "amontlabs.com" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const paris = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dayOf = (iso) => paris.format(new Date(iso));
const now = new Date();
const days = Array.from({ length: DAYS }, (_, i) => dayOf(new Date(now.getTime() - (DAYS - 1 - i) * 864e5)));
const since = new Date(now.getTime() - (DAYS + 1) * 864e5).toISOString();
const logDays = days.slice(-LOG_DAYS);

const api = (path) => `https://api.github.com/${path.startsWith("orgs/") ? "" : "repos/amontlabs/"}${path}`;
const get = async (path) => {
  const out = [];
  for (let page = 1; page <= 30; page++) {
    const r = await fetch(`${api(path)}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`, { headers });
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
};
const first = (m) => m.split("\n")[0].trim();
const rest = (m) => m.split("\n").slice(1).join("\n").trim();
const cut = (s, n) => (s && s.length > n ? `${s.slice(0, n)} […]` : (s ?? ""));
const noise = (s) => /^(merge\b|chore(\(.*\))?:|ci(\(.*\))?:|build(\(.*\))?:|docs\(release\)|bump\b)/i.test(s);
const tidy = (s) => s.replace(/\s*\(#\d+\)$/, "");
const bot = (login) => !login || /\[bot\]$/.test(login);
const read = (url) => {
  try {
    return JSON.parse(readFileSync(url, "utf8"));
  } catch {
    return {};
  }
};
const prev = read(FILE);
const cache = read(SUMMARIES);

let list = Object.keys(prev.repos ?? {}).map((name) => ({ name, description: "" }));
try {
  list = (await get("orgs/amontlabs/repos?type=public")).filter(
    (r) => !r.private && !r.archived && !r.fork && !EXCLUDE.has(r.name),
  );
} catch (e) {
  console.error("repository list not updated:", e.message);
}

const repos = {},
  people = new Set(),
  about = {},
  // day -> repo -> what happened
  book = new Map(logDays.map((d) => [d, new Map()]));
let commitsAll = 0,
  releasesAll = 0,
  mergedAll = 0,
  outsideAll = 0,
  issuesAll = 0;
const failed = new Set();
for (const { name, description, ...gh } of list) {
  try {
    const [commits, pulls, releases, closed] = await Promise.all([
      get(`${name}/commits?since=${since}`),
      get(`${name}/pulls?state=closed&sort=updated&direction=desc`),
      get(`${name}/releases`),
      get(`${name}/issues?state=closed&since=${since}`),
    ]);
    const daily = days.map(() => 0);
    const merged = pulls.filter((p) => p.merged_at && days.includes(dayOf(p.merged_at)));
    // pull requests from people outside the organisation (not its owner or members, not bots)
    const outside = merged.filter((p) => !bot(p.user?.login) && !["OWNER", "MEMBER"].includes(p.author_association));
    // the issues endpoint lists pull requests too
    const issues = closed.filter((i) => !i.pull_request && i.closed_at && days.includes(dayOf(i.closed_at)));
    const rels = releases.filter(
      (r) => !r.draft && !r.prerelease && /^v\d/.test(r.tag_name) && days.includes(dayOf(r.published_at)),
    );
    const page = (d) => {
      if (!book.has(d)) return null;
      if (!book.get(d).has(name)) book.get(d).set(name, { n: 0, commits: [], pulls: [], releases: [] });
      return book.get(d).get(name);
    };
    for (const c of commits) {
      const d = dayOf(c.commit.author.date),
        i = days.indexOf(d);
      if (i < 0) continue;
      daily[i]++;
      if (!bot(c.author?.login)) people.add(c.author.login);
      const p = page(d);
      if (!p) continue;
      p.n++;
      if (!noise(first(c.commit.message))) p.commits.push(c.commit.message);
    }
    for (const p of merged) {
      if (!bot(p.user?.login)) people.add(p.user.login);
      page(dayOf(p.merged_at))?.pulls.push(p);
    }
    for (const r of rels) page(dayOf(r.published_at))?.releases.push(r);
    const total = daily.reduce((a, b) => a + b, 0);
    if (!total && !merged.length && !rels.length && !issues.length) continue;
    const langs = await fetch(api(`${name}/languages`), { headers }).then((r) => (r.ok ? r.json() : {}));
    const bytes = Object.values(langs).reduce((a, b) => a + b, 0);
    // the project's whole life, week by week (GitHub keeps the last 52; it answers 202 while it computes them)
    let weeks = prev.repos?.[name]?.weeks ?? [];
    for (let k = 0; k < 4; k++) {
      const r = await fetch(api(`${name}/stats/commit_activity`), { headers });
      if (r.status === 200) {
        const rows = await r.json();
        const from = rows.findIndex((w) => w.total > 0);
        if (from >= 0) weeks = rows.slice(from).map((w) => ({ w: new Date(w.week * 1000).toISOString().slice(0, 10), n: w.total }));
        break;
      }
      if (r.status !== 202) break;
      await new Promise((ok) => setTimeout(ok, 2500));
    }
    const shipped = releases.filter((r) => !r.draft && !r.prerelease && /^v\d/.test(r.tag_name)).map((r) => r.published_at.slice(0, 10)).sort();
    const out = releases
      .filter((r) => !r.draft && !r.prerelease && /^v\d/.test(r.tag_name))
      .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))[0];
    about[name] = description ?? "";
    repos[name] = {
      name: NAMES[name] ?? name,
      about: description ?? "",
      stars: gh.stargazers_count ?? prev.repos?.[name]?.stars ?? 0,
      forks: gh.forks_count ?? prev.repos?.[name]?.forks ?? 0,
      license: gh.license && gh.license.spdx_id !== "NOASSERTION" ? gh.license.spdx_id : null,
      created: gh.created_at ?? prev.repos?.[name]?.created ?? null,
      // the three main languages, as shares of the code (anything under 3% is left out)
      languages: Object.entries(langs)
        .map(([k, v]) => ({ name: k, share: Math.round((v / bytes) * 100) }))
        .filter((l) => l.share >= 3)
        .slice(0, 3),
      latest: out ? { tag: out.tag_name, at: out.published_at, url: out.html_url } : null,
      weeks,
      shipped,
      daily,
      commits: total,
      week: daily.slice(-7).reduce((a, b) => a + b, 0),
      merged: merged.length,
      outside: outside.length,
      issues: issues.length,
      releases: rels.length,
    };
    commitsAll += total;
    mergedAll += merged.length;
    outsideAll += outside.length;
    issuesAll += issues.length;
    releasesAll += rels.length;
  } catch (e) {
    console.error(`${name} not updated:`, e.message);
    failed.add(name);
    if (prev.repos?.[name]) repos[name] = prev.repos[name];
  }
}

// ---- the journal: one entry per active day
const quiet = (p) => bot(p.user?.login) || noise(p.title) || /^(docs|test|build)(\(.*\))?:/i.test(p.title);
const journal = [],
  material = new Map();
for (const d of [...logDays].reverse()) {
  const pages = [...book.get(d)].sort((a, b) => b[1].n - a[1].n);
  if (!pages.length) continue;
  journal.push({
    day: d,
    repos: pages.map(([repo, p]) => ({ repo, n: p.n, merged: p.pulls.length })),
    releases: pages
      .filter(([, p]) => p.releases.length)
      .map(([repo, p]) => {
        const r = p.releases.sort((a, b) => new Date(a.published_at) - new Date(b.published_at));
        return {
          repo,
          to: r.at(-1).tag_name,
          from: r.length > 1 ? r[0].tag_name : null,
          n: r.length,
          url: r.at(-1).html_url,
        };
      }),
    // without a summary the entry quotes the day's first pull requests, people's work before chores
    highlights: pages
      .flatMap(([repo, p]) => p.pulls.filter((x) => !quiet(x)).map((x) => ({ repo, text: x.title, url: x.html_url })))
      .slice(0, 3),
  });
  material.set(
    d,
    pages
      .filter(([, p]) => p.commits.length || p.pulls.length || p.releases.length)
      .map(([repo, p]) => ({
        repository: repo,
        name: NAMES[repo] ?? repo,
        commits_total: p.n,
        pull_requests_merged: p.pulls
          .sort((a, b) => quiet(a) - quiet(b))
          .map((x) => ({ title: x.title, description: quiet(x) ? undefined : cut(x.body, MAX.pull) || undefined })),
        commits: (() => {
          const prTitles = new Set(p.pulls.map((x) => tidy(first(x.title)).toLowerCase()));
          return p.commits
            .slice(0, MAX_COMMITS)
            .map((m) => {
              const subject = tidy(first(m));
              const isDupe = prTitles.has(subject.toLowerCase());
              return { subject, body: isDupe ? undefined : cut(rest(m), MAX.commit) || undefined };
            });
        })(),
        commits_not_shown: Math.max(0, p.commits.length - MAX_COMMITS) || undefined,
        releases: p.releases.map((x) => ({ version: x.tag_name, notes: cut(x.body, MAX.release) })),
      })),
  );
}
// a day of a repo that could not be read keeps what the site already says about it
if (failed.size)
  for (const e of prev.journal ?? [])
    if (!journal.some((x) => x.day === e.day) && logDays.includes(e.day)) journal.push(e);
journal.sort((a, b) => (a.day < b.day ? 1 : -1));

// ---- summaries: one per day, written once and again only when the day's content changed
const SYSTEM = `You write the daily activity journal on amontlabs.com, the site of Amont Labs, a small lab building what AI agents need to do real work. Visitors who have never seen these repositories read the journal to learn what the lab is working on and how much is happening. They are technical, but they do not know the projects' internals.

You receive one day of work as JSON: for each project that moved, what the project is (its description and its README), its merged pull requests with their descriptions, its commit messages, and any releases with their notes. You also receive the previous days' summaries, so that you can say when work continues or lands rather than repeat yourself. If "day_is_over" is false, the day is still going and you are describing it so far.

Write the summary of that day for a reader who knows nothing about these projects:

- Be concise and very simple: one to three short sentences, at most ${AIM} characters in total. Shorter is better when the day was small. Plain text, no markdown, no lists.
- Use everyday words. Say what a project can now do or what was fixed, the way you would tell a friend who does not work on it. No internal names, phase codes, file names or jargon; if a term would need explaining, say the plain thing instead. Use the README to understand the project's vocabulary, then leave that vocabulary out.
- Pick the one or two things that matter most that day and leave the rest out. A project with only housekeeping (formatting, CI, dependency bumps, release chores, review follow-ups) can be left out entirely.
- Name each project you mention by its "name", written exactly that way.
- Mention a release only when it is the news of the day; releases are listed next to your text.
- State only what the material supports. Never add a purpose, a benefit, a number or a claim that is not in it, and do not judge the work ("major", "powerful"). The text is published without review, so anything not in the input would be an invented claim on the lab's own site.
- Past tense, no "we", no "the team", no "today".`;
const hash = (m) => createHash("sha1").update(JSON.stringify(m)).digest("hex");
const summaries = {};
for (const [d, m] of material) if (cache[d]?.hash === hash(m)) summaries[d] = cache[d];
const pending = [...material].filter(([d, m]) => !summaries[d] && m.length).reverse(); // oldest first
const readmes = {};
const readme = async (repo) => {
  if (!(repo in readmes)) {
    const r = await fetch(api(`${repo}/readme`), { headers: { ...headers, Accept: "application/vnd.github.raw+json" } });
    if (r.ok) {
      const full = await r.text();
      // Keep overview and architecture up to installation/developer sections
      const intro = full.split(/\n##+ (?:Install|Develop|Build from source|Development|Help and license)\b/i)[0];
      readmes[repo] = cut(intro, 8000);
    } else {
      readmes[repo] = "";
    }
  }
  return readmes[repo];
};
const today = days.at(-1);
const request = async (d, m) => ({
  day: d,
  weekday: new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`)),
  day_is_over: d !== today,
  previous_summaries: Object.entries({ ...cache, ...summaries })
    .filter(([k]) => k < d)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, PREVIOUS)
    .map(([k, v]) => ({ day: k, text: v.text })),
  projects: await Promise.all(
    m.map(async (x) => ({
      repository: x.repository,
      name: x.name,
      description: about[x.repository],
      readme: cut(await readme(x.repository), MAX.readme),
    })),
  ),
  activity: m,
});
// One model call, returning its text. The API through the SDK, or a Claude subscription through the Claude Code
const askClaudeCode = (system, input, token) => {
  const claudeModel = MODEL.replace(/^anthropic\//, "").replace(/\.5\.5$/, "-5-5");
  const run = spawnSync(
    "claude",
    [
      "-p",
      "--model",
      claudeModel,
      "--system-prompt",
      `${system}\n\nReply with the text and nothing else.`,
      "--tools",
      "",
      "--output-format",
      "json",
      "--no-session-persistence",
      "--strict-mcp-config",
      "--disable-slash-commands",
    ],
    {
      input: JSON.stringify(input),
      encoding: "utf8",
      timeout: 300000,
      maxBuffer: 1 << 24,
      cwd: tmpdir(),
      env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token },
    },
  );
  if (run.status !== 0) {
    throw new Error(run.stderr?.trim().slice(0, 300) || run.error?.message || `exit ${run.status}`);
  }
  const res = JSON.parse(run.stdout);
  if (res.is_error) throw new Error(String(res.result).slice(0, 200));
  const text = String(res.result ?? "").trim();
  if (!text) throw new Error("empty answer");
  return text;
};

const askOpenRouter = async (system, input, apiKey) => {
  const orModel = MODEL.includes("/") ? MODEL : `anthropic/${MODEL.replace(/-5-5$/, ".5.5")}`;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://amontlabs.com",
      "X-Title": "Amont Labs Activity",
    },
    body: JSON.stringify({
      model: orModel,
      messages: [
        { role: "system", content: `${system}\n\nReply with JSON only: {"text": "..."}` },
        { role: "user", content: JSON.stringify(input) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "response",
          strict: true,
          schema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false,
          },
        },
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("empty answer from OpenRouter");
  let text;
  try {
    text = JSON.parse(content).text?.trim() ?? content;
  } catch {
    text = content.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    if (text.startsWith("{")) {
      try {
        const parsed = JSON.parse(text);
        if (parsed.text) text = parsed.text.trim();
      } catch {}
    }
  }
  if (!text) throw new Error("empty answer");
  return text;
};

let client;
const askAnthropicApi = async (system, input, apiKey) => {
  const anthropicModel = MODEL.replace(/^anthropic\//, "").replace(/\.5\.5$/, "-5-5");
  client ??= new (await import("@anthropic-ai/sdk")).default({ apiKey });
  const res = await client.beta.messages.create({
    model: anthropicModel,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: {
        type: "json_schema",
        schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
      },
    },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: JSON.stringify(input) }],
  });
  if (res.stop_reason !== "end_turn") throw new Error(`stopped: ${res.stop_reason}`);
  const text = JSON.parse(res.content.find((b) => b.type === "text").text).text.trim();
  if (!text) throw new Error("empty answer");
  return text;
};

const ask = async (system, input) => {
  const activeProviders = getProviders();
  if (!activeProviders.length) throw new Error("no model credentials available");
  let lastError;
  for (const p of activeProviders) {
    try {
      if (p.kind === "claude-code") {
        return askClaudeCode(system, input, p.token);
      }
      if (p.kind === "openrouter") {
        return await askOpenRouter(system, input, p.key);
      }
      if (p.kind === "api") {
        return await askAnthropicApi(system, input, p.key);
      }
    } catch (e) {
      console.warn(`[${p.id}] failed: ${e.message}; trying next provider in chain...`);
      lastError = e;
    }
  }
  throw lastError ?? new Error("all providers failed");
};
// A text within `max` characters: one that runs over is sent back to be shortened (twice at most), not thrown away.
const askWithin = async (system, input, max) => {
  let text = await ask(system, input);
  for (let k = 0; k < 2 && text.length > max; k++)
    text = await ask(
      `${system}\n\nYour last answer to this same request was ${text.length} characters, over the limit of ${max}:\n\n${text}\n\nWrite it again within the limit, keeping what matters most.`,
      input,
    );
  if (text.length > max) throw new Error(`still ${text.length} characters after two rewrites`);
  return text;
};
if (DRY) {
  const out = [];
  for (const [d, m] of pending) out.push({ hash: hash(m), request: await request(d, m) });
  writeFileSync(DRY, JSON.stringify(out, null, 1));
  for (const o of out)
    console.log(o.request.day, `~${Math.round((SYSTEM.length + JSON.stringify(o.request).length) / 4)} input tokens`);
} else
  for (const [d, m] of pending) {
    try {
      if (!VIA) throw new Error("no model credentials");
      summaries[d] = { hash: hash(m), text: await askWithin(SYSTEM, await request(d, m), LIMIT) };
      console.log(`${d} summarised`);
    } catch (e) {
      if (VIA) console.error(`${d} not summarised:`, e.message);
      // a day that changed keeps its last summary until the next one can be written
      if (cache[d]) summaries[d] = cache[d];
    }
  }
for (const e of journal) if (summaries[e.day]) e.text = summaries[e.day].text;
if (!DRY && JSON.stringify(summaries) !== JSON.stringify(cache))
  writeFileSync(SUMMARIES, `${JSON.stringify(summaries, null, 1)}\n`);

// ---- what each project is: a short explanation from its README, rewritten only when the README changes
const EXPLAIN = `You write for amontlabs.com, the site of Amont Labs, a small lab building what AI agents need to do real work. You receive one of its projects as JSON: its name, its one-line GitHub description and its README.

Explain the project to a visitor who has never heard of it and will give it five seconds. Reply with JSON only, in this shape: {"lead": "…", "points": ["…", "…", "…"]}

- "lead": one sentence, at most 110 characters, starting with the project's name: what it is and who it is for. This is the line people read; the points are for those who keep reading.
- "points": exactly three, each at most 70 characters, each one concrete thing it does or lets you do, starting with a verb, with no full stop at the end. Pick the three that best tell this project apart; do not restate the lead.
- Everyday words. If a term would need explaining, say the plain thing instead. No slogans and no adjectives that judge it ("powerful", "seamless", "simple").
- Use only what the README and description say. Never add a feature, a platform, a number or a promise that is not in them: the text is published without review.
- Do not mention installation, versions, licences, platforms or that it is open source; those are shown next to your text.
- Present tense.`;
// Never on a normal sync: the site's projects carry a hand-written pitch (src/data/items.ts). `--explain` writes
// one for a repository that has none yet, as a first draft to settle by hand.
const EXPLAIN_NOW = process.argv.includes("--explain");
const explCache = read(EXPLAINERS);
const explainers = {};
for (const name of Object.keys(repos)) {
  try {
    if (failed.has(name)) throw new Error("repository not read");
    const src = { name: NAMES[name] ?? name, description: about[name], readme: cut(await readme(name), MAX.readme) };
    const h = hash({ format: 2, ...src });
    if (explCache[name]?.hash === h) explainers[name] = explCache[name];
    else if (VIA && !DRY && EXPLAIN_NOW && !explCache[name]) {
      const out = JSON.parse((await ask(EXPLAIN, src)).replace(/^```(?:json)?\s*|\s*```$/g, ""));
      const points = Array.isArray(out.points) ? out.points.map((x) => String(x).trim().replace(/\.$/, "")) : [];
      if (typeof out.lead !== "string" || out.lead.length > 150 || points.length !== 3 || points.some((x) => !x || x.length > 95))
        throw new Error("unusable explanation");
      explainers[name] = { hash: h, lead: out.lead.trim(), points };
      console.log(`${name} explained`);
    } else throw new Error("not written");
  } catch (e) {
    if (VIA && !DRY && EXPLAIN_NOW && e.message !== "repository not read") console.error(`${name} not explained:`, e.message);
    if (explCache[name]) explainers[name] = explCache[name];
  }
  if (explainers[name]?.lead) repos[name].explain = { lead: explainers[name].lead, points: explainers[name].points };
}
if (!DRY && JSON.stringify(explainers) !== JSON.stringify(explCache))
  writeFileSync(EXPLAINERS, `${JSON.stringify(explainers, null, 1)}\n`);

const next = {
  days,
  repos,
  totals: { commits: commitsAll, merged: mergedAll, outside: outsideAll, issues: issuesAll, releases: releasesAll, people: people.size },
  journal,
};
const strip = ({ updatedAt, ...rest }) => rest;
if (DRY) console.log("dry run: nothing written", next.totals);
else if (JSON.stringify(strip(prev)) === JSON.stringify(next)) console.log("activity unchanged");
else {
  writeFileSync(FILE, `${JSON.stringify({ ...next, updatedAt: now.toISOString() })}\n`);
  console.log("activity updated", next.totals, `${journal.length} days in the journal`);
}
