# Site Migration Route & Content Comparator

Compares an old website against its new replacement (e.g. a React → Next.js migration) and reports exactly what is missing or different, so nothing breaks in production.

It works in two stages:

| Script | What it does | Output |
|---|---|---|
| `route-compare.mjs` | Discovers every path on the old site (sitemap.xml + BFS link crawl), then checks each path on both sites: HTTP status and `<title>` | `route-report.json` |
| `content-compare.mjs` | Deep-compares every discovered path: text similarity %, title/H1/meta-description diff, suggested action for each missing page, and builds a visual dashboard | `content-report.json`, `compare-report.html` |

## Requirements

- Node.js 18 or newer (uses built-in `fetch` and top-level `await`)
- ~400 MB free disk space for the Chromium browser

## Setup

```bash
npm install
npx playwright install chromium
```

## Configure

Open both scripts and edit the CONFIG block at the top:

```js
const OLD = 'https://old-site.com';   // the site being replaced
const NEW = 'https://new-site.com';   // the new site
const MAX_PAGES = 500;                // crawl safety limit
const CONCURRENCY = 5;                // parallel browser tabs
```

## Run

```bash
# Stage 1: discover routes and compare status codes (run this first)
node route-compare.mjs

# Stage 2: deep content comparison + dashboard (needs stage 1's output)
node content-compare.mjs
```

Then open **`compare-report.html`** in any browser (double-click works — it is a single fully self-contained file, easy to share).

## Reading the dashboard

Pages are sorted by priority — most broken first:

- 🔴 **Missing (404)** — the page does not exist on the new site. Each card shows a suggested action (migrate the page, or add a 301 redirect) plus a link to the old page as a reference.
- 🟠 **Content differs** — the page exists but less than 70% of its text matches the old one. Check the Title/H1/word-count diff and open both live pages from the card's links.
- 🟢 **OK** — content matches; usually only the `<title>`/metadata needs fixing (the exact old title is shown on the card).

Use the filter buttons and the path search box to work through the list.

## Output files

| File | Contents |
|---|---|
| `route-report.json` | Per-path status codes and title match (stage 1) |
| `content-report.json` | Per-path similarity %, title/H1/meta diff, suggested action (stage 2) |
| `compare-report.html` | The visual dashboard — a single self-contained file |
| `missing-pages.txt` | Plain list of paths returning 404 on the new site |

## Notes & caveats

- If the crawl hits `MAX_PAGES`, the report is incomplete — the script warns loudly; raise the limit and rerun.
- Single-page apps can return HTTP 200 for pages that don't really exist (soft 404s). Don't trust status codes alone — that's what the similarity % is for.
- Only public pages are covered; anything behind a login is not crawled.
- To share the results, just send `compare-report.html` — everything is embedded in that one file.
