# Internship Board — automated, zero-cost

Replaces the old "Refresh feed" button (which called the Anthropic API directly
from the browser and only worked inside a Claude.ai artifact) with a proper
background job: a GitHub Action runs daily, pulls fresh internship listings
from three free, no-key-required sources, and commits an updated
`listings.json`. The page just reads that file — no server, no n8n instance,
no HF Docker Space needed.

## Sources used

- **ITPro.lk** — RSS feed `https://itpro.lk/rss/all/internship` (Sri Lanka jobs)
- **RemoteOK** — public JSON API, filtered to roles containing "intern"
- **Arbeitnow** — public JSON API, filtered to remote + "intern"

All three are free and don't need an API key. Coverage will be strongest for
ITPro.lk (dedicated Sri Lanka board); RemoteOK/Arbeitnow mostly surface
remote internships, so don't expect a flood of Colombo-only roles from them.

## 1. Push this folder to a new GitHub repo

```bash
cd internship-automation
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<you>/internship-board.git
git push -u origin main
```

The workflow needs `permissions: contents: write` (already set in the yml) to
commit `listings.json` back — no extra secrets needed since it only reads
public APIs.

## 2. Let it run

- It fires automatically every day at 03:00 UTC (edit the cron line in
  `.github/workflows/refresh-listings.yml` if you want a different time).
- Or trigger it immediately: repo → **Actions** tab → "Refresh internship
  listings" → **Run workflow**.
- Check the Action logs if a source ever returns 0 results — sites change
  their RSS/API shape occasionally, and the script logs which source failed
  without crashing the whole run.

## 3. Host the static page (pick one, both free)

**GitHub Pages** (simplest, same repo):
Repo → Settings → Pages → Source: `main` branch, `/ (root)`. Your site is
live at `https://<you>.github.io/internship-board/`.

**Hugging Face Static Space** (what you originally asked about):
Create a Space → SDK: **Static** (this tier is still free) → push `index.html`
and `listings.json` to the Space repo the same way you'd push to GitHub.
Docker/Gradio Spaces now require a paid plan, which is why n8n itself can't
live there — but a static HTML page reading a JSON file needs no compute at
all, so the Static tier is a perfect fit.

## 4. Local testing

```bash
npm install
npm run fetch   # writes/updates listings.json
```

Note: I couldn't live-test the fetch script from this sandbox (its network
egress is locked to package registries only, not itpro.lk/remoteok.com), but
GitHub Actions runners have normal internet access, so it'll run there.
The script logs a clear error per source if one fails, rather than crashing.

## If a source's HTML/RSS shape changes

- ITPro.lk: adjust the `match()` regex in `fromItProLk()` in
  `scripts/fetch-listings.mjs` — it currently expects titles like
  `"Role at Company"` or `"Role at Company - Location"`.
- RemoteOK / Arbeitnow: these are documented JSON APIs, less likely to break,
  but field names could shift — check `job.position`/`job.title` etc. if a
  source suddenly returns 0.
