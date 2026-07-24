import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { chromium, type BrowserContext, type Page } from "playwright";
import { db } from "../src/lib/db";

const NAV_TIMEOUT = 20_000;
const IDLE_CAP = 4_000;
const RETRIES = 2;
const CONCURRENCY = Math.max(1, Number(process.env.AUDIT_CONCURRENCY ?? 5));

type Snapshot = { title: string; h1: string; metaDesc: string; text: string };
type RouteCheck = { path: string; oldStatus: string; newStatus: string };

const cleanPath = (path: string) => path.split("#")[0].split("?")[0].replace(/\/+$/, "") || "/";

function privateIp(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const ip = address.toLowerCase();
  return ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:") || ip === "::";
}

async function assertPublicHost(url: string) {
  const hostname = new URL(url).hostname;
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateIp(address))) {
    throw new Error(`Host ${hostname} resolves to a private or unavailable address`);
  }
}

async function gotoSafe(page: Page, url: string) {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT + attempt * 10_000,
    }).catch(() => null);
    if (response) return response;
  }
  return null;
}

const settle = (page: Page) => page.waitForLoadState("networkidle", { timeout: IDLE_CAP }).catch(() => undefined);

async function sitemapPaths(baseUrl: string) {
  const origin = new URL(baseUrl).origin;
  async function fetchLocs(url: string) {
    try {
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return [];
      const xml = await response.text();
      return [...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/g)].map((match) => match[1]);
    } catch { return []; }
  }
  const top = await fetchLocs(`${origin}/sitemap.xml`);
  const nested = (await Promise.all(top.filter((url) => url.endsWith(".xml")).slice(0, 20).map(fetchLocs))).flat();
  return [...top, ...nested].flatMap((value) => {
    try {
      const url = new URL(value);
      return url.origin === origin && !url.pathname.endsWith(".xml") ? [cleanPath(url.pathname)] : [];
    } catch { return []; }
  });
}

async function discoverRoutes(context: BrowserContext, oldUrl: string, maxPages: number, onProgress: (count: number) => Promise<void>) {
  const origin = new URL(oldUrl).origin;
  const discovered = new Set<string>(["/"]);
  const queue = ["/"];
  for (const path of await sitemapPaths(oldUrl)) if (discovered.size < maxPages) discovered.add(path);
  queue.push(...[...discovered].filter((path) => path !== "/"));
  const page = await context.newPage();
  while (queue.length && discovered.size <= maxPages) {
    const path = queue.shift()!;
    const response = await gotoSafe(page, oldUrl + path);
    if (!response) continue;
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => undefined);
    const links = await page.$$eval("a[href]", (nodes) => nodes.map((node) => (node as HTMLAnchorElement).href)).catch(() => []);
    for (const link of links) {
      try {
        const url = new URL(link);
        const next = cleanPath(url.pathname);
        if (url.origin === origin && !discovered.has(next) && discovered.size < maxPages) {
          discovered.add(next);
          queue.push(next);
        }
      } catch {}
    }
    if (discovered.size % 10 === 0) await onProgress(discovered.size);
  }
  await page.close();
  return [...discovered].sort();
}

async function snapshot(page: Page, url: string): Promise<{ status: string; data: Snapshot | null }> {
  const response = await gotoSafe(page, url);
  if (!response) return { status: "ERR", data: null };
  await settle(page);
  const data = await page.evaluate(() => ({
    title: document.title || "",
    h1: (document.querySelector("h1") as HTMLElement | null)?.innerText?.trim() || "",
    metaDesc: document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content || "",
    text: document.body?.innerText || "",
  })).catch(() => null);
  return { status: String(response.status()), data };
}

function similarity(a: string, b: string) {
  const words = (value: string) => new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2));
  const oldWords = words(a), newWords = words(b);
  if (!oldWords.size && !newWords.size) return 100;
  let intersection = 0;
  for (const word of oldWords) if (newWords.has(word)) intersection++;
  return Math.round((intersection / (oldWords.size + newWords.size - intersection)) * 100);
}

