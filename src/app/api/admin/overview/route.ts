import { db } from "@/db";
import {
  adminAudit,
  appSettings,
  conflicts,
  conversations,
  crawlLogs,
  crawlRuns,
  documents,
  messages,
  sources,
} from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { crawlIsRunning, documentStats, lastSuccessfulCrawl, pendingDocuments } from "@/lib/crawler/crawl";
import { getSettings } from "@/lib/settings";
import { SOURCE_GAPS } from "@/lib/seed/corpus";
import { providerInfo } from "@/lib/llm/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const [stats, lastCrawl, pending, settings, conflictRows, runs, logs, sourceRows, counts, seedRow, auditRows] =
    await Promise.all([
      documentStats(),
      lastSuccessfulCrawl(),
      pendingDocuments(),
      getSettings(),
      db.select().from(conflicts).orderBy(desc(conflicts.createdAt)).limit(25),
      db.select().from(crawlRuns).orderBy(desc(crawlRuns.id)).limit(10),
      db
        .select({
          id: crawlLogs.id,
          runId: crawlLogs.runId,
          url: crawlLogs.url,
          status: crawlLogs.status,
          httpStatus: crawlLogs.httpStatus,
          detail: crawlLogs.detail,
          durationMs: crawlLogs.durationMs,
          createdAt: crawlLogs.createdAt,
        })
        .from(crawlLogs)
        .orderBy(desc(crawlLogs.id))
        .limit(60),
      db.select().from(sources).orderBy(desc(sources.id)),
      Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(documents).then((rows) => rows[0]?.count ?? 0),
        db.select({ count: sql<number>`count(*)::int` }).from(conversations).then((rows) => rows[0]?.count ?? 0),
        db.select({ count: sql<number>`count(*)::int` }).from(messages).then((rows) => rows[0]?.count ?? 0),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(messages)
          .where(eq(messages.verificationStatus, "unverified"))
          .then((rows) => rows[0]?.count ?? 0),
      ]),
      db.select().from(appSettings).where(eq(appSettings.key, "seed_version")).limit(1),
      db.select().from(adminAudit).orderBy(desc(adminAudit.id)).limit(10),
    ]);

  const [documentTotal, conversationTotal, messageTotal, unverifiedTotal] = counts;

  return Response.json({
    stats: {
      ...stats,
      chunks: 0,
      documents: documentTotal,
      conversations: conversationTotal,
      messages: messageTotal,
      unverifiedAnswers: unverifiedTotal,
      openConflicts: conflictRows.filter((row) => row.status === "open").length,
      crawlRunning: crawlIsRunning(),
    },
    lastCrawl,
    pending,
    settings,
    provider: providerInfo(settings.llm),
    conflicts: conflictRows,
    runs,
    logs,
    sources: sourceRows,
    gaps: SOURCE_GAPS,
    seed: seedRow[0]?.value ?? null,
    audit: auditRows,
  });
}
