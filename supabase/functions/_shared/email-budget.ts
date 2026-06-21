// Shared helper for the daily Resend send budget split between
// outreach campaigns (Tech Faculty / paid client work) and the
// job_hunt track (freelance applications).
//
// One `email_budgets` row per user per day. If a row is missing
// for today, we lazily insert defaults (60 outreach / 25 jobhunt).
//
// The hard global ceiling is 100/day (Resend free tier). Defaults
// reserve 60 + 25 = 85, leaving 15 of "flex" that `allocate-email-budget`
// distributes once per morning based on intel vs job_post scores.

export const GLOBAL_DAILY_CAP = 100;
export const DEFAULT_OUTREACH_CAP = 60;
export const DEFAULT_JOBHUNT_CAP = 25;

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
    // Race: another worker inserted it first — re-read.
    const { data: again } = await supabase
      .from("email_budgets").select("*")
      .eq("user_id", userId).eq("date", date).maybeSingle();
    if (again) return again as BudgetRow;
    throw error;
  }
  return created as BudgetRow;
}

/** Count today's actually-sent pitches per bucket from the source of truth. */
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
 * Returns reason string when blocked. Caps are read from email_budgets,
 * actual usage is the live count (so manual sends + agent sends both count).
 */
export async function checkBudget(
  supabase: any,
  userId: string,
  mode: "job_hunt" | "outreach",
): Promise<{ ok: true; remaining: number; cap: number } | { ok: false; reason: string; cap: number; sent: number }> {
  const budget = await ensureTodayBudget(supabase, userId);
  const live = await recountSentToday(supabase, userId);

  // Hard global ceiling regardless of split.
  if (live.total >= GLOBAL_DAILY_CAP) {
    return { ok: false, reason: `Global daily cap reached (${live.total}/${GLOBAL_DAILY_CAP})`, cap: GLOBAL_DAILY_CAP, sent: live.total };
  }

  const bucket: BudgetBucket = mode === "job_hunt" ? "jobhunt" : "outreach";
  const cap = bucket === "jobhunt" ? budget.jobhunt_cap : budget.outreach_cap;
  const sent = bucket === "jobhunt" ? live.jobhunt_sent : live.outreach_sent;

  if (sent >= cap) {
    return { ok: false, reason: `${bucket} daily cap reached (${sent}/${cap})`, cap, sent };
  }
  return { ok: true, remaining: cap - sent, cap };
}
