// content-compare.mjs
// Deep-compares every path from route-report.json:
//   - extracts title, H1, meta description, and full visible text from both sites
//   - computes a text similarity % (how much of the content matches)
//   - suggests an action for missing (404) pages (migrate or redirect)
//   - puts everything into a visual dashboard: compare-report.html
//     (filters, priority sort, links to both live sites)
//
// route-compare.mjs must be run first (needs route-report.json).
// Run:
//   node content-compare.mjs
//   then open compare-report.html in a browser

import { chromium } from 'playwright';
import fs from 'fs';

// ---------- CONFIG ----------
const OLD = 'https://vetlyf.com';
const NEW = 'https://app.vetlyf.com';
const CONCURRENCY = 5;
const NAV_TIMEOUT = 20000;
const IDLE_CAP = 4000;
const RETRIES = 2;
// ----------------------------

const routes = JSON.parse(fs.readFileSync('route-report.json', 'utf8'));

// category + suggested action for missing pages
function classify(path) {
  if (/^\/blog\//.test(path)) return { cat: 'blog', action: `301 redirect -> /blogs${path.slice(5)}` };
  if (path === '/blog') return { cat: 'blog', action: '301 redirect -> /blogs' };
  if (/^\/service(s)?[\/-]/.test(path) || path === '/services-near-me')
    return { cat: 'service', action: 'MIGRATE (business page — revenue impact)' };
  if (/policy|terms-of-service/.test(path))
    return { cat: 'legal', action: 'MIGRATE (required for compliance)' };
  if (/near-me|vaccination|grooming|neuter|spaying|lab-test|dental|hydration|urinary|dog-health|vet-home-visit|veterinarian|pet-clinic|pet-hospital|pet-health/.test(path))
    return { cat: 'seo', action: 'MIGRATE (SEO landing page — organic traffic)' };
  if (/^\/(authors|academy|newsletters|podcasts|resources|videos|indian-)/.test(path))
    return { cat: 'content', action: 'Decide: migrate or redirect' };
  return { cat: 'core', action: 'MIGRATE (user flow page)' };
}

// word-set similarity (Jaccard) — 0 to 100%
function similarity(a, b) {
  const words = (s) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  const A = words(a), B = words(b);
  if (!A.size && !B.size) return 100;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return Math.round((inter / (A.size + B.size - inter)) * 100);
}

const browser = await chromium.launch();
const ctx = await browser.newContext();
// we only extract text, so images are not needed
await ctx.route('**/*', (route) => {
  const t = route.request().resourceType();
  return ['image', 'font', 'media'].includes(t) ? route.abort() : route.continue();
});

const settle = (page) => page.waitForLoadState('networkidle', { timeout: IDLE_CAP }).catch(() => {});

async function gotoSafe(page, url) {
  for (let i = 0; i <= RETRIES; i++) {
    const res = await page
      .goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT + i * 10000 })
      .catch(() => null);
    if (res) return res;
  }
  return null;
}

async function extract(page, url) {
  const res = await gotoSafe(page, url);
  if (!res) return null;
  await settle(page);
  return await page
    .evaluate(() => ({
      title: document.title || '',
      h1: document.querySelector('h1')?.innerText?.trim() || '',
      metaDesc: document.querySelector('meta[name="description"]')?.content || '',
      text: document.body?.innerText || '',
    }))
    .catch(() => null);
}

const rows = new Array(routes.length);
let idx = 0;
let done = 0;

async function worker() {
  const page = await ctx.newPage();
  while (true) {
    const i = idx++;
    if (i >= routes.length) break;
    const r = routes[i];
    const row = { ...r };

    if (r.newStatus === 404 || r.newStatus === 'ERR') {
      // the page does not exist — content compare is pointless, suggest an action
      Object.assign(row, { state: 'missing', sim: 0, ...classify(r.path) });
    } else {
      const o = await extract(page, OLD + r.path);
      const n = await extract(page, NEW + r.path);
      if (!o || !n) {
        Object.assign(row, { state: 'error', sim: 0, action: 'Failed to load — check manually' });
      } else {
        const sim = similarity(o.text, n.text);
        Object.assign(row, {
          state: sim >= 70 ? 'ok' : 'differs',
          sim,
          oldTitle: o.title, newTitle: n.title,
          oldH1: o.h1, newH1: n.h1,
          oldDesc: o.metaDesc, newDesc: n.metaDesc,
          oldWords: o.text.split(/\s+/).length,
          newWords: n.text.split(/\s+/).length,
          action:
            sim >= 70
              ? (o.title.trim() === n.title.trim() ? 'OK' : 'Only fix title/metadata')
              : 'Content differs significantly — open both sites and compare',
        });
      }
    }
    rows[i] = row;
    done++;
    if (done % 20 === 0) console.log(`${done}/${routes.length} done...`);
  }
  await page.close();
}

