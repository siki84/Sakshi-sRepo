import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { getFixture } from "./fixtures/index";

export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";

export type Progress =
  | { type: "search"; query: string }
  | { type: "status"; message: string };
export type ProgressFn = (p: Progress) => void;

export type SearchResult = { url: string; title: string };

export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: "refusal" | "invalid_output" | "truncated" | "config",
  ) {
    super(message);
  }
}

export type StructuredRequest<S extends z.ZodType> = {
  /** Stable task name; also selects the fixture in MOCK_AI mode. */
  task: string;
  system: string;
  prompt: string;
  schema: S;
  /** Enable the server-side web search tool. */
  webSearch?: { maxUses: number };
  /**
   * Extra semantic checks after schema validation. Return human-readable problems;
   * they're sent back to the model on retry.
   */
  check?: (data: z.infer<S>, ctx: { searchResults: Map<string, SearchResult> }) => string[];
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  onProgress?: ProgressFn;
  /** Passed to the fixture function in MOCK_AI mode. */
  fixtureInput?: unknown;
};

export type StructuredResult<T> = {
  data: T;
  /** Every web result the model saw, keyed by URL. */
  searchResults: Map<string, SearchResult>;
  attempts: number;
};

const MAX_ATTEMPTS = 3; // first try + 2 retries on bad output
const MAX_CONTINUATIONS = 5; // pause_turn resumes per attempt

let client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      throw new AiError(
        "ANTHROPIC_API_KEY is not set. Add it to .env.local (or run with MOCK_AI=1).",
        "config",
      );
    }
    client = new Anthropic();
  }
  return client;
}

export function isMockAi() {
  return process.env.MOCK_AI === "1";
}

/** Collect every URL returned by web search blocks in a response. */
export function collectSearchResults(content: BetaContentBlock[], into: Map<string, SearchResult>) {
  for (const block of content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) into.set(normalizeUrl(r.url), { url: r.url, title: r.title });
    }
  }
}

export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    for (const p of [...url.searchParams.keys()]) if (p.startsWith("utm_")) url.searchParams.delete(p);
    return (url.host.replace(/^www\./, "") + url.pathname.replace(/\/$/, "") + url.search).toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

/** Pull the JSON payload out of the response text (tolerates stray prose/fences). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[[{]/);
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (start === -1 || end <= start) throw new Error("no JSON found in response");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

export function formatZodError(err: z.ZodError): string[] {
  return err.issues.slice(0, 15).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

/**
 * Validate a candidate payload: schema first, then task-specific checks.
 * Shared by the live and mock paths so fixtures are held to the same bar.
 */
export function validate<S extends z.ZodType>(
  raw: unknown,
  req: Pick<StructuredRequest<S>, "schema" | "check">,
  searchResults: Map<string, SearchResult>,
): { ok: true; data: z.infer<S> } | { ok: false; problems: string[] } {
  const parsed = req.schema.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: formatZodError(parsed.error) };
  const problems = req.check?.(parsed.data, { searchResults }) ?? [];
  return problems.length ? { ok: false, problems } : { ok: true, data: parsed.data };
}

/** Turn SDK/API errors into messages a traveler can act on. */
export function friendlyError(e: unknown): Error {
  if (e instanceof AiError) return e;
  if (e instanceof Anthropic.AuthenticationError) {
    return new AiError("Your Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.local.", "config");
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return new AiError("Your API key doesn't have access to this model or to web search. Check your Claude Console settings.", "config");
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new AiError("Claude is rate-limiting requests right now. Wait a minute and try again.", "config");
  }
  if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message)) {
    return new AiError("Your Anthropic account is out of credit. Add some at console.anthropic.com → Billing.", "config");
  }
  if (e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) {
    return new AiError("Couldn't reach Claude (network or server issue). Try again in a moment.", "config");
  }
  if (e instanceof Anthropic.APIError) {
    return new AiError(`Claude API error${e.status ? ` (${e.status})` : ""}: ${e.message}`, "config");
  }
  return e instanceof Error ? e : new Error(String(e));
}

export async function runStructured<S extends z.ZodType>(
  req: StructuredRequest<S>,
): Promise<StructuredResult<z.infer<S>>> {
  if (isMockAi()) return runMock(req);
  try {
    return await runLive(req);
  } catch (e) {
    throw friendlyError(e);
  }
}

async function runLive<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
  const anthropic = getClient();
  const searchResults = new Map<string, SearchResult>();
  const tools: BetaToolUnion[] = req.webSearch
    ? [{ type: "web_search_20260209", name: "web_search", max_uses: req.webSearch.maxUses }]
    : [];
  const messages: BetaMessageParam[] = [{ role: "user", content: req.prompt }];
  let lastProblems: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) req.onProgress?.({ type: "status", message: `Fixing response (attempt ${attempt})…` });

    let content: BetaContentBlock[] = [];
    for (let cont = 0; cont <= MAX_CONTINUATIONS; cont++) {
      const stream = anthropic.beta.messages.stream({
        model: MODEL,
        max_tokens: req.maxTokens ?? 32000,
        system: req.system,
        messages,
        tools: tools.length ? tools : undefined,
        thinking: { type: "adaptive" },
        output_config: { effort: req.effort ?? "medium", format: betaZodOutputFormat(req.schema) },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      stream.on("contentBlock", (block) => {
        if (block.type === "server_tool_use" && block.name === "web_search") {
          const q = (block.input as { query?: unknown }).query;
          if (typeof q === "string") req.onProgress?.({ type: "search", query: q });
        }
      });
      const msg = await stream.finalMessage();
      collectSearchResults(msg.content, searchResults);

      if (msg.stop_reason === "refusal") {
        throw new AiError(
          `The model declined this request${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ""}.`,
          "refusal",
        );
      }
      if (msg.stop_reason === "max_tokens") {
        throw new AiError("The response was cut off (max_tokens). Try again.", "truncated");
      }
      if (msg.stop_reason === "pause_turn") {
        // Server-side tool loop hit its iteration cap: resend and it resumes.
        messages.push({ role: "assistant", content: msg.content });
        continue;
      }
      content = msg.content;
      messages.push({ role: "assistant", content: msg.content });
      break;
    }

    const text = content
      .filter((b): b is Extract<BetaContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");

    let raw: unknown;
    try {
      raw = extractJson(text);
    } catch (e) {
      lastProblems = [`Response was not valid JSON: ${(e as Error).message}`];
    }
    if (raw !== undefined) {
      const result = validate(raw, req, searchResults);
      if (result.ok) return { data: result.data, searchResults, attempts: attempt };
      lastProblems = result.problems;
    }
    messages.push({
      role: "user",
      content:
        "Your JSON did not pass validation. Problems:\n- " +
        lastProblems.join("\n- ") +
        "\nReturn the complete corrected JSON object. Do not drop valid items; fix or remove only the invalid ones.",
    });
  }
  throw new AiError(`Couldn't get a valid response: ${lastProblems.join("; ")}`, "invalid_output");
}

async function runMock<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
  const fx = getFixture(req.task, req.fixtureInput);
  const searchResults = new Map<string, SearchResult>();
  for (const r of fx.searchResults) searchResults.set(normalizeUrl(r.url), r);
  for (const q of fx.queries) {
    req.onProgress?.({ type: "search", query: q });
    await new Promise((r) => setTimeout(r, 40));
  }
  const result = validate(fx.data, req, searchResults);
  if (!result.ok) {
    throw new AiError(`Fixture for "${req.task}" failed validation: ${result.problems.join("; ")}`, "invalid_output");
  }
  return { data: result.data, searchResults, attempts: 1 };
}
