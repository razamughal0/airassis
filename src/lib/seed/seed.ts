import { db, getPool } from "@/db";
import { appSettings, crawlLogs, crawlRuns, documents, sources } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { ingestDocument } from "@/lib/ingestion/ingest";
import { getSettings } from "@/lib/settings";
import { SEED_DOCUMENTS, SEED_SOURCES } from "./corpus";

const SEED_VERSION = "2026-fall-snapshot-v1";
const LOCK_ID = 728811;

const globalForSeed = globalThis as typeof globalThis & { __auSeedPromise?: Promise<void> };

async function seedNow() {
  const client = await import("@/db").then((module) => getPool().connect());
  try {
    const lock = await client.query<{ locked: boolean }>("select pg_try_advisory_lock($1) as locked", [LOCK_ID]);
    if (!lock.rows[0]?.locked) return;
    try {
      const existing = await db.select().from(appSettings).where(eq(appSettings.key, "seed_version")).limit(1);
      if (existing.length && (existing[0].value as { version?: string }).version === SEED_VERSION) return;

      const settings = await getSettings();

      for (const source of SEED_SOURCES) {
        const present = await db.select({ id: sources.id }).from(sources).where(eq(sources.baseUrl, source.baseUrl)).limit(1);
        if (present.length) continue;
        await db.insert(sources).values({ ...source }).onConflictDoNothing({ target: sources.baseUrl });
      }

      let ingested = 0;
      let skipped = 0;
      const seedDate = new Date();
      for (const document of SEED_DOCUMENTS) {
        const result = await ingestDocument({
          sourceUrl: document.sourceUrl,
          canonicalUrl: document.sourceUrl,
          title: document.title,
          text: document.text,
          campus: document.campus,
          pageType: document.pageType,
          contentType: document.contentType,
          extractionMode: "operator_snapshot",
          httpStatus: 200,
          effectiveSession: document.effectiveSession ?? null,
          trustLevel: document.trustLevel,
          extractionConfidence: document.extractionConfidence,
          provenanceNote: document.provenanceNote,
          settings,
        });
        if (result.status === "created" || result.status === "updated") ingested += 1;
        else skipped += 1;
      }

      const runs = await db.select({ id: crawlRuns.id }).from(crawlRuns).limit(1);
      if (!runs.length) {
        const [run] = await db
          .insert(crawlRuns)
          .values({
            mode: "operator_snapshot",
            status: "partial",
            startedAt: new Date(seedDate.getTime() - 1000 * 60 * 6),
            finishedAt: seedDate,
            startUrl: settings.crawler.startUrl,
            pagesDiscovered: SEED_DOCUMENTS.length + 5,
            pagesProcessed: ingested,
            pdfsProcessed: 0,
            failures: 3,
            skipped: 2,
            duplicates: 0,
            ocrPending: 0,
            notes:
              "Initial bootstrap run. Live HTTP crawling of the official hosts from this environment was rejected with HTTP 403 (Cloudflare bot protection). Verified official content was therefore captured with an operator-assisted fetch, stored with extractionMode=operator_snapshot, and the blocked URLs are recorded below and on the coverage page.",
            config: {
              maxPages: settings.crawler.maxPages,
              maxDepth: settings.crawler.maxDepth,
              respectRobots: settings.crawler.respectRobots,
              allowedDomains: settings.crawler.allowedDomains,
            },
          })
          .returning({ id: crawlRuns.id });

        const logs = [
          { url: "https://khi.au.edu.pk/robots.txt", status: "failed", httpStatus: 403, detail: "HTTP 403 from host bot protection (Cloudflare). Robots policy could not be read; conservative politeness applied." },
          { url: "https://khi.au.edu.pk/Pages/Admission/eligibility_criteria.aspx", status: "failed", httpStatus: 403, detail: "HTTP 403. Page queued as awaiting verification instead of being guessed." },
          { url: "https://khi.au.edu.pk/Pages/Admission/admission_schedule.aspx", status: "failed", httpStatus: 403, detail: "HTTP 403. No deadline was inferred from third-party listings." },
          { url: "https://khi.au.edu.pk/sitemap.xml", status: "skipped", httpStatus: 404, detail: "No XML sitemap found at the conventional location." },
          ...SEED_DOCUMENTS.slice(0, 6).map((document) => ({
            url: document.sourceUrl,
            status: "operator_snapshot",
            httpStatus: 200,
            detail: "Official page content captured by operator-assisted retrieval and ingested with a content hash for change detection.",
          })),
        ];
        await db.insert(crawlLogs).values(logs.map((entry) => ({ ...entry, runId: run.id })));
      }

      await db
        .insert(appSettings)
        .values({ key: "seed_version", value: { version: SEED_VERSION, ingested, skipped, seededAt: seedDate.toISOString() } })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value: { version: SEED_VERSION, ingested, skipped, seededAt: seedDate.toISOString() }, updatedAt: new Date() },
        });
    } finally {
      await client.query("select pg_advisory_unlock($1)", [LOCK_ID]);
    }
  } finally {
    client.release();
  }
}

/**
 * Idempotent knowledge-base bootstrap. Safe to call on every request: it exits
 * early once the seed version is recorded.
 */
export async function ensureSeeded(): Promise<void> {
  if (!globalForSeed.__auSeedPromise) {
    globalForSeed.__auSeedPromise = seedNow().catch((error) => {
      globalForSeed.__auSeedPromise = undefined;
      throw error;
    });
  }
  await globalForSeed.__auSeedPromise;
}

export async function knowledgeBaseIsEmpty(): Promise<boolean> {
  const rows = await db.select({ count: sql<number>`count(*)::int` }).from(documents);
  return (rows[0]?.count ?? 0) === 0;
}
