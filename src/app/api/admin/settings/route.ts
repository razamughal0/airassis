import { db } from "@/db";
import { adminAudit } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import {
  getSettings,
  sanitizeCrawlerConfig,
  sanitizeLlmConfig,
  sanitizeRetrievalConfig,
  saveSetting,
} from "@/lib/settings";
import { clearRobotsCache } from "@/lib/crawler/robots";
import { resetPolitenessState } from "@/lib/crawler/fetcher";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return Response.json({ settings: await getSettings() });
}

export async function PATCH(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const body = (raw ?? {}) as { crawler?: unknown; retrieval?: unknown; llm?: unknown };
  const current = await getSettings();

  if (body.crawler) {
    const next = sanitizeCrawlerConfig(body.crawler, current.crawler);
    await saveSetting("crawler", next as unknown as Record<string, unknown>);
  }
  if (body.retrieval) {
    const next = sanitizeRetrievalConfig(body.retrieval, current.retrieval);
    await saveSetting("retrieval", next as unknown as Record<string, unknown>);
  }
  if (body.llm) {
    const next = sanitizeLlmConfig(body.llm, current.llm);
    await saveSetting("llm", next as unknown as Record<string, unknown>);
  }
  clearRobotsCache();
  resetPolitenessState();
  await db.insert(adminAudit).values({
    action: "settings.update",
    detail: `Updated sections: ${Object.keys(body).filter((key) => Boolean((body as Record<string, unknown>)[key])).join(", ") || "none"}`,
  });
  return Response.json({ ok: true, settings: await getSettings() });
}
