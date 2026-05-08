# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**GastroTracker** — a single-page app that parses WhatsApp chat exports, extracts every 💩 emoji, and visualises per-member statistics. No framework, no build step.

## Architecture

```
index.html      ← entire frontend (HTML + CSS + vanilla JS, single file)
worker.js       ← Cloudflare Worker proxy (deployed separately)
wrangler.toml   ← Cloudflare Worker config
```

### Data flow

1. User uploads a WhatsApp `.txt` export → parsed entirely in the browser.
2. Browser fetches/saves JSON via `cfg.proxyUrl` (Cloudflare Worker URL, stored in `localStorage` under key `gastrotracker_v1`).
3. Worker holds `GIST_TOKEN` + `GIST_ID` as Wrangler secrets and proxies reads/writes to the GitHub Gist API (`gastro-data.json` inside the Gist).

### Gist data schema

```json
{
  "version": 1,
  "members": {
    "Name": [
      { "date": "YYYY-MM-DD", "time": "HH:MM", "count": 1 }
    ]
  },
  "lastUpdated": "<ISO timestamp>"
}
```

Deduplication key per entry: `"${author}|${date}|${time}"` — checked as a Set before merging.

## Key JS sections inside `index.html`

| Section | Purpose |
|---------|---------|
| `WA_PATTERNS` | Three regex patterns covering iOS brackets, Android comma-dash, and no-comma export formats |
| `normaliseDate()` | Parses `MM/DD/YY` (default). Auto-detects when first segment > 12 (must be day). 2-digit years → 2000s. |
| `normaliseTime()` | Strips seconds, converts 12 h AM/PM → 24 h `HH:MM` |
| `countPoop()` | `text.split('💩').length - 1` — counts each emoji individually |
| `mergeEvents()` | Deep-clones existing data, skips known keys, re-sorts by `date+time` |
| `allEvents()` | Flattens `appData.members` into a flat array, expanding `count > 1` entries |
| `mkChart()` | Thin wrapper around `new Chart(...)` that destroys the previous instance first |
| `renderHeatmap()` | Generates raw HTML (no library) — 52-week grid, aligns to Monday, month labels per column |
| `renderAll()` | Entry point called after every data load or save; shows/hides all sections |

## Deploying the Worker

```bash
npm install -g wrangler
wrangler login
wrangler deploy          # from repo root
wrangler secret put GIST_TOKEN
wrangler secret put GIST_ID
```

No build step for `index.html` — push to GitHub and enable Pages from the repo settings (source: `main` / root).

## Date format

WhatsApp exports from this group use **MM/DD/YY**. `normaliseDate()` defaults to that order; the only auto-detection is when the first segment exceeds 12.
