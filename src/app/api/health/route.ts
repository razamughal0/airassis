import { db } from "@/db";
import { documents } from "@/db/schema";
import { desc } from "drizzle-orm";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    let indexedDocuments: number | null = null;
    let lastDocumentUpdate: string | null = null;
    try {
      const rows = await db
        .select({ id: documents.id, updatedAt: documents.updatedAt })
        .from(documents)
        .orderBy(desc(documents.updatedAt))
        .limit(1);
      const counts = await db.execute<{ count: number }>(sql`select count(*)::int as count from documents`);
      indexedDocuments = Number(counts.rows[0]?.count ?? 0);
      lastDocumentUpdate = rows[0]?.updatedAt?.toISOString() ?? null;
    } catch {
      indexedDocuments = null;
    }
    return Response.json({
      ok: true,
      service: "air-university-knowledge-assistant",
      database: "connected",
      indexedDocuments,
      lastDocumentUpdate,
      time: new Date().toISOString(),
    });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
