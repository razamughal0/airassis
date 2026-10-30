import { z } from "zod";
import { db } from "@/db";
import { adminAudit, conflicts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

const schema = z.object({
  id: z.number().int().positive(),
  status: z.enum(["open", "resolved", "dismissed"]),
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
  if (!parsed.success) return Response.json({ error: "Invalid conflict update" }, { status: 422 });
  await db.update(conflicts).set({ status: parsed.data.status }).where(eq(conflicts.id, parsed.data.id));
  await db.insert(adminAudit).values({
    action: "conflict.review",
    detail: `Conflict ${parsed.data.id} marked ${parsed.data.status}`,
  });
  return Response.json({ ok: true });
}
