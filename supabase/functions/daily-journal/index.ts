// Daily Journal — nightly summarizer for the agent's long memory.
// Pulls last 24h activity, asks Lovable AI for a structured journal,
// upserts `daily-journal-YYYY-MM-DD` and the rolling `journal-rollup`
// memory file. Prunes journals older than 14 days. On Sunday nights,
// also writes a `weekly-journal-YYYY-Www` digest.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const MODEL = "google/gemini-2.5-flash-lite";

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}
function prettyDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((t.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

async function callAI(apiKey: string, system: string, user: string): Promise<string> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = await res.json();
  return j?.choices?.[0]?.message?.content?.trim() ?? "";
}

async function buildJournalForUser(supabase: any, apiKey: string, userId: string, force: boolean) {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const dateSlug = ymd(now);
  const slug = `daily-journal-${dateSlug}`;

  const { data: existing } = await supabase
    .from("agent_memories")
    .select("id, content")
    .eq("user_id", userId)
    .eq("slug", slug)
    .maybeSingle();
  if (existing && !force) return { user_id: userId, skipped: "exists" };

  const [pitchesR, eventsR, runsR, leadsR, intelR, socialR, msgFailR, prevR] = await Promise.all([
    supabase.from("pitches").select("id, subject, sent_at").eq("user_id", userId).gte("sent_at", since).order("sent_at"),
    supabase.from("pitch_events").select("event_type, occurred_at, payload").eq("user_id", userId).gte("occurred_at", since),
    supabase.from("campaign_runs").select("state, error, updated_at").eq("user_id", userId).gte("updated_at", since),
    supabase.from("leads").select("id, business_name, status, score, created_at, updated_at").eq("user_id", userId).gte("updated_at", since),
    supabase.from("intel_items").select("title, source, relevance_score, acted_on, created_at, tags").eq("user_id", userId).gte("created_at", since),
    supabase.from("social_drafts").select("platform, status, created_at, posted_at").eq("user_id", userId).gte("created_at", since),
    supabase.from("channel_messages").select("channel, status, error, created_at").eq("user_id", userId).gte("created_at", since).neq("status", "sent").limit(20),
    supabase.from("agent_memories").select("content").eq("user_id", userId).eq("slug", `daily-journal-${ymd(new Date(now.getTime() - 24 * 60 * 60 * 1000))}`).maybeSingle(),
  ]);

  const events = eventsR.data ?? [];
  const opens = events.filter((e: any) => e.event_type === "opened").length;
  const replies = events.filter((e: any) => e.event_type === "replied").length;
  const bounces = events.filter((e: any) => e.event_type === "bounced").length;
  const won = (leadsR.data ?? []).filter((l: any) => l.status === "won");
  const lost = (leadsR.data ?? []).filter((l: any) => l.status === "lost");
  const failures = (runsR.data ?? []).filter((r: any) => r.error);
  const intelActed = (intelR.data ?? []).filter((i: any) => i.acted_on);
  const socialPosted = (socialR.data ?? []).filter((s: any) => s.status === "posted");

  const totals = {
    sent: pitchesR.data?.length ?? 0,
    opens, replies, bounces,
    leads_touched: leadsR.data?.length ?? 0,
    won: won.length, lost: lost.length,
    intel_scanned: intelR.data?.length ?? 0,
    intel_acted: intelActed.length,
    social_drafts: socialR.data?.length ?? 0,
    social_posted: socialPosted.length,
    run_errors: failures.length,
    delivery_failures: msgFailR.data?.length ?? 0,
  };

  const facts = `
## Raw activity (last 24h)

**Totals:** ${JSON.stringify(totals)}

**Pitches sent:**
${(pitchesR.data ?? []).slice(0, 30).map((p: any) => `- "${p.subject ?? "(no subject)"}"`).join("\n") || "_none_"}

**Lead status changes:**
${(leadsR.data ?? []).slice(0, 30).map((l: any) => `- ${l.business_name} → ${l.status} (score ${l.score})`).join("\n") || "_none_"}

**Run errors:**
${failures.slice(0, 10).map((r: any) => `- ${r.state}: ${r.error}`).join("\n") || "_none_"}

**Delivery failures:**
${(msgFailR.data ?? []).slice(0, 10).map((m: any) => `- ${m.channel} ${m.status}: ${m.error ?? ""}`).join("\n") || "_none_"}

**Intel scanned (top by score):**
${(intelR.data ?? []).sort((a: any, b: any) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0)).slice(0, 10).map((i: any) => `- [${i.relevance_score}] ${i.title} (${i.source})${i.acted_on ? " ✅ acted" : ""}`).join("\n") || "_none_"}

**Social drafts:**
${(socialR.data ?? []).slice(0, 15).map((s: any) => `- ${s.platform} (${s.status})`).join("\n") || "_none_"}

${prevR?.data?.content ? `## Yesterday's notes for tomorrow\n${(prevR.data.content.match(/## Notes for tomorrow[\s\S]*?(?=\n## |$)/i)?.[0] ?? "").slice(0, 600)}` : ""}
`.trim();

  const system = `You are the journaling layer of an autonomous outreach agent for Bill Achusim. Produce a tight daily journal in markdown with these exact H2 sections in order:

## What happened
## What worked
## What failed
## Important keywords / patterns
## Notes for tomorrow

Rules:
- Be concrete, cite numbers from the raw activity.
- Under "What worked" name top-performing subjects, channels, intel triggers if any.
- Under "What failed" infer root cause from errors when obvious (e.g. "no contact email enriched", "Resend bounce").
- Under "Notes for tomorrow" give 1-3 short, concrete suggestions.
- Total length under 500 words. No preamble. No fluff.`;

  const journalBody = await callAI(apiKey, system, facts);
  const fullContent = `# Daily journal — ${prettyDate(now)}\n\n${journalBody}`;

  if (existing) {
    await supabase.from("agent_memories").update({
      title: `Daily journal — ${prettyDate(now)}`,
      kind: "note",
      content: fullContent,
    }).eq("id", existing.id);
  } else {
    await supabase.from("agent_memories").insert({
      user_id: userId,
      slug,
      title: `Daily journal — ${prettyDate(now)}`,
      kind: "note",
      content: fullContent,
    });
  }

  const { data: allJournals } = await supabase
    .from("agent_memories")
    .select("id, slug")
    .eq("user_id", userId)
    .like("slug", "daily-journal-%")
    .order("slug", { ascending: false });
  const toDelete = (allJournals ?? []).slice(14).map((j: any) => j.id);
  if (toDelete.length) {
    await supabase.from("agent_memories").delete().in("id", toDelete);
  }

  const { data: recentJournals } = await supabase
    .from("agent_memories")
    .select("slug, content")
    .eq("user_id", userId)
    .like("slug", "daily-journal-%")
    .order("slug", { ascending: false })
    .limit(7);

  const rollupFacts = (recentJournals ?? []).map((j: any) => {
    const date = j.slug.replace("daily-journal-", "");
    const happened = j.content.match(/## What happened\s*([\s\S]*?)(?=\n## |$)/i)?.[1]?.trim().slice(0, 400) ?? "";
    return `### ${date}\n${happened}`;
  }).join("\n\n");

  if (rollupFacts) {
    const rollupSystem = `Compress the last 7 daily journals into a single rolling memory under 1500 chars. Format: bullet list, newest first, one line per day, capture only the most important fact (a win, a failure, a pattern). No fluff.`;
    let rollupContent = "";
    try {
      rollupContent = await callAI(apiKey, rollupSystem, rollupFacts);
    } catch {
      rollupContent = rollupFacts.slice(0, 1500);
    }
    const fullRollup = `# Last 7 days — rolling rollup\n\n_Auto-generated. The agent reads this every turn for quick context._\n\n${rollupContent}`;
    const { data: rollupExisting } = await supabase
      .from("agent_memories").select("id").eq("user_id", userId).eq("slug", "journal-rollup").maybeSingle();
    if (rollupExisting) {
      await supabase.from("agent_memories").update({
        title: "Last 7 days — rolling rollup",
        kind: "note",
        content: fullRollup,
      }).eq("id", rollupExisting.id);
    } else {
      await supabase.from("agent_memories").insert({
        user_id: userId, slug: "journal-rollup",
        title: "Last 7 days — rolling rollup",
        kind: "note",
        content: fullRollup,
      });
    }
  }

  let weekly: string | null = null;
  if (now.getUTCDay() === 0) {
    const weekSlug = `weekly-journal-${isoWeek(now)}`;
    const { data: weekExisting } = await supabase
      .from("agent_memories").select("id").eq("user_id", userId).eq("slug", weekSlug).maybeSingle();
    if (!weekExisting || force) {
      const weekFacts = (recentJournals ?? []).map((j: any) => `## ${j.slug.replace("daily-journal-", "")}\n${j.content.slice(0, 1200)}`).join("\n\n---\n\n");
      const weekSystem = `Write a weekly digest under 600 words in markdown with H2 sections: Wins, Losses, Patterns, Strategic notes. Cite specifics from the daily journals.`;
      try {
        const weekBody = await callAI(apiKey, weekSystem, weekFacts);
        const weekContent = `# Weekly digest — ${isoWeek(now)}\n\n${weekBody}`;
        if (weekExisting) {
          await supabase.from("agent_memories").update({ title: `Weekly digest — ${isoWeek(now)}`, kind: "note", content: weekContent }).eq("id", weekExisting.id);
        } else {
          await supabase.from("agent_memories").insert({ user_id: userId, slug: weekSlug, title: `Weekly digest — ${isoWeek(now)}`, kind: "note", content: weekContent });
        }
        weekly = weekSlug;
      } catch (e) {
        console.error("weekly digest failed", e);
      }
    }

    const { data: allWeeks } = await supabase
      .from("agent_memories").select("id, slug").eq("user_id", userId).like("slug", "weekly-journal-%").order("slug", { ascending: false });
    const wkDel = (allWeeks ?? []).slice(8).map((w: any) => w.id);
    if (wkDel.length) await supabase.from("agent_memories").delete().in("id", wkDel);
  }

  return { user_id: userId, ok: true, slug, totals, weekly };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json(500, { error: "LOVABLE_API_KEY not configured" });

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    let body: any = {};
    try { body = await req.json(); } catch {}
    const force: boolean = !!body.force;

    let userIds: string[] = [];
    const authHeader = req.headers.get("Authorization") ?? "";
    if (body.only_user && authHeader) {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) userIds = [user.id];
    } else {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase.from("leads").select("user_id").gte("updated_at", since);
      const allIds = Array.from(new Set((data ?? []).map((r: any) => r.user_id))) as string[];
      const { filterActiveUsers } = await import("../_shared/active-user.ts");
      userIds = force ? allIds : await filterActiveUsers(supabase, allIds, 14);
    }

    const results = [];
    for (const uid of userIds) {
      try {
        results.push(await buildJournalForUser(supabase, LOVABLE_API_KEY, uid, force));
      } catch (e) {
        console.error("journal failed for", uid, e);
        results.push({ user_id: uid, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return json(200, { ok: true, processed: results.length, results });
  } catch (e) {
    console.error("daily-journal error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown" });
  }
});
