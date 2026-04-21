// Scans Nigerian tech news (Techcabal, Techpoint, BusinessDay) via Firecrawl,
// scores each article against each user's offerings + memory, and writes
// relevant items to public.intel_items (deduped by URL).
//
// Designed to be called by pg_cron once a day. Idempotent.

import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const json = (s: number, p: unknown) =>
  new Response(JSON.stringify(p), { status: s, headers: { "Content-Type": "application/json" } });

const SOURCES = [
  { name: "techcabal",   url: "https://techcabal.com/",                 limit: 12 },
  { name: "techpoint",   url: "https://techpoint.africa/",              limit: 12 },
  { name: "businessday", url: "https://businessday.ng/category/technology/", limit: 12 },
];

type Article = { title: string; url: string; summary?: string; published_at?: string; source: string };

async function firecrawlScrape(url: string, apiKey: string) {
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      formats: [
        "links",
        {
          type: "json",
          prompt:
            "Extract the latest news/article items from this page. Return an array under key `articles` with fields: title (string), url (absolute), summary (1-2 sentences if available), published_at (ISO date if visible). Limit 15 items, newest first.",
        },
      ],
      onlyMainContent: true,
    }),
  });
  if (!res.ok) throw new Error(`firecrawl ${res.status}: ${await res.text()}`);
  return res.json();
}

function normalizeArticles(scrape: any, source: string, baseUrl: string): Article[] {
  const items: any[] =
    scrape?.data?.json?.articles ??
    scrape?.json?.articles ??
    scrape?.data?.extract?.articles ??
    [];
  const base = new URL(baseUrl);
  const out: Article[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!it?.title || !it?.url) continue;
    let abs: string;
    try { abs = new URL(it.url, base).toString(); } catch { continue; }
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({
      title: String(it.title).trim().slice(0, 300),
      url: abs,
      summary: it.summary ? String(it.summary).slice(0, 600) : undefined,
      published_at: (() => {
        const v = it.published_at;
        if (!v || typeof v !== "string" || v.trim() === "") return undefined;
        const d = new Date(v);
        return isNaN(d.getTime()) ? undefined : d.toISOString();
      })(),
      source,
    });
  }
  return out;
}

async function runScanJob(supabase: any, FIRECRAWL_API_KEY: string, LOVABLE_API_KEY: string) {
  try {
    const scraped: Article[] = [];
    const results = await Promise.allSettled(
      SOURCES.map(async (s) => {
        const data = await firecrawlScrape(s.url, FIRECRAWL_API_KEY);
        const arts = normalizeArticles(data, s.name, s.url).slice(0, s.limit);
        console.log(`scan-intel: ${s.name} → ${arts.length} articles`);
        return arts;
      }),
    );
    for (const r of results) {
      if (r.status === "fulfilled") scraped.push(...r.value);
      else console.error("scan-intel: source failed", r.reason);
    }
    if (scraped.length === 0) { console.log("scan-intel: nothing scraped"); return; }

    const { data: users } = await supabase.from("offerings").select("user_id");
    const userIds = Array.from(new Set((users ?? []).map((u: any) => u.user_id)));

    let totalInserted = 0;
    for (const userId of userIds) {
      const [offRes, memRes] = await Promise.all([
        supabase.from("offerings").select("id, title, tagline, problem_solved, target_audience").eq("user_id", userId).eq("status", "active"),
        supabase.from("agent_memories").select("title, content").eq("user_id", userId).limit(8),
      ]);
      const offerings = offRes.data ?? [];
      if (offerings.length === 0) continue;

      const offeringSummary = offerings
        .map((o: any) => `[${o.id}] ${o.title} — ${o.tagline ?? ""} | solves: ${o.problem_solved ?? ""} | for: ${o.target_audience ?? ""}`)
        .join("\n");
      const memorySummary = (memRes.data ?? []).map((m: any) => `${m.title}: ${String(m.content).slice(0, 400)}`).join("\n");

      const urls = scraped.map((a) => a.url);
      const { data: existing } = await supabase
        .from("intel_items").select("url").eq("user_id", userId).in("url", urls);
      const existingSet = new Set((existing ?? []).map((e: any) => e.url));
      const candidates = scraped.filter((a) => !existingSet.has(a.url));
      if (candidates.length === 0) continue;

      const ai = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: "You are an outreach intel analyst. Given a creator's offerings + identity, and a list of news articles, score each article 0-100 for outreach value (would this be a good trigger to pitch a relevant offering to the company/people in the article?). Match relevant offering IDs. Return STRICT JSON only." },
            { role: "user", content:
                `OFFERINGS:\n${offeringSummary}\n\nIDENTITY/MEMORY:\n${memorySummary}\n\nARTICLES (index → title | source):\n` +
                candidates.map((a, i) => `${i}. ${a.title} | ${a.source}${a.summary ? ` — ${a.summary}` : ""}`).join("\n") +
                `\n\nReturn JSON: {"scores":[{"i":0,"score":75,"matched_offering_ids":["uuid",...],"tags":["funding","fintech"],"reason":"why"}]}` },
          ],
          response_format: { type: "json_object" },
        }),
      });

      let scores: any[] = [];
      if (ai.ok) {
        try {
          const aj = await ai.json();
          const txt = aj?.choices?.[0]?.message?.content ?? "{}";
          scores = JSON.parse(txt)?.scores ?? [];
        } catch (e) { console.error("scan-intel: parse scores", e); }
      }

      const offeringIds = new Set(offerings.map((o: any) => o.id));
      const rows = scores
        .map((s: any) => {
          const art = candidates[s.i];
          if (!art) return null;
          const score = Math.max(0, Math.min(100, Number(s.score) || 0));
          if (score < 35) return null;
          const matched = (s.matched_offering_ids ?? []).filter((id: string) => offeringIds.has(id));
          return {
            user_id: userId, source: art.source, title: art.title, url: art.url,
            summary: art.summary ?? s.reason ?? null, published_at: art.published_at ?? null,
            relevance_score: score,
            tags: Array.isArray(s.tags) ? s.tags.slice(0, 6) : null,
            matched_offerings: matched,
          };
        })
        .filter(Boolean);

      if (rows.length > 0) {
        const { error } = await supabase.from("intel_items").insert(rows as any);
        if (error) console.error("scan-intel: insert", error);
        else totalInserted += rows.length;
      }
    }
    console.log(`scan-intel: done, inserted ${totalInserted}`);
  } catch (e) {
    console.error("scan-intel job error", e);
  }
}

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
  if (!FIRECRAWL_API_KEY) return json(500, { error: "FIRECRAWL_API_KEY missing" });

  // @ts-ignore EdgeRuntime is provided by Supabase
  EdgeRuntime.waitUntil(runScanJob(supabase, FIRECRAWL_API_KEY, LOVABLE_API_KEY));
  return json(202, { ok: true, status: "scan started in background" });
});
