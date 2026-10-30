import { isAdminAuthenticated } from "@/lib/auth";

export async function requireAdmin(): Promise<Response | null> {
  if (await isAdminAuthenticated()) return null;
  return Response.json({ error: "Administrator authentication required" }, { status: 401 });
}
