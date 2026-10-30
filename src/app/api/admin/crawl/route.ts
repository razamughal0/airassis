import { db } from "@/db";
import { adminAudit, crawlRuns } from "@/db/schema";
import { desc } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { crawlIsRunning, triggerCrawl } from "@/lib/crawler/crawl";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const runs = await db.select().from(crawlRuns).orderBy(desc(crawlRuns.id)).limit(20);
  return Response.json({ runs, running: crawlIsRunning() });
}

export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const result = await triggerCrawl("manual");
  await db.insert(adminAudit).values({
    action: "crawl.trigger",
    detail: result.started ? `Manual crawl started (run ${result.runId ?? "pending"})` : result.note,
  });
  return Response.json(result, { status: result.started ? 202 : 409 });
}
