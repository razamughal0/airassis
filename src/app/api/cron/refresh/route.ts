import { timingSafeEqual } from "node:crypto";
import { triggerCrawl, crawlIsRunning, lastSuccessfulCrawl } from "@/lib/crawler/crawl";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : new URL(request.url).searchParams.get("secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Scheduled refresh endpoint. Point a cron job (Task Scheduler on Windows,
 * systemd timer, or a hosted scheduler) at:
 *   POST /api/cron/refresh   Authorization: Bearer $CRON_SECRET
 * The app never assumes a page is current merely because it still resolves;
 * every response is hashed and compared with the stored version.
 */
export async function POST(request: Request) {
  if (!process.env.CRON_SECRET) {
    return Response.json({ error: "Scheduled refresh is not configured (CRON_SECRET missing)" }, { status: 503 });
  }
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (crawlIsRunning()) return Response.json({ started: false, note: "A crawl is already running" }, { status: 409 });
  const result = await triggerCrawl("scheduled");
  return Response.json(result, { status: result.started ? 202 : 409 });
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ running: crawlIsRunning(), lastSuccessfulCrawl: await lastSuccessfulCrawl() });
}
