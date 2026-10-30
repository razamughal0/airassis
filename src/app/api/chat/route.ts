import { z } from "zod";
import { ensureSeeded } from "@/lib/seed/seed";
import { answerQuestion } from "@/lib/services/chat";
import { rateLimit } from "@/lib/auth";
import { CAMPUSES, SUPPORTED_LANGUAGES } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  message: z.string().trim().min(2).max(1500),
  conversationId: z.number().int().positive().nullable().optional(),
  sessionId: z.string().trim().min(6).max(80),
  language: z.enum(SUPPORTED_LANGUAGES.map((language) => language.id) as [string, ...string[]]).optional(),
  campus: z.enum(["auto", ...CAMPUSES]).optional(),
  stream: z.boolean().optional(),
});

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) },
      { status: 422 },
    );
  }

  const forwarded = request.headers.get("x-forwarded-for") ?? "local";
  const limit = rateLimit(`chat:${forwarded.split(",")[0].trim()}`, 40, 60_000);
  if (!limit.ok) {
    return Response.json({ error: "Too many questions in a short period. Please wait a minute." }, { status: 429 });
  }

  try {
    await ensureSeeded();
  } catch (error) {
    console.error("seed failed", error);
  }

  const payload = {
    message: parsed.data.message,
    conversationId: parsed.data.conversationId ?? null,
    sessionId: parsed.data.sessionId,
    language: (parsed.data.language ?? "en") as "en" | "roman-ur" | "ur",
    campus: (parsed.data.campus ?? "auto") as "auto" | (typeof CAMPUSES)[number],
  };

  if (!parsed.data.stream) {
    try {
      const answer = await answerQuestion(payload);
      return Response.json(answer);
    } catch (error) {
      console.error("chat error", error);
      return Response.json({ error: "The assistant could not complete that answer. Please retry." }, { status: 500 });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      send("start", { at: new Date().toISOString() });
      answerQuestion(payload, (token) => send("token", { token }))
        .then((answer) => {
          const { answer: _text, ...meta } = answer;
          send("meta", meta);
          send("done", { latencyMs: answer.latencyMs });
          controller.close();
        })
        .catch((error: unknown) => {
          console.error("stream chat error", error);
          send("error", { message: "The assistant could not complete that answer. Please retry." });
          controller.close();
        });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
