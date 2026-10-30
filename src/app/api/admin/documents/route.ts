import { z } from "zod";
import { db } from "@/db";
import { adminAudit, documents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { ingestDocument } from "@/lib/ingestion/ingest";
import type { Campus, PageType } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  id: z.number().int().positive(),
  action: z.enum(["reprocess", "invalidate", "restore", "delete", "mark_ocr"]),
});

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Invalid document action" }, { status: 422 });

  const { id, action } = parsed.data;
  const rows = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!rows.length) return Response.json({ error: "Document not found" }, { status: 404 });
  const document = rows[0];

  if (action === "delete") {
    await db.delete(documents).where(eq(documents.id, id));
  } else if (action === "invalidate") {
    await db
      .update(documents)
      .set({ active: false, processingStatus: "invalid", freshness: "expired", updatedAt: new Date() })
      .where(eq(documents.id, id));
  } else if (action === "restore") {
    await db
      .update(documents)
      .set({ active: true, processingStatus: "indexed", updatedAt: new Date() })
      .where(eq(documents.id, id));
  } else if (action === "mark_ocr") {
    await db
      .update(documents)
      .set({ processingStatus: "ocr_pending", error: "Queued for OCR by administrator", active: false, updatedAt: new Date() })
      .where(eq(documents.id, id));
  } else {
    await ingestDocument({
      sourceUrl: document.sourceUrl,
      canonicalUrl: document.canonicalUrl,
      title: document.title,
      text: document.contentText,
      campus: document.campus as Campus,
      pageType: document.pageType as PageType,
      contentType: document.contentType as "html" | "pdf" | "image" | "text",
      extractionMode: document.extractionMode as "live_crawl" | "operator_snapshot" | "manual",
      lastModified: document.lastModified,
      publicationDate: document.publicationDate,
      expiryDate: document.expiryDate,
      effectiveSession: document.effectiveSession,
      trustLevel: document.trustLevel as "official" | "official-portal" | "third-party" | "unknown",
      extractionConfidence: document.extractionConfidence,
      provenanceNote: document.provenanceNote,
      pageCount: document.pageCount,
    });
  }

  await db.insert(adminAudit).values({
    action: `document.${action}`,
    detail: `Document ${id} (${document.title.slice(0, 120)}) — ${action}`,
  });

  return Response.json({ ok: true, action, id });
}
