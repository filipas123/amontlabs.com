// The projects, in order of importance: wording, links and films. One source for every page that lists them.
import data from "./projects.json";

export type Film = { id: string; ratio: string; dur: number; audio: boolean; full: string };
// the ladder, earliest first
export const STAGES = ["Prototype", "WIP", "Alpha", "Released"] as const;
export type Stage = (typeof STAGES)[number];
// repositories that are not among the site's projects but show in the activity
export const others: Record<string, { stage: Stage; kind: "app" | "cli" | "web"; platforms: ("macos" | "linux" | "windows")[]; line?: string; pitch?: Pitch }> = {
  hartlib: {
    stage: "Prototype",
    kind: "web",
    platforms: [],
    // the first clause of its GitHub description, short enough for one row
    line: "One research chat across everything you subscribe to.",
    pitch: {
      lead: "Hartlib is one research chat over everything you subscribe to, for people who read professional briefings.",
      points: [
        "Answers plain-language questions with each claim linked to its page",
        "Explains every answer with visuals shaped to how you understand best",
        "Reads dense briefings, letters and official records for you",
      ],
    },
  },

};
// What a project is, for someone who has never heard of it: one sentence, then what it does. Hand-written and
// settled with the lab: the activity sync never rewrites it.
export type Pitch = { lead: string; points: string[] };
export type Item = {
  id: string;
  name: string;
  line: string;
  sub?: string;
  links: { kind: "site" | "github"; label: string; href: string }[];
  tags: string[]; // categories, from one shared vocabulary: Agents, Security, Dev tools, Computer use, Public goods
  needs: string[]; // integrations it needs (filled tags): T3 Code, Claude Code
  kind: "app" | "cli" | "web";
  platforms: ("macos" | "linux" | "windows")[];
  film?: Film;
  tier: "product" | "tool";
  stage: Stage; // how far along it is, one ladder for every project
  pitch: Pitch;
};

