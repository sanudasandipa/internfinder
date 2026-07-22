// Pulls current internship listings from free, no-auth-required sources and
// writes/merges them into listings.json. Run daily by
// .github/workflows/refresh-listings.yml — no server, no n8n instance needed.
//
// Sources:
//  - ITPro.lk RSS feed for internship jobs (Sri Lanka, Colombo + remote)
//  - RemoteOK public API (global remote jobs, filtered to "intern")
//  - Arbeitnow public API (global remote jobs, filtered to "intern")

import Parser from "rss-parser";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "..", "listings.json");
const MAX_LISTINGS = 150;

const ROLE_KEYWORDS = /(data|software|engineer|developer|full[\s-]?stack|backend|front[\s-]?end|\bml\b|machine learning|\bai\b)/i;
const INTERN_KEYWORDS = /intern(ship)?/i;

function categorize(title) {
  const t = (title || "").toLowerCase();
  if (/analyst/.test(t)) return "da";
  if (/scien|machine learning|\bml\b|\bai\b/.test(t)) return "ds";
  if (/data/.test(t)) return "de";
  return "se";
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ---------- Source 1: ITPro.lk RSS (Sri Lanka jobs, no API key needed) ----------
async function fromItProLk() {
  const parser = new Parser({ timeout: 15000 });
  const feed = await parser.parseURL("https://itpro.lk/rss/all/internship");
  const out = [];

  for (const item of feed.items || []) {
    const title = item.title || "";
    if (!ROLE_KEYWORDS.test(title)) continue;

    // ITPro.lk titles are typically "Role at Company" or "Role at Company - Location"
    let role = title, company = "See listing", loc = "colombo";
    const match = title.match(/^(.*?)\s+at\s+(.*?)(?:\s*[-–]\s*(.*))?$/i);
    if (match) {
      role = match[1].trim();
      company = match[2].trim();
      if (match[3] && /remote/i.test(match[3])) loc = "remote";
    }
    const snippet = item.contentSnippet || item.content || "";
    if (/remote/i.test(snippet) || /remote/i.test(title)) loc = "remote";

    out.push({
      role: role.slice(0, 80),
      company: company.slice(0, 60),
      cat: categorize(role),
      loc,
      date: item.isoDate ? item.isoDate.slice(0, 10) : todayISO(),
      source: "ITPro.lk",
      url: item.link,
    });
  }
  return out;
}

// ---------- Source 2: RemoteOK public API ----------
async function fromRemoteOK() {
  const res = await fetch("https://remoteok.com/api", {
    headers: { "User-Agent": "internship-board-bot/1.0" },
  });
  if (!res.ok) throw new Error("RemoteOK HTTP " + res.status);
  const data = await res.json();
  const out = [];

  for (const job of data) {
    if (!job || !job.position) continue; // first element is a legal notice, not a job
    const tags = job.tags || [];
    const isIntern = INTERN_KEYWORDS.test(job.position) || tags.some((t) => INTERN_KEYWORDS.test(t));
    if (!isIntern || !ROLE_KEYWORDS.test(job.position)) continue;

    out.push({
      role: job.position.slice(0, 80),
      company: (job.company || "Unknown").slice(0, 60),
      cat: categorize(job.position),
      loc: "remote",
      date: job.date ? job.date.slice(0, 10) : todayISO(),
      source: "RemoteOK",
      url: job.url || (job.id ? "https://remoteok.com/remote-jobs/" + job.id : "https://remoteok.com"),
    });
  }
  return out;
}

// ---------- Source 3: Arbeitnow public API ----------
async function fromArbeitnow() {
  const res = await fetch("https://www.arbeitnow.com/api/job-board-api");
  if (!res.ok) throw new Error("Arbeitnow HTTP " + res.status);
  const { data } = await res.json();
  const out = [];

  for (const job of data || []) {
    if (!job.title || !job.remote) continue;
    const tags = job.tags || [];
    const isIntern = INTERN_KEYWORDS.test(job.title) || tags.some((t) => INTERN_KEYWORDS.test(t));
    if (!isIntern || !ROLE_KEYWORDS.test(job.title)) continue;

    out.push({
      role: job.title.slice(0, 80),
      company: (job.company_name || "Unknown").slice(0, 60),
      cat: categorize(job.title),
      loc: "remote",
      date: job.created_at ? new Date(job.created_at * 1000).toISOString().slice(0, 10) : todayISO(),
      source: "Arbeitnow",
      url: job.url,
    });
  }
  return out;
}

function dedupeKey(j) {
  return (j.company + "|" + j.role).toLowerCase();
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const j of list) {
    const k = dedupeKey(j);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(j);
  }
  return out;
}

async function main() {
  let existing = [];
  try {
    existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
  } catch (_) {
    existing = [];
  }

  const results = await Promise.allSettled([fromItProLk(), fromRemoteOK(), fromArbeitnow()]);
  const labels = ["ITPro.lk", "RemoteOK", "Arbeitnow"];
  let fresh = [];

  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      fresh = fresh.concat(r.value);
    } else {
      console.error(`${labels[i]} failed: ${r.reason}`);
    }
  });

  fresh = dedupe(fresh);
  const merged = dedupe([...fresh, ...existing]); // freshly-seen items win on conflicts
  merged.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const capped = merged.slice(0, MAX_LISTINGS);

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(capped, null, 2) + "\n");
  console.log(`Wrote ${capped.length} listings (${fresh.length} freshly fetched this run).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
