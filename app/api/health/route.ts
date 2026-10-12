import { z } from "zod";
import { db } from "@/lib/db";
import { isMockAi, MODEL, runStructured } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

/** GET /api/health — app status. Add ?ai=1 to make one tiny Claude call. */
export async function GET(req: Request) {
  const status: Record<string, unknown> = {
    db: db().prepare("SELECT 1 AS ok").get(),
    model: MODEL,
    mockAi: isMockAi(),
    mockExternal: process.env.MOCK_EXTERNAL === "1",
    apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
  };
  if (new URL(req.url).searchParams.get("ai") === "1") {
    try {
      const r = await runStructured({
        task: "ping",
        system: "You are a health check.",
        prompt: 'Reply with {"reply": "pong"}.',
        schema: z.object({ reply: z.string() }),
        effort: "low",
        maxTokens: 2000,
      });
      status.ai = { ok: true, reply: r.data.reply };
    } catch (e) {
      status.ai = { ok: false, error: (e as Error).message };
    }
  }
  return Response.json(status);
}
