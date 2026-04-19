import { supabase } from "@/integrations/supabase/client";

/** Queues a background outreach run for a campaign and immediately kicks the engine. */
export async function startOutreach(opts: {
  userId: string;
  campaignId: string;
  targetLeadCount?: number;
  dailySendCap?: number;
}) {
  const { data: run, error } = await supabase
    .from("campaign_runs")
    .insert({
      user_id: opts.userId,
      campaign_id: opts.campaignId,
      target_lead_count: opts.targetLeadCount ?? 20,
      daily_send_cap: opts.dailySendCap ?? 5,
      state: "queued",
    })
    .select("id")
    .single();
  if (error) throw error;

  // Immediate kick — don't wait
  supabase.functions.invoke("campaign-tick", { body: { runId: run.id } }).catch(() => {});
  return run.id as string;
}

/** Creates a campaign for a given offering, then starts outreach. */
export async function startOutreachFromOffering(opts: {
  userId: string;
  offeringId: string;
  offeringTitle: string;
}) {
  const { data: campaign, error: cerr } = await supabase
    .from("campaigns")
    .insert({
      user_id: opts.userId,
      offering_id: opts.offeringId,
      name: `Auto: ${opts.offeringTitle} — ${new Date().toLocaleDateString()}`,
      status: "active",
    })
    .select("id")
    .single();
  if (cerr) throw cerr;
  const runId = await startOutreach({ userId: opts.userId, campaignId: campaign.id });
  return { campaignId: campaign.id, runId };
}
