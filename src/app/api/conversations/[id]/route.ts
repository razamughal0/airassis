import { getConversation } from "@/lib/services/chat";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const conversationId = Number(id);
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return Response.json({ error: "Invalid conversation id" }, { status: 400 });
  }
  if (!sessionId || sessionId.length < 6) {
    return Response.json({ error: "A valid sessionId is required" }, { status: 400 });
  }
  const conversation = await getConversation(conversationId, sessionId);
  if (!conversation) return Response.json({ error: "Conversation not found" }, { status: 404 });
  return Response.json(conversation);
}
