import ChatWorkspace from "@/components/ChatWorkspace";
import { db } from "@/db";
import { crawlRuns, documents, sources } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { ensureSeeded } from "@/lib/seed/seed";

export const dynamic = "force-dynamic";

type HomeStats = { documents: number; sources: number; lastUpdated: string | null; campuses: number; snapshots: number };

async function loadStats(): Promise<{ stats: HomeStats; lastCrawlStatus: string | null }> {
  try {
    await ensureSeeded();
  } catch (error) {
    console.error("bootstrap seed unavailable", error);
  }
  try {
    const docRows = await db
      .select({
        total: sql<number>`count(*)::int`,
        campuses: sql<number>`count(distinct ${documents.campus})::int`,
        snapshots: sql<number>`count(*) filter (where ${documents.extractionMode} = 'operator_snapshot')::int`,
        lastUpdated: sql<string | null>`max(${documents.crawlTimestamp})::text`,
      })
      .from(documents)
      .where(eq(documents.active, true));
    const sourceCount = await db.select({ count: sql<number>`count(distinct ${sources.baseUrl})::int` }).from(sources);
    const runs = await db.select({ status: crawlRuns.status }).from(crawlRuns).orderBy(desc(crawlRuns.id)).limit(1);
    return {
      stats: {
        documents: docRows[0]?.total ?? 0,
        sources: sourceCount[0]?.count ?? 0,
        lastUpdated: docRows[0]?.lastUpdated ?? null,
        campuses: docRows[0]?.campuses ?? 0,
        snapshots: docRows[0]?.snapshots ?? 0,
      },
      lastCrawlStatus: runs[0]?.status ?? null,
    };
  } catch (error) {
    console.error("stats unavailable", error);
    return { stats: { documents: 0, sources: 0, lastUpdated: null, campuses: 0, snapshots: 0 }, lastCrawlStatus: null };
  }
}

export default async function HomePage() {
  const { stats, lastCrawlStatus } = await loadStats();
  const snapshotNote =
    stats.snapshots > 0
      ? `Live crawling of the official hosts is currently blocked (HTTP 403 bot protection). Indexed content comes from an operator-verified snapshot of official pages, ${stats.snapshots} of ${stats.documents} sources. Time-sensitive figures must be confirmed on the linked official page.`
      : `Last crawl status: ${lastCrawlStatus ?? "not run"}. Coverage gaps are published on the sources page rather than filled with guesses.`;
  return <ChatWorkspace stats={stats} snapshotNote={snapshotNote} />;
}