function classification(path: string) {
  if (/^\/blog\//.test(path)) return { category: "blog", action: `301 redirect -> /blogs${path.slice(5)}` };
  if (/policy|terms-of-service/.test(path)) return { category: "legal", action: "Migrate for compliance" };
  if (/near-me|vaccination|grooming|veterinarian|pet-clinic|pet-hospital/.test(path)) return { category: "seo", action: "Migrate SEO landing page" };
  return { category: "core", action: "Migrate or add an intentional redirect" };
}

export async function executeAudit(runId: string) {
  const run = await db.migrationRun.findUnique({ where: { id: runId }, include: { project: true } });
  if (!run) throw new Error("Audit run not found");
  const project = run.project;
  await Promise.all([assertPublicHost(project.oldUrl), assertPublicHost(project.newUrl)]);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route("**/*", (route) => ["image", "font", "media"].includes(route.request().resourceType()) ? route.abort() : route.continue());
  try {
    await db.migrationRun.update({ where: { id: runId }, data: { status: "CRAWLING", progress: 2, stageMessage: "Discovering old-site routes", startedAt: new Date() } });
    const paths = await discoverRoutes(context, project.oldUrl, run.maxPages, async (count) => {
      await db.migrationRun.update({ where: { id: runId }, data: { stageMessage: `Discovered ${count} routes` } });
    });
    await db.migrationRun.update({ where: { id: runId }, data: { status: "COMPARING", progress: 10, totalPages: paths.length, stageMessage: `Comparing ${paths.length} pages` } });

    let cursor = 0, processed = 0, ok = 0, missing = 0, differs = 0, errors = 0;
    async function worker() {
      const page = await context.newPage();
      while (true) {
        const index = cursor++;
        if (index >= paths.length) break;
        const path = paths[index];
        const oldPage = await snapshot(page, project.oldUrl + path);
        const newPage = await snapshot(page, project.newUrl + path);
        const route: RouteCheck = { path, oldStatus: oldPage.status, newStatus: newPage.status };
        let state: "OK" | "MISSING" | "DIFFERS" | "ERROR", score = 0;
        if (newPage.status === "404") state = "MISSING";
        else if (!oldPage.data || !newPage.data) state = "ERROR";
        else { score = similarity(oldPage.data.text, newPage.data.text); state = score >= 70 ? "OK" : "DIFFERS"; }
        if (state === "OK") ok++; else if (state === "MISSING") missing++; else if (state === "DIFFERS") differs++; else errors++;
        const hint = state === "MISSING" ? classification(path) : { category: null, action: state === "OK" ? "Content matches" : state === "DIFFERS" ? "Review content differences" : "Check page manually" };
        await db.pageResult.upsert({
          where: { runId_path: { runId, path } },
          create: { runId, ...route, state, similarity: score, oldTitle: oldPage.data?.title, newTitle: newPage.data?.title, oldH1: oldPage.data?.h1, newH1: newPage.data?.h1, oldDesc: oldPage.data?.metaDesc, newDesc: newPage.data?.metaDesc, oldWords: oldPage.data?.text.split(/\s+/).filter(Boolean).length, newWords: newPage.data?.text.split(/\s+/).filter(Boolean).length, ...hint },
          update: { ...route, state, similarity: score, ...hint },
        });
        processed++;
        await db.migrationRun.update({ where: { id: runId }, data: { processedPages: processed, okPages: ok, missingPages: missing, differsPages: differs, errorPages: errors, progress: 10 + Math.round((processed / paths.length) * 89), stageMessage: `Compared ${processed} of ${paths.length} pages` } });
      }
      await page.close();
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, paths.length) }, worker));
    await db.migrationRun.update({ where: { id: runId }, data: { status: "COMPLETED", progress: 100, stageMessage: "Audit completed", completedAt: new Date() } });
  } finally {
    await browser.close();
  }
}
