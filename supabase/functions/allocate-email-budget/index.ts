// Sets today's email budget for each user to the new fixed policy:
//   outreach_cap = 100, jobhunt_cap = 0
// (Job-hunt sending is disabled — user applies manually.)
//
// Called once per morning from `daily-briefing` (and on demand).
// Respects manual overrides (rows where notes = 'override').

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const OUTREACH_CAP = 100;
const JOBHUNT_CAP = 0;

const json = (s: number, p: unknown) =>
  new Response(JSON.stringify(p), { status: s, headers: { "Content-Type": "application/json" } });

async function allocateForUser(supabase: any, userId: string) {
  const date = new Date().toISOString().slice(0, 10);
  const note = `Outreach gets the full ${OUTREACH_CAP}/day; job-hunt is manual (0).`;

  const { data: existing } = await supabase
    .from("email_budgets").select("id, notes")
    .eq("user_id", userId).eq("date", date).maybeSingle();
  if (existing?.notes === "override") return { user_id: userId, skipped: "override" };

  if (existing) {
    await supabase.from("email_budgets")
      .update({ outreach_cap: OUTREACH_CAP, jobhunt_cap: JOBHUNT_CAP, notes: note })
      .eq("id", existing.id);
  } else {
    await supabase.from("email_budgets").insert({
      user_id: userId, date,
      outreach_cap: OUTREACH_CAP, jobhunt_cap: JOBHUNT_CAP,
      outreach_sent: 0, jobhunt_sent: 0,
      notes: note,
    });
  }
  return { user_id: userId, outreach_cap: OUTREACH_CAP, jobhunt_cap: JOBHUNT_CAP, note };
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
