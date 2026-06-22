// Drafts a social post (X / LinkedIn / Instagram) reacting to an intel item.
// Inserts a row in social_drafts. Can also be called as a nightly batch
// (no body) to draft posts for the day's top-scoring unactioned intel items.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (s: number, p: unknown) =>
  new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Platform = "x" | "linkedin" | "instagram" | "telegram";
interface Body { intelItemId?: string; platform?: Platform; force?: boolean; }

function platformGuide(p: Platform): string {
  switch (p) {
    case "x": return "X / Twitter post: under 270 chars, punchy, one strong angle, optionally end with the article URL. No hashtag spam (max 2).";
    case "linkedin": return "LinkedIn post: 100-180 words, hook in first line, share a perspective or insight on the news, end with a soft question to invite engagement. No hashtag spam.";
    case "instagram": return "Instagram caption: 80-150 words, conversational, line breaks for readability, 3-5 relevant hashtags at the end.";
    case "telegram": return "Telegram broadcast: 40-120 words, news-anchor tone, lead with the headline angle, end with the article URL on its own line. Use light <b>HTML</b> formatting if useful. No hashtags.";
  }
}

async function draftOne(supabase: any, userId: string, intel: any, platform: Platform, lovableKey: string) {
  const { data: memRows } = await supabase
    .from("agent_memories").select("title, content").eq("user_id", userId).limit(4);
  const memBlock = (memRows ?? []).map((m: any) => `${m.title}: ${String(m.content).slice(0, 300)}`).join("\n");

  const userPrompt = `Write a ${platform} post reacting to this news. Position the writer as a thoughtful voice in African tech / their domain. Don't be salesy.

${platformGuide(platform)}

NEWS
Headline: ${intel.title}
Source: ${intel.source}
URL: ${intel.url ?? ""}
Summary: ${intel.summary ?? ""}
Tags: ${(intel.tags ?? []).join(", ")}

WRITER IDENTITY
${memBlock || "(no memory — write neutrally)"}`;

  const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "You write authentic, non-corporate social posts. No emojis at the start. No 'In today's fast-paced world'. No 'thoughts?' as the only CTA." },
        { role: "user", content: userPrompt },
      ],
      tools: [{
        type: "function",
        function: {
          name: "return_post",
          description: "Return the drafted social post.",
          parameters: {
            type: "object",
            properties: { body: { type: "string" } },
            required: ["body"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "return_post" } },
    }),
  });
  if (!aiRes.ok) throw new Error(`AI ${aiRes.status}`);
  const aj = await aiRes.json();
  const argsStr = aj?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!argsStr) throw new Error("no draft");
  const parsed = JSON.parse(argsStr) as { body: string };

  const { data: row, error } = await supabase.from("social_drafts").insert({
    user_id: userId, intel_item_id: intel.id, platform, body: parsed.body, status: "draft",
  }).select("id").single();
  if (error) throw new Error(error.message);
  return row.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json(500, { error: "LOVABLE_API_KEY missing" });

    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const { intelItemId, platform, force } = body as Body;

    // Cron mode (no intelItemId): X-only, top 2 items per user, score >= 70.
    if (!intelItemId) {
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY);
      const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
      const { data: items } = await supabase.from("intel_items")
        .select("*").gte("created_at", since).gte("relevance_score", 70).eq("acted_on", false)
        .order("relevance_score", { ascending: false }).limit(30);

      const byUser: Record<string, any[]> = {};
      for (const it of items ?? []) (byUser[it.user_id] ||= []).push(it);

      // Skip dormant users to avoid burning AI credits on inactive accounts.
      const { filterActiveUsers } = await import("../_shared/active-user.ts");
      const activeIds = new Set(await filterActiveUsers(supabase, Object.keys(byUser), 14));

      let drafted = 0;
      for (const [userId, userItems] of Object.entries(byUser)) {
        if (!activeIds.has(userId)) continue;
        const top = userItems.slice(0, 2);
        for (const it of top) {
          // skip if any draft already exists for this intel (any platform)
          const { count } = await supabase.from("social_drafts")
            .select("id", { count: "exact", head: true }).eq("intel_item_id", it.id);
          if ((count ?? 0) > 0) continue;
          try { await draftOne(supabase, userId, it, "x", LOVABLE_API_KEY); drafted++; }
          catch (e) { console.error("draftOne failed", e); }
        }
      }
      return json(200, { drafted });
    }

    // Single item mode (user)
    if (!platform || !["x", "linkedin", "instagram", "telegram"].includes(platform))
      return json(400, { error: "platform required (x|linkedin|instagram|telegram)" });

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json(401, { error: "Unauthorized" });

    const { data: intel } = await supabase.from("intel_items").select("*").eq("id", intelItemId).maybeSingle();
    if (!intel) return json(404, { error: "Intel not found" });

    // Cache check: return existing draft id unless force=true
    if (!force) {
      const { data: existing } = await supabase
        .from("social_drafts")
        .select("id")
        .eq("user_id", user.id)
        .eq("intel_item_id", intelItemId)
        .eq("platform", platform)
        .maybeSingle();
      if (existing?.id) return json(200, { id: existing.id, cached: true });
    } else {
      // Force: delete the existing row so the new insert doesn't collide with the unique index
      await supabase.from("social_drafts")
        .delete()
        .eq("user_id", user.id)
        .eq("intel_item_id", intelItemId)
        .eq("platform", platform);
    }

    const id = await draftOne(supabase, user.id, intel, platform, LOVABLE_API_KEY);
    return json(200, { id, cached: false });
  } catch (e) {
    console.error("draft-social-from-intel error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
});
