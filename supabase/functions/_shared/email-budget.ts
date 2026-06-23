// Shared helper for the daily Resend send budget.
//
// All 100/day go to outreach campaigns. Job-hunt sending is disabled
// (the user applies to jobs manually), so the jobhunt bucket exists in
// the schema but is hard-set to 0 and never spent.

export const GLOBAL_DAILY_CAP = 100;
export const DEFAULT_OUTREACH_CAP = 100;
export const DEFAULT_JOBHUNT_CAP = 0;

export type BudgetBucket = "outreach" | "jobhunt";

export interface BudgetRow {
  id: string;
  user_id: string;
  date: string;
  outreach_cap: number;
  jobhunt_cap: number;
  outreach_sent: number;
  jobhunt_sent: number;
}

export function todayUTCDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Get (or lazily create) today's budget row for a user. */
export async function ensureTodayBudget(supabase: any, userId: string): Promise<BudgetRow> {
  const date = todayUTCDate();
  const { data: existing } = await supabase
    .from("email_budgets")
    .select("*")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();
  if (existing) return existing as BudgetRow;

  const { data: created, error } = await supabase
    .from("email_budgets")
    .insert({
      user_id: userId,
      date,
      outreach_cap: DEFAULT_OUTREACH_CAP,
      jobhunt_cap: DEFAULT_JOBHUNT_CAP,
      outreach_sent: 0,
      jobhunt_sent: 0,
    })
    .select("*")
    .single();
  if (error) {
    const { data: again } = await supabase
      .from("email_budgets").select("*")
      .eq("user_id", userId).eq("date", date).maybeSingle();
    if (again) return again as BudgetRow;
    throw error;
  }
  return created as BudgetRow;
}

/** Count today's actually-sent pitches from the source of truth. */
export async function recountSentToday(
  supabase: any,
  userId: string,
): Promise<{ outreach_sent: number; jobhunt_sent: number; total: number }> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { data: rows } = await supabase
    .from("pitches")
    .select("id, leads!inner(campaign_id, campaigns!inner(mode))")
    .eq("user_id", userId)
    .gte("sent_at", startOfDay.toISOString());
  let outreach = 0, jobhunt = 0;
  for (const r of (rows ?? []) as any[]) {
    const mode = r.leads?.campaigns?.mode;
    if (mode === "job_hunt") jobhunt++;
    else outreach++;
  }
  return { outreach_sent: outreach, jobhunt_sent: jobhunt, total: outreach + jobhunt };
}

/**
 * Decide whether a campaign in the given mode may send right now.
 * - Job-hunt mode: always blocked (we don't auto-email for jobs).
 * - Outreach mode: enforces the single global 100/day cap.
 */
export async function checkBudget(
  supabase: any,
  userId: string,
  mode: "job_hunt" | "outreach",
): Promise<{ ok: true; remaining: number; cap: number } | { ok: false; reason: string; cap: number; sent: number }> {
  if (mode === "job_hunt") {
    return { ok: false, reason: "Job-hunt sending is disabled (apply manually)", cap: 0, sent: 0 };
  }
  const live = await recountSentToday(supabase, userId);
  if (live.outreach_sent >= GLOBAL_DAILY_CAP) {
    return {
      ok: false,
      reason: `Daily cap reached (${live.outreach_sent}/${GLOBAL_DAILY_CAP})`,
      cap: GLOBAL_DAILY_CAP,
      sent: live.outreach_sent,
    };
  }
  return { ok: true, remaining: GLOBAL_DAILY_CAP - live.outreach_sent, cap: GLOBAL_DAILY_CAP };
}
