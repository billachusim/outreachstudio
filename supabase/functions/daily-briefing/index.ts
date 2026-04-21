// Generate one daily_briefings row per user with metrics + AI-written summary.
// Cron at 08:00 WAT. Idempotent per user/date unless `force: true` is passed.

import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const json = (s: number, p: unknown) =>
  new Response(JSON.stringify(p), { status: s, headers: { "Content-Type": "application/json" } });

async function runBriefingJob(supabase: any, LOVABLE_API_KEY: string, force: boolean) {
  try {
    const { data: users } = await supabase.from("campaigns").select("user_id");
    const userIds = Array.from(new Set((users ?? []).map((u: any) => u.user_id)));
    const today = new Date().toISOString().slice(0, 10);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    let made = 0;
    for (const userId of userIds) {
      if (!force) {
        const { data: existing } = await supabase
          .from("daily_briefings").select("id").eq("user_id", userId).eq("briefing_date", today).maybeSingle();
        if (existing) continue;
      }

      const [pitchesRes, eventsRes, runsRes, warmRes, intelRes] = await Promise.all([
        supabase.from("pitches").select("id, sent_at").eq("user_id", userId).gte("sent_at", since),
        supabase.from("pitch_events").select("event_type").eq("user_id", userId).gte("occurred_at", since),
        supabase.from("campaign_runs").select("state, leads_sent").eq("user_id", userId).gte("updated_at", since),
        supabase.from("leads").select("id, business_name, score, status").eq("user_id", userId).order("score", { ascending: false }).limit(5),
        supabase.from("intel_items").select("title, source, url, relevance_score, tags, summary")
          .eq("user_id", userId).eq("acted_on", false)
          .gte("created_at", since).order("relevance_score", { ascending: false }).limit(5),
      ]);

      const sent = pitchesRes.data?.length ?? 0;
      const opens = (eventsRes.data ?? []).filter((e: any) => e.event_type === "opened").length;
      const replies = (eventsRes.data ?? []).filter((e: any) => e.event_type === "replied").length;
      const bounces = (eventsRes.data ?? []).filter((e: any) => e.event_type === "bounced").length;
      const activeRuns = (runsRes.data ?? []).filter((r: any) => !["done", "failed"].includes(r.state)).length;
      const intelItems = intelRes.data ?? [];
      const metrics = { sent, opens, replies, bounces, active_runs: activeRuns, intel_count: intelItems.length };

      const ai = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [
            { role: "system", content: "You are the morning briefing voice for an outreach studio. 4–6 short bullets, plain English, no fluff. Highlight wins, blockers, warm leads, and 1–3 fresh news triggers worth pitching off (with the headline + source). Suggest concrete next actions." },
            { role: "user", content: `Last 24h metrics: ${JSON.stringify(metrics)}\nTop leads by score: ${JSON.stringify(warmRes.data ?? [])}\nFresh intel (rank top 3 by relevance):\n${JSON.stringify(intelItems)}\nWrite the morning briefing.` },
          ],
        }),
      });
      let bodyMd = "";
      if (ai.ok) {
        const aj = await ai.json();
        bodyMd = aj?.choices?.[0]?.message?.content ?? "";
      }
      if (!bodyMd) {
        const intelLines = intelItems.slice(0, 3).map((i: any) => `  - [${i.source}] ${i.title}`).join("\n");
        bodyMd = `**Morning brief**\n\n- Sent: ${sent}\n- Opens: ${opens}\n- Replies: ${replies}\n- Bounces: ${bounces}\n- Active runs: ${activeRuns}${intelItems.length ? `\n- Fresh intel (${intelItems.length}):\n${intelLines}` : ""}`;
      }

      if (force) {
        await supabase.from("daily_briefings")
          .delete().eq("user_id", userId).eq("briefing_date", today);
      }
      await supabase.from("daily_briefings").insert({
        user_id: userId, briefing_date: today, body: bodyMd, metrics,
      });
      made++;
    }
    console.log(`daily-briefing: made ${made}`);
  } catch (e) {
    console.error("daily-briefing job error", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null);
  let force = false;
  try { const b = await req.json(); force = !!b?.force; } catch { /* no body */ }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
  // @ts-ignore EdgeRuntime is provided by Supabase
  EdgeRuntime.waitUntil(runBriefingJob(supabase, LOVABLE_API_KEY, force));
  return json(202, { ok: true, status: "briefing started in background" });
});
