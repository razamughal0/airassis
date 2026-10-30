import { listConversations } from "@/lib/services/chat";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId || sessionId.length < 6 || sessionId.length > 80) {
    return Response.json({ error: "A valid sessionId is required" }, { status: 400 });
  }
  const items = await listConversations(sessionId);
  return Response.json({ conversations: items });
}
