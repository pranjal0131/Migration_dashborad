// route-compare.mjs
// Crawls the old React site to discover all paths,
// then checks each path on the new Next.js site and compares them.
//
// Speed: parallel tabs + images/fonts blocked + bounded networkidle
// Coverage-safety (nothing gets missed):
//   - paths are also seeded from sitemap.xml (catches pages not linked anywhere)
//   - bounded networkidle + bottom-scroll on every page (so SPA/lazy links render)
//   - failed navigations are retried RETRIES times (with increasing timeouts)
//   - loud warning if the MAX_PAGES limit is hit (no silent skipping)
//   - paths that failed during crawl stay in the compare list (shown as ERR in report)
//
// Setup:
//   npm i -D playwright
//   npx playwright install chromium
// Run:
//   node route-compare.mjs

import { chromium } from 'playwright';
import fs from 'fs';

// ---------- CONFIG (adjust as needed) ----------
const OLD = 'https://vetlyf.com';       // old React site
const NEW = 'https://app.vetlyf.com';   // new Next.js site
const MAX_PAGES = 500;                  // safety limit (prevents infinite crawl)
const CONCURRENCY = 5;                  // number of parallel tabs
const NAV_TIMEOUT = 20000;              // per-attempt navigation timeout
const IDLE_CAP = 4000;                  // max wait for networkidle (no 30s hangs)
const RETRIES = 2;                      // extra attempts on navigation failure
// -----------------------------------------------

const oldOrigin = new URL(OLD).origin;
const clean = (p) => (p.split('#')[0].split('?')[0].replace(/\/+$/, '') || '/');

const browser = await chromium.launch();

// Block images/fonts/media — we only need HTML (links, status codes, titles)
const crawlCtx = await browser.newContext();
await crawlCtx.route('**/*', (route) => {
  const t = route.request().resourceType();
  return ['image', 'font', 'media'].includes(t) ? route.abort() : route.continue();
});

// try networkidle, but cap at IDLE_CAP — won't hang on sites with analytics/polling
const settle = (page) => page.waitForLoadState('networkidle', { timeout: IDLE_CAP }).catch(() => {});

// navigation with retries — timeout grows a bit on each attempt
async function gotoSafe(page, url) {
  for (let i = 0; i <= RETRIES; i++) {
    const res = await page
      .goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT + i * 10000 })
      .catch(() => null);
    if (res) return res;
  }
  return null;
}

// 0) Seed from sitemap — catches pages that no link points to
async function fetchLocs(url) {
  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) return [];
    const xml = await r.text();
    return [...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/g)].map((m) => m[1]);
  } catch {
    return [];
  }
}

const discovered = new Set();
const queue = [];
let overflow = 0;

function enqueue(p) {
  if (discovered.has(p)) return;
  if (discovered.size >= MAX_PAGES) {
    overflow++;
    return;
  }
  discovered.add(p);
  queue.push(p);
}

enqueue('/');

console.log('Checking sitemap.xml...');
const locs = await fetchLocs(oldOrigin + '/sitemap.xml');
// if it's a sitemap-index, read nested sitemaps too (one level deep)
const nested = (
  await Promise.all(locs.filter((l) => l.endsWith('.xml')).map(fetchLocs))
).flat();
for (const loc of [...locs, ...nested]) {
  try {
    const u = new URL(loc);
    if (u.origin === oldOrigin && !u.pathname.endsWith('.xml')) enqueue(clean(u.pathname));
  } catch {}
}
console.log(`Found ${discovered.size - 1} paths in sitemap.`);

// 1) Crawl the OLD site (BFS, parallel workers)
console.log(`Crawling old site (${CONCURRENCY} parallel tabs)...`);
const crawlFailed = [];
let active = 0;

async function crawlWorker() {
  const page = await crawlCtx.newPage();
  while (true) {
    const path = queue.shift();
    if (path === undefined) {
      // queue is empty — but other workers may still discover new links
      if (active === 0) break;
      await new Promise((r) => setTimeout(r, 150));
      continue;
    }
    active++;
    try {
      const res = await gotoSafe(page, OLD + path);
      if (!res) {
        crawlFailed.push(path);
        continue;
      }
      await settle(page);
      // scroll to the bottom once so lazily-rendered links appear
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(250);

      const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.href)).catch(() => []);
      for (const abs of hrefs) {
        try {
          const u = new URL(abs);
          if (u.origin !== oldOrigin) continue; // same-site links only
          enqueue(clean(u.pathname));
        } catch {}
      }
    } finally {
      active--;
    }
  }
  await page.close();
}

await Promise.all(Array.from({ length: CONCURRENCY }, crawlWorker));
await crawlCtx.close();

console.log(`Found ${discovered.size} paths.`);
if (overflow > 0) {
  console.log(
    `\n🚨 MAX_PAGES (${MAX_PAGES}) limit hit! At least ${overflow} new links were skipped.` +
      `\n   This check is INCOMPLETE — raise MAX_PAGES and run again!\n`
  );
}
if (crawlFailed.length) {
  console.log(
    `⚠️  ${crawlFailed.length} paths did not load even after ${RETRIES + 1} attempts ` +
      `(they will be retried in the compare phase and may show as ERR in the report).`
  );
}

// 2) Compare every path on OLD vs NEW (parallel)
const cmpCtx = await browser.newContext();
await cmpCtx.route('**/*', (route) => {
  const t = route.request().resourceType();
  return ['image', 'font', 'media'].includes(t) ? route.abort() : route.continue();
});
const paths = [...discovered].sort();
const results = new Array(paths.length);
let idx = 0;

async function cmpWorker() {
  const page = await cmpCtx.newPage();
  while (true) {
    const i = idx++;
    if (i >= paths.length) break;
    const path = paths[i];

    const o = await gotoSafe(page, OLD + path);
    if (o) await settle(page);
    const oldStatus = o ? o.status() : 'ERR';
    const oldTitle = o ? await page.title().catch(() => '') : '';

    const n = await gotoSafe(page, NEW + path);
    if (n) await settle(page);
    const newStatus = n ? n.status() : 'ERR';
    const newTitle = n ? await page.title().catch(() => '') : '';

    results[i] = {
      path,
      oldStatus,
      newStatus,
      ok: oldStatus === newStatus && newStatus === 200,
      titleMatch: oldTitle.trim() === newTitle.trim(),
    };
    console.log(`[${i + 1}/${paths.length}] ${path}  old:${oldStatus}  new:${newStatus}`);
  }
  await page.close();
}

console.log(`\nComparing ${paths.length} paths (${CONCURRENCY} parallel tabs)...`);
await Promise.all(Array.from({ length: CONCURRENCY }, cmpWorker));

// 3) Report
fs.writeFileSync('route-report.json', JSON.stringify(results, null, 2));
console.table(results);

const broken = results.filter((r) => !r.ok);
console.log(`\nTotal paths: ${results.length} | Problem paths: ${broken.length}`);
if (broken.length) {
  console.log('\n⚠️  Check these paths (missing/broken on the new site, or status mismatch):');
  broken.forEach((r) => console.log(`   ${r.path}   (old:${r.oldStatus}  new:${r.newStatus})`));
}
const titleMismatch = results.filter((r) => r.ok && !r.titleMatch);
if (titleMismatch.length) {
  console.log('\nℹ️  Status is 200 but <title> differs (verify the content):');
  titleMismatch.forEach((r) => console.log(`   ${r.path}`));
}
if (overflow > 0) {
  console.log(`\n🚨 REMINDER: the MAX_PAGES limit was hit — this report is INCOMPLETE!`);
}

await browser.close();
