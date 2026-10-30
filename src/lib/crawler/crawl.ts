import { db } from "@/db";
import { crawlLogs, crawlRuns, documents } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getSettings, AppSettings } from "@/lib/settings";
import { isAllowedDomain, isDocumentUrl, isBlockedAsset, normalizeUrl, urlKey } from "@/lib/security/url";
import { fetchResource } from "./fetcher";
import { inferCampus, inferPageType, parseHtml, relevanceScore } from "./parser";
import { ingestDocument } from "@/lib/ingestion/ingest";
import { extractPdf } from "@/lib/ingestion/pdf";

export type CrawlSummary = {
  runId: number;
  status: string;
  pagesDiscovered: number;
  pagesProcessed: number;
  pdfsProcessed: number;
  failures: number;
  skipped: number;
  duplicates: number;
  ocrPending: number;
  note: string;
};

type QueueItem = { url: string; depth: number };

const globalForCrawl = globalThis as typeof globalThis & { __auCrawlRunning?: boolean };

export function crawlIsRunning(): boolean {
  return Boolean(globalForCrawl.__auCrawlRunning);
}

export async function runCrawl(options: {
  mode?: "manual" | "scheduled" | "operator_snapshot";
  settings?: AppSettings;
  maxPagesOverride?: number;
  startUrlOverride?: string;
} = {}): Promise<CrawlSummary> {
  const settings = options.settings ?? (await getSettings());
  const config = { ...settings.crawler };
  if (options.maxPagesOverride) config.maxPages = Math.min(config.maxPages, options.maxPagesOverride);
  const startUrl = normalizeUrl(options.startUrlOverride ?? config.startUrl);
  if (!startUrl) throw new Error("Invalid crawler start URL in configuration");

  const [run] = await db
    .insert(crawlRuns)
    .values({
      mode: options.mode ?? "manual",
      status: "running",
      startUrl,
      config: {
        maxPages: config.maxPages,
        maxDepth: config.maxDepth,
        requestDelayMs: config.requestDelayMs,
        allowedDomains: config.allowedDomains,
        respectRobots: config.respectRobots,
        followPdfs: config.followPdfs,
      },
    })
    .returning({ id: crawlRuns.id });

  globalForCrawl.__auCrawlRunning = true;
  const counts = { discovered: 0, processed: 0, pdfs: 0, failures: 0, skipped: 0, duplicates: 0, ocrPending: 0 };
  const visited = new Set<string>();
  const queue: QueueItem[] = [{ url: startUrl, depth: 0 }];
  visited.add(urlKey(startUrl));
  counts.discovered += 1;
  const startedAt = Date.now();
  const MAX_RUNTIME_MS = 8 * 60 * 1000;

  const log = async (url: string, status: string, detail: string, httpStatus?: number | null, durationMs?: number) => {
    await db.insert(crawlLogs).values({
      runId: run.id,
      url: url.slice(0, 900),
      status,
      detail: detail.slice(0, 1200),
      httpStatus: httpStatus ?? null,
      durationMs: durationMs ?? null,
    });
  };

  const enqueue = (rawUrl: string, depth: number, fromPage: string) => {
    if (counts.discovered >= config.maxPages || depth > config.maxDepth) return;
    const normalized = normalizeUrl(rawUrl, fromPage);
    if (!normalized) return;
    if (!isAllowedDomain(normalized, config.allowedDomains)) return;
    if (isBlockedAsset(normalized) && !isDocumentUrl(normalized)) return;
    if (/\/(login|signin|signup|logout|register)(\/|\?|$)/i.test(normalized)) return;
    const key = urlKey(normalized);
    if (visited.has(key)) {
      counts.duplicates += 1;
      return;
    }
    if (relevanceScore(normalized) < 0) {
      counts.skipped += 1;
      return;
    }
    visited.add(key);
    queue.push({ url: normalized, depth });
    counts.discovered += 1;
  };

  try {
    // Sitemap-assisted discovery (never blocks the crawl if unavailable).
    const origin = new URL(startUrl).origin;
    for (const sitemapUrl of [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`]) {
      const result = await fetchResource(sitemapUrl, { ...config, respectRobots: false });
      if (!result.ok || !result.body) continue;
      const locs = Array.from(result.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map((match) => match[1]);
      for (const loc of locs.slice(0, 120)) {
        if (/sitemap/i.test(loc)) continue;
        enqueue(loc, 1, sitemapUrl);
      }
      await log(sitemapUrl, locs.length ? "ok" : "skipped", `Sitemap parsed: ${locs.length} URL(s) discovered`, result.status);
    }

    while (queue.length && counts.processed + counts.skipped < config.maxPages) {
      if (Date.now() - startedAt > MAX_RUNTIME_MS) {
        await log(startUrl, "skipped", "Crawl stopped at the runtime budget; remaining queue not processed.");
        break;
      }
      const item = queue.shift();
      if (!item) break;

      if (isDocumentUrl(item.url)) {
        if (!config.followPdfs) {
          counts.skipped += 1;
          await log(item.url, "skipped", "PDF crawling disabled by configuration");
          continue;
        }
        const outcome = await fetchResource(item.url, config);
        if (!outcome.ok || !outcome.buffer) {
          counts.failures += 1;
          await log(item.url, outcome.blockedByRobots ? "robots_blocked" : "failed", outcome.note, outcome.status, outcome.durationMs);
          continue;
        }
        const pdf = await extractPdf(outcome.buffer);
        if (!pdf.text.trim()) {
          counts.ocrPending += 1;
          await log(item.url, "ocr_pending", pdf.note, outcome.status, outcome.durationMs);
          continue;
        }
        const result = await ingestDocument({
          sourceUrl: outcome.finalUrl,
          canonicalUrl: outcome.finalUrl,
          title: item.url.split("/").pop() ?? "PDF document",
          text: pdf.text,
          campus: inferCampus(outcome.finalUrl),
          pageType: inferPageType(outcome.finalUrl),
          contentType: "pdf",
          extractionMode: "live_crawl",
          httpStatus: outcome.status,
          lastModified: outcome.lastModified ? new Date(outcome.lastModified) : null,
          trustLevel: "official",
          extractionConfidence: pdf.confidence,
          pageCount: pdf.pageCount,
          provenanceNote: pdf.note,
          settings,
        });
        counts.pdfs += 1;
        counts.processed += 1;
        await log(item.url, result.status === "failed" ? "failed" : "pdf", `PDF ingested (${result.status}), ${pdf.pageCount} page(s)`, outcome.status, outcome.durationMs);
        continue;
      }

      const outcome = await fetchResource(item.url, config);
      if (!outcome.ok || !outcome.body) {
        counts.failures += 1;
        if (outcome.blockedByRobots) counts.skipped += 1;
        await log(
          item.url,
          outcome.blockedByRobots ? "robots_blocked" : "failed",
          outcome.note,
          outcome.status || null,
          outcome.durationMs,
        );
        continue;
      }
      if (!outcome.body) {
        counts.skipped += 1;
        await log(item.url, "skipped", "Response had no textual body", outcome.status, outcome.durationMs);
        continue;
      }
      if (outcome.status === 403 || outcome.status === 503) {
        await log(item.url, "failed", "Host rejected the automated client (possible bot protection)", outcome.status, outcome.durationMs);
      }

      const page = parseHtml(outcome.body, outcome.finalUrl);
      if (page.text.replace(/\s/g, "").length < 100) {
        counts.skipped += 1;
        await log(item.url, "skipped", "Page contained no substantial text content", outcome.status, outcome.durationMs);
        continue;
      }

      const result = await ingestDocument({
        sourceUrl: outcome.finalUrl,
        canonicalUrl: page.canonicalUrl,
        title: page.title,
        text: page.text,
        campus: page.campus,
        pageType: page.pageType,
        contentType: "html",
        extractionMode: "live_crawl",
        httpStatus: outcome.status,
        lastModified: outcome.lastModified ? new Date(outcome.lastModified) : null,
        publicationDate: page.publicationDate ? new Date(page.publicationDate) : null,
        trustLevel: "official",
        extractionConfidence: 0.9,
        settings,
      });
      counts.processed += 1;
      await log(
        item.url,
        result.status === "failed" ? "failed" : result.status === "unchanged" ? "unchanged" : "ok",
        `${result.status}; ${result.chunkCount ?? 0} chunk(s). Title: ${page.title.slice(0, 120)}`,
        outcome.status,
        outcome.durationMs,
      );

      for (const link of [...page.links, ...page.documents]) {
        enqueue(link, item.depth + 1, outcome.finalUrl);
      }
    }

    const status = counts.failures && counts.processed ? "partial" : counts.processed ? "completed" : "failed";
    await db
      .update(crawlRuns)
      .set({
        status,
        finishedAt: new Date(),
        pagesDiscovered: counts.discovered,
        pagesProcessed: counts.processed,
        pdfsProcessed: counts.pdfs,
        failures: counts.failures,
        skipped: counts.skipped,
        duplicates: counts.duplicates,
        ocrPending: counts.ocrPending,
        notes:
          counts.processed === 0
            ? "No page could be processed. Check the crawl log for host-level blocks (403/503) or network restrictions."
            : "Crawl finished. Review failures and OCR queue in the crawl log.",
      })
      .where(eq(crawlRuns.id, run.id));

    return {
      runId: run.id,
      status,
      pagesDiscovered: counts.discovered,
      pagesProcessed: counts.processed,
      pdfsProcessed: counts.pdfs,
      failures: counts.failures,
      skipped: counts.skipped,
      duplicates: counts.duplicates,
      ocrPending: counts.ocrPending,
      note: "Crawl run recorded with per-URL log entries.",
    };
  } catch (error) {
    await db
      .update(crawlRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        failures: counts.failures + 1,
        pagesDiscovered: counts.discovered,
        pagesProcessed: counts.processed,
        notes: error instanceof Error ? error.message.slice(0, 800) : "Unhandled crawler error",
      })
      .where(eq(crawlRuns.id, run.id));
    await log(startUrl, "failed", error instanceof Error ? error.message : "Unhandled crawler error");
    return {
      runId: run.id,
      status: "failed",
      pagesDiscovered: counts.discovered,
      pagesProcessed: counts.processed,
      pdfsProcessed: counts.pdfs,
      failures: counts.failures + 1,
      skipped: counts.skipped,
      duplicates: counts.duplicates,
      ocrPending: counts.ocrPending,
      note: "Crawl aborted with an error; see crawl log.",
    };
  } finally {
    globalForCrawl.__auCrawlRunning = false;
  }
}

/** Starts a crawl without blocking the HTTP request; admin UI polls status. */
export async function triggerCrawl(mode: "manual" | "scheduled" = "manual"): Promise<{ started: boolean; runId?: number; note: string }> {
  if (crawlIsRunning()) return { started: false, note: "A crawl is already running." };
  const runningRows = await db.select({ id: crawlRuns.id }).from(crawlRuns).where(eq(crawlRuns.status, "running")).limit(1);
  if (runningRows.length) {
    return { started: false, runId: runningRows[0].id, note: "A crawl run is already marked as running." };
  }
  globalForCrawl.__auCrawlRunning = true;
  const settings = await getSettings();
  const runIdPromise = runCrawl({ mode, settings });
  runIdPromise.catch(() => undefined).finally(() => {
    globalForCrawl.__auCrawlRunning = false;
  });
  const created = await db.select({ id: crawlRuns.id }).from(crawlRuns).orderBy(desc(crawlRuns.id)).limit(1);
  return { started: true, runId: created[0]?.id, note: "Crawl started in the background. Poll the dashboard for progress." };
}

export async function lastSuccessfulCrawl() {
  const rows = await db
    .select()
    .from(crawlRuns)
    .where(inArray(crawlRuns.status, ["completed", "partial"]))
    .orderBy(desc(crawlRuns.finishedAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function documentStats() {
  const rows = await db
    .select({ campus: documents.campus, pageType: documents.pageType, active: documents.active, contentType: documents.contentType })
    .from(documents);
  const byCampus: Record<string, number> = {};
  const byPageType: Record<string, number> = {};
  let active = 0;
  let inactive = 0;
  let pdfs = 0;
  for (const row of rows) {
    byCampus[row.campus] = (byCampus[row.campus] ?? 0) + 1;
    byPageType[row.pageType] = (byPageType[row.pageType] ?? 0) + 1;
    if (row.active) active += 1;
    else inactive += 1;
    if (row.contentType === "pdf") pdfs += 1;
  }
  return { total: rows.length, active, inactive, pdfs, byCampus, byPageType };
}

export async function pendingDocuments() {
  return db
    .select({ id: documents.id, title: documents.title, sourceUrl: documents.sourceUrl, status: documents.processingStatus, error: documents.error })
    .from(documents)
    .where(and(eq(documents.active, true), inArray(documents.processingStatus, ["ocr_pending", "failed", "pending"])))
    .limit(50);
}
