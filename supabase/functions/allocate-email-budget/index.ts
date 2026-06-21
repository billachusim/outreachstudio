// Decides today's 100-email split between outreach and job-hunt for each user.
// Called once per morning from `daily-briefing` (and on demand).
//
// Rule:
//   reserved_outreach = 60
//   reserved_jobhunt  = 25
//   flex              = 15
// Flex goes to whichever side has stronger signal today:
//   - outreach signal = max relevance_score on intel_items (kind != job_board) in last 24h
//   - jobhunt signal  = max score on job_posts created today
// If one side beats the other by >= 15: it gets the full 15 of flex.
// Otherwise flex is split 8 / 7 (outreach gets the extra).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const FLEX = 15;
const RESERVED_OUTREACH = 60;
const RESERVED_JOBHUNT = 25;

const json = (s: number, p: unknown) =>
  new Response(JSON.stringify(p), { status: s, headers: { "Content-Type": "application/json" } });

async function allocateForUser(supabase: any, userId: string) {
  const date = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

  // Outreach signal: top intel relevance in last 24h (excluding job_board sources)
  const { data: intel } = await supabase
    .from("intel_items")
    .select("relevance_score, intel_sources(kind)")
    .eq("user_id", userId)
    .gte("created_at", since)
    .limit(50);
  const outreachSignal = Math.max(
    0,
    ...((intel ?? []) as any[])
      .filter((r) => r?.intel_sources?.kind !== "job_board")
      .map((r) => Number(r.relevance_score) || 0),
  );

  // Job-hunt signal: top job_post score created today
  const { data: jobs } = await supabase
    .from("job_posts")
    .select("score")
    .eq("user_id", userId)
    .gte("created_at", startOfDay.toISOString())
    .order("score", { ascending: false })
    .limit(1);
  const jobhuntSignal = Math.max(0, ...((jobs ?? []) as any[]).map((r) => Number(r.score) || 0));

  let outreachFlex = 0;
  let jobhuntFlex = 0;
  let note: string;
  if (jobhuntSignal - outreachSignal >= 15) {
    jobhuntFlex = FLEX;
    note = `Job-hunt signal ${jobhuntSignal} beats outreach ${outreachSignal} — flex (${FLEX}) to job-hunt.`;
  } else if (outreachSignal - jobhuntSignal >= 15) {
    outreachFlex = FLEX;
    note = `Outreach signal ${outreachSignal} beats job-hunt ${jobhuntSignal} — flex (${FLEX}) to outreach.`;
  } else {
    outreachFlex = 8;
    jobhuntFlex = 7;
    note = `Signals close (outreach ${outreachSignal} vs job-hunt ${jobhuntSignal}) — flex split 8/7.`;
  }

  const outreachCap = RESERVED_OUTREACH + outreachFlex;
  const jobhuntCap = RESERVED_JOBHUNT + jobhuntFlex;

  // Don't clobber a manual override (user may have set notes='override' from chat).
  const { data: existing } = await supabase
    .from("email_budgets").select("id, notes")
    .eq("user_id", userId).eq("date", date).maybeSingle();
  if (existing?.notes === "override") return { user_id: userId, skipped: "override" };

  if (existing) {
    await supabase.from("email_budgets")
      .update({ outreach_cap: outreachCap, jobhunt_cap: jobhuntCap, notes: note })
      .eq("id", existing.id);
  } else {
    await supabase.from("email_budgets").insert({
      user_id: userId, date,
      outreach_cap: outreachCap, jobhunt_cap: jobhuntCap,
      outreach_sent: 0, jobhunt_sent: 0,
      notes: note,
    });
  }
  return { user_id: userId, outreach_cap: outreachCap, jobhunt_cap: jobhuntCap, note };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null);
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let onlyUser: string | undefined;
    try { const b = await req.json(); onlyUser = b?.user_id; } catch { /* no body */ }

    let userIds: string[];
    if (onlyUser) {
      userIds = [onlyUser];
    } else {
      const { data: rows } = await supabase.from("campaigns").select("user_id");
      userIds = Array.from(new Set((rows ?? []).map((r: any) => r.user_id)));
    }

    const results = [];
    for (const uid of userIds) {
      try { results.push(await allocateForUser(supabase, uid)); }
      catch (e) { results.push({ user_id: uid, error: e instanceof Error ? e.message : String(e) }); }
    }
    return json(200, { ok: true, count: results.length, results });
  } catch (e) {
    console.error("allocate-email-budget", e);
    return json(500, { error: e instanceof Error ? e.message : "error" });
  }
});
