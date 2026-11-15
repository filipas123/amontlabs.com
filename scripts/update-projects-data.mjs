#!/usr/bin/env node
// Refresh src/data/projects.json from the GitHub API (Node 22+, no dependencies; GITHUB_TOKEN optional).
// For each repo: latest app release (tags vX.Y.Z, not drafts or prereleases; Silo also publishes engine-/guest- tags),
// its date, stars and forks. Writes the file only when something other than updatedAt changed. Always exits 0.
import { readFileSync, writeFileSync } from "node:fs";

const REPOS = ["silo", "atelier", "sic", "fjord", "lcu", "lastdrop"];
const FILE = new URL("../src/data/projects.json", import.meta.url);
const headers = { Accept: "application/vnd.github+json", "User-Agent": "amontlabs.com" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const get = async (path) => {
  const r = await fetch(`https://api.github.com/repos/amontlabs/${path}`, { headers });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
};

let prev = {};
try {
  prev = JSON.parse(readFileSync(FILE, "utf8"));
} catch {}

const next = {};
for (const name of REPOS) {
  try {
    const [repo, releases] = await Promise.all([get(name), get(`${name}/releases?per_page=100`)]);
    const latest = releases
      .filter((r) => !r.draft && !r.prerelease && /^v\d/.test(r.tag_name))
      .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))[0];
    next[name] = {
      version: latest?.tag_name ?? null,
      releasedAt: latest ? new Date(latest.published_at).toISOString().replace(/\.\d+Z$/, "Z") : null,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
    };
  } catch (e) {
    // keep the last known values for a repo the API could not reach
    console.error(`${name} not updated:`, e.message);
    if (prev[name]) next[name] = prev[name];
  }
}

const strip = ({ updatedAt, ...rest }) => rest;
if (JSON.stringify(strip(prev)) === JSON.stringify(next)) console.log("project data unchanged");
else {
  writeFileSync(FILE, `${JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  console.log("project data updated", next);
}
