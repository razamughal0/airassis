import { db } from "@/db";
import { chunks, documents } from "@/db/schema";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { ensureSeeded } from "@/lib/seed/seed";
import { coverageGaps, sourceReport } from "@/lib/services/chat";
import { documentStats, lastSuccessfulCrawl } from "@/lib/crawler/crawl";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await ensureSeeded();
  } catch (error) {
    console.error("seed failed", error);
  }
  const url = new URL(request.url);
  const campus = url.searchParams.get("campus");
  const pageType = url.searchParams.get("pageType");
  const query = url.searchParams.get("q")?.trim() ?? "";

  const conditions = [];
  if (campus && campus !== "all") conditions.push(eq(documents.campus, campus));
  if (pageType && pageType !== "all") conditions.push(eq(documents.pageType, pageType));
  if (query) {
    const pattern = `%${query.slice(0, 80)}%`;
    conditions.push(or(ilike(documents.title, pattern), ilike(documents.contentText, pattern), ilike(documents.sourceUrl, pattern)));
  }

  const list = await db
    .select({
      id: documents.id,
      title: documents.title,
      sourceUrl: documents.sourceUrl,
      campus: documents.campus,
      pageType: documents.pageType,
      contentType: documents.contentType,
      processingStatus: documents.processingStatus,
      freshness: documents.freshness,
      trustLevel: documents.trustLevel,
      extractionMode: documents.extractionMode,
      extractionConfidence: documents.extractionConfidence,
      crawlTimestamp: documents.crawlTimestamp,
      effectiveSession: documents.effectiveSession,
      chunkCount: documents.chunkCount,
      active: documents.active,
      httpStatus: documents.httpStatus,
      provenanceNote: documents.provenanceNote,
    })
    .from(documents)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(documents.crawlTimestamp))
    .limit(100);

  const [stats, lastCrawl, settings, chunkCount] = await Promise.all([
    documentStats(),
    lastSuccessfulCrawl(),
    getSettings(),
    db.select({ count: sql<number>`count(*)::int` }).from(chunks).then((rows) => rows[0]?.count ?? 0),
  ]);

  return Response.json({
    documents: list.length ? list : await sourceReport(),
    stats: { ...stats, chunks: chunkCount },
    lastCrawl,
    gaps: coverageGaps(),
    scope: {
      startUrl: settings.crawler.startUrl,
      allowedDomains: settings.crawler.allowedDomains,
      maxPages: settings.crawler.maxPages,
      maxDepth: settings.crawler.maxDepth,
      respectRobots: settings.crawler.respectRobots,
      embeddingProvider: settings.retrieval.embeddingProvider,
      embeddingModel: settings.retrieval.embeddingModel,
      llmProvider: settings.llm.provider,
      llmModel: settings.llm.model,
    },
  });
}