console.log(`Deep-comparing ${routes.length} paths (${CONCURRENCY} parallel)...`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
await browser.close();

fs.writeFileSync('content-report.json', JSON.stringify(rows, null, 2));

// ---------- HTML dashboard ----------
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Vetlyf Migration Compare</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 system-ui, sans-serif; margin: 0; background: #f5f6f8; color: #1b1f24; }
  @media (prefers-color-scheme: dark) { body { background: #14171a; color: #e6e8ea; } .card { background: #1e2328 !important; } .meta td { border-color: #333 !important; } }
  header { position: sticky; top: 0; background: inherit; padding: 12px 20px; border-bottom: 1px solid #8884; z-index: 5; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  .filters button { margin-right: 6px; padding: 4px 12px; border-radius: 14px; border: 1px solid #8886; background: transparent; color: inherit; cursor: pointer; }
  .filters button.on { background: #2563eb; color: #fff; border-color: #2563eb; }
  input[type=search] { padding: 5px 10px; border-radius: 6px; border: 1px solid #8886; background: transparent; color: inherit; width: 260px; }
  main { padding: 16px 20px; max-width: 1400px; margin: 0 auto; }
  .card { background: #fff; border: 1px solid #8883; border-radius: 10px; margin-bottom: 14px; padding: 14px 16px; }
  .row1 { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .path { font-family: ui-monospace, monospace; font-weight: 600; font-size: 15px; }
  .badge { padding: 2px 10px; border-radius: 10px; font-size: 12px; font-weight: 600; color: #fff; }
  .b-missing { background: #dc2626; } .b-differs { background: #d97706; } .b-ok { background: #16a34a; } .b-error { background: #6b7280; }
  .sim { font-weight: 700; }
  .action { margin: 6px 0; font-size: 13px; padding: 6px 10px; border-left: 3px solid #2563eb; background: #2563eb14; border-radius: 0 6px 6px 0; }
  table.meta { border-collapse: collapse; margin: 8px 0; font-size: 13px; width: 100%; }
  .meta td { border: 1px solid #ddd; padding: 4px 8px; vertical-align: top; }
  .meta td:first-child { font-weight: 600; width: 90px; }
  .diff { color: #dc2626; font-weight: 600; }
  .links a { font-size: 12px; margin-right: 10px; }
  #count { opacity: .7; font-size: 13px; margin-left: 10px; }
</style>
</head>
<body>
<header>
  <h1>Vetlyf Migration Compare — old vs new</h1>
  <div class="filters">
    <button data-f="all" class="on">All</button>
    <button data-f="missing">Missing (404)</button>
    <button data-f="differs">Content differs</button>
    <button data-f="ok">OK</button>
    <button data-f="error">Errors</button>
    <input type="search" id="q" placeholder="search path...">
    <span id="count"></span>
  </div>
</header>
<main id="list"></main>
<script>
const DATA = ${JSON.stringify(rows)};
const OLD = ${JSON.stringify(OLD)}, NEW = ${JSON.stringify(NEW)};
const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;');
// priority: missing first, then lowest similarity
const order = { missing: 0, error: 1, differs: 2, ok: 3 };
DATA.sort((a, b) => (order[a.state] - order[b.state]) || (a.sim - b.sim) || a.path.localeCompare(b.path));

function card(r) {
  const badge = { missing: 'Missing on new', differs: 'Content differs', ok: 'OK', error: 'Error' }[r.state];
  let meta = '';
  if (r.state === 'differs' || r.state === 'ok') {
    const t = r.oldTitle?.trim() !== r.newTitle?.trim();
    const h = r.oldH1?.trim() !== r.newH1?.trim();
    meta = '<table class="meta">' +
      '<tr><td>Title</td><td>' + esc(r.oldTitle) + '</td><td class="' + (t?'diff':'') + '">' + esc(r.newTitle) + '</td></tr>' +
      '<tr><td>H1</td><td>' + esc(r.oldH1) + '</td><td class="' + (h?'diff':'') + '">' + esc(r.newH1) + '</td></tr>' +
      '<tr><td>Meta desc</td><td>' + esc(r.oldDesc) + '</td><td>' + esc(r.newDesc) + '</td></tr>' +
      '<tr><td>Words</td><td>' + r.oldWords + '</td><td>' + r.newWords + '</td></tr>' +
      '</table>';
  }
  const sim = r.state === 'missing' ? '' : '<span class="sim">' + r.sim + '% match</span>';
  return '<div class="card" data-state="' + r.state + '" data-path="' + esc(r.path) + '">' +
    '<div class="row1"><span class="badge b-' + r.state + '">' + badge + '</span>' +
    '<span class="path">' + esc(r.path) + '</span>' + sim +
    '<span style="opacity:.6;font-size:12px">old:' + r.oldStatus + ' new:' + r.newStatus + '</span></div>' +
    (r.action ? '<div class="action">' + esc(r.action) + '</div>' : '') +
    meta +
    '<div class="links"><a href="' + OLD + r.path + '" target="_blank">open old site</a>' +
    '<a href="' + NEW + r.path + '" target="_blank">open new site</a></div></div>';
}

const list = document.getElementById('list');
list.innerHTML = DATA.map(card).join('');

let filter = 'all';
function apply() {
  const q = document.getElementById('q').value.toLowerCase();
  let n = 0;
  for (const el of list.children) {
    const show = (filter === 'all' || el.dataset.state === filter) && el.dataset.path.toLowerCase().includes(q);
    el.style.display = show ? '' : 'none';
    if (show) n++;
  }
  document.getElementById('count').textContent = n + ' / ' + DATA.length + ' paths';
}
document.querySelectorAll('.filters button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.filters button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    filter = b.dataset.f;
    apply();
  })
);
document.getElementById('q').addEventListener('input', apply);
apply();
</script>
</body>
</html>`;

fs.writeFileSync('compare-report.html', html);

const counts = rows.reduce((m, r) => ((m[r.state] = (m[r.state] || 0) + 1), m), {});
console.log('\nDone!');
console.log(`  Missing (404):    ${counts.missing || 0}`);
console.log(`  Content differs:  ${counts.differs || 0}  (similarity < 70%)`);
console.log(`  OK:               ${counts.ok || 0}`);
console.log(`  Errors:           ${counts.error || 0}`);
console.log('\nDashboard: open compare-report.html in a browser');
console.log('Raw data:  content-report.json');