export const items: Item[] = [
  {
    id: "silo",
    name: "Silo",
    line: "Computers for your agents.",
    sub: "Run Linux sandboxes locally or remotely, with a desktop and computer use.",
    links: [
      { kind: "site", label: "silo.amontlabs.com", href: "https://silo.amontlabs.com" },
      { kind: "github", label: "GitHub", href: "https://github.com/amontlabs/silo" },
    ],
    tags: ["Agents", "Security", "Computer use"],
    needs: [],
    kind: "app",
    platforms: ["macos"],
    film: { id: "silo", ratio: "16 / 9", dur: 33, audio: true, full: "/media/silo-full.mp4" },
    tier: "product",
    stage: "WIP",
    pitch: {
      lead: "Silo gives your AI agents their own isolated computers that you can branch, diff and fold back like a Git repo.",
      points: [
        "Run each agent in its own machine with a terminal, desktop and computer use, away from your host",
        "Fork a machine at any checkpoint to explore in parallel, let an agent run wild or share with a teammate",
        "Review the state diff of any fork and fold the changes you want back into your main machine",
      ],
    },
  },
  {
    id: "fjord",
    name: "Fjord",
    line: "Connects your agents to everything they work with.",
    sub: "Fjord connects your agents to everything they work with. Questions come to you; the rest stays out of your way.",
    tags: ["Agents", "Dev tools"],
    links: [{ kind: "github", label: "GitHub", href: "https://github.com/amontlabs/fjord" }],
    needs: ["T3 Code"],
    kind: "app",
    platforms: ["macos"],
    tier: "product",
    stage: "WIP",
    pitch: {
      lead: "Fjord sits between your T3 Code agents and GitHub, and brings you only what you need to know or decide.",
      points: [
        "Type once: the Router delivers your message to the right thread, and brings back every question and plan that needs you",
        "Sort your GitHub inbox and CI by rules you write as sentences",
        "Hand a failing check to the thread that can fix it",
      ],
    },
  },
  {
    id: "atelier",
    name: "atelier",
    line: "A CLI for coding agents to orchestrate parallel work.",
    sub: "One worktree per task, an async merge gate, and CI on your own machines.",
    links: [{ kind: "github", label: "GitHub", href: "https://github.com/amontlabs/atelier" }],
    tags: ["Agents", "Dev tools"],
    needs: [],
    kind: "cli",
    platforms: ["macos", "linux"],
    tier: "tool",
    stage: "Alpha",
    pitch: {
      lead: "atelier lets several coding agents build one repository in parallel and merges only what passed.",
      points: [
        "Gives each task its own git worktree; a task can build on one that is not merged yet",
        "Merges approved branches as one batch once the full check passes on your own Mac and Linux machines",
        "Writes the same rules and task prompts for every agent",
      ],
    },
  },

  {
    id: "sic",
    name: "Sic",
    line: "Political debates, fact-checked live.",
    sub: "Transcribes the debate, identifies who speaks, and checks factual claims against official sources, live or on replay. Built for the 2027 French presidential election.",
    tags: ["Public goods"],
    links: [
      { kind: "site", label: "sic.observer", href: "https://sic.observer" },
      { kind: "github", label: "GitHub", href: "https://github.com/amontlabs/sic" },
    ],
    needs: [],
    kind: "web",
    platforms: [],
    film: { id: "sic", ratio: "4 / 3", dur: 24, audio: true, full: "/media/sic-full.mp4" },
    tier: "product",
    stage: "Prototype",
    pitch: {
      lead: "Sic checks the facts in French political debates against official sources, live or on replay.",
      points: [
        "Watches the debate, identifies each speaker and what they claim",
        "Picks out checkable claims and skips opinions and promises",
        "Gives no verdict without a cited source and a precise link",
      ],
    },
  },  {
    id: "lcu",
    name: "LCU",
    line: "Codex computer use, outside Codex.",
    sub: "LCU brings the computer-use runtime of the Codex app to your own harness, without Codex authentication: desktop apps, and Chrome when enabled.",
    links: [
      { kind: "site", label: "lcu.amontlabs.com", href: "https://lcu.amontlabs.com" },
      { kind: "github", label: "GitHub", href: "https://github.com/amontlabs/lcu" },
    ],
    tags: ["Agents", "Computer use"],
    needs: [],
    kind: "cli",
    platforms: ["macos", "linux", "windows"],
    film: { id: "lcu", ratio: "16 / 9", dur: 30, audio: true, full: "/media/lcu-full.mp4" },
    tier: "tool",
    stage: "Released",
    pitch: {
      lead: "LCU gives any AI agent the computer use built into Codex, without the Codex app or its sign-in.",
      points: [
        "Read windows, click, type and take screenshots in desktop apps",
        "Approve or deny each app the first time an agent tries to use it",
        "Read and control Chrome tabs through the official extension",
      ],
    },
  },
  {
    id: "lastdrop",
    name: "lastdrop",
    line: "Any model as a subagent in Claude Code.",
    sub: "Use any model as a built-in subagent in Claude Code, with a subscription or API key, and spread usage across your accounts.",
    links: [
      { kind: "site", label: "lastdrop.amontlabs.com", href: "https://lastdrop.amontlabs.com" },
      { kind: "github", label: "GitHub", href: "https://github.com/amontlabs/lastdrop" },
    ],
    tags: ["Agents", "Dev tools"],
    needs: ["Claude Code", "T3 Code"],
    kind: "app",
    platforms: ["macos"],
    film: { id: "lastdrop", ratio: "16 / 9", dur: 37, audio: true, full: "/media/lastdrop-full.mp4" },
    tier: "tool",
    stage: "Released",
    pitch: {
      lead: "lastdrop turns any AI subscription into a native subagent for Claude Code and T3 Code.",
      points: [
        "Any subscription or API key becomes an agent Claude calls like its own, with its model, effort and fallbacks",
        "Balances the work across your accounts, on the one with the most usage left",
        "Adds auto mode where it is missing (Z.ai, Antigravity, OpenRouter): a judge checks every command",
      ],
    },
  },
];

export const num = (i: number) => String(i + 1).padStart(2, "0");
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

// release, stars and forks, synced hourly from GitHub (scripts/update-projects-data.mjs)
export type Stats = { version: string | null; releasedAt: string | null; stars: number; forks: number };
export const stats = (id: string) => (data as unknown as Record<string, Stats>)[id];
const year = new Date().getFullYear();
export const day = (iso: string) => {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== year && { year: "numeric" }),
    timeZone: "Europe/Paris",
  }).format(d);
};
export const count = (n: number) =>
  n >= 1000 ? `${(Math.round(n / 100) / 10).toFixed(1).replace(/\.0$/, "")}k` : String(n);
export const KIND = { app: "App", cli: "CLI", web: "Website" } as const;
export const OS = { macos: "macOS", linux: "Linux", windows: "Windows" } as const;
export const runsOn = (it: Item) =>
  [KIND[it.kind], it.platforms.map((p) => OS[p]).join(", ")].filter(Boolean).join(" for ");
