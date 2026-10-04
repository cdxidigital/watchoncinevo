import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

type CatalogRow = {
  title: string;
  year: string;
  kind: string;
  genre: string;
  rating: number;
  synopsis: string;
};

export const askCinevo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { question: string; titles?: CatalogRow[] }) => {
    if (!input || typeof input.question !== "string" || input.question.length > 400) {
      throw new Error("Invalid concierge request");
    }
    if (input.titles && (!Array.isArray(input.titles) || input.titles.length > 80)) {
      throw new Error("Invalid catalog");
    }
    for (const title of input.titles ?? []) {
      if (!title || typeof title.title !== "string" || title.title.length > 200 ||
        typeof title.synopsis !== "string" || title.synopsis.length > 1000 ||
        typeof title.year !== "string" || title.year.length > 20 ||
        typeof title.kind !== "string" || title.kind.length > 40 ||
        typeof title.genre !== "string" || title.genre.length > 200 ||
        typeof title.rating !== "number" || !Number.isFinite(title.rating)) {
        throw new Error("Invalid catalog");
      }
    }
    return input;
  })
  .handler(async ({ data }) => {
    const question = data.question.trim();
    if (!question) return { ok: false as const, error: "Ask something first." };

    const titles = data.titles ?? [];
    if (!titles.length) {
      return { ok: true as const, text: "Your library is empty. Add a folder or sign in with Plex, then ask again." };
    }

    const apiKey = process.env.XAI_API_KEY;
    const catalog = titles
      .slice(0, 80)
      .map((t) => `${t.title} (${t.year}, ${t.kind}, ${t.genre}, ${t.rating}) — ${t.synopsis}`)
      .join("\n");

    if (!apiKey) {
      const q = question.toLowerCase();
      const pick =
        titles.find((t) => q.includes(t.genre.toLowerCase()) || q.includes(t.title.toLowerCase())) ?? titles[0];
      return {
        ok: true as const,
        text: `Tonight I’d put on ${pick.title} (${pick.year}). ${pick.synopsis}`,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch("https://api.x.ai/v1/chat/completions", {
      signal: controller.signal,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 280,
        messages: [
          {
            role: "system",
            content:
              "You are CINEVO’s concierge. Recommend only from the owner’s private catalog. Be concise, cinematic, no hype. Never invent titles.",
          },
          {
            role: "user",
            content: `Catalog:\n${catalog}\n\nQuestion: ${question}`,
          },
        ],
      }),
      });
    } catch {
      return { ok: false as const, error: "Concierge is offline right now." };
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) return { ok: false as const, error: "Concierge is offline right now." };
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return { ok: true as const, text: body.choices?.[0]?.message?.content ?? "Nothing tonight." };
  });
