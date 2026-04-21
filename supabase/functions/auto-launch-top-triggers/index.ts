// Daily cron: for each user, auto-launch campaigns from their top 3 unacted intel items (last 24h, score >= 60).
// Uses the service-role key to iterate all users.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildProposal, runLaunch } from "../launch-campaign-from-intel/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const MIN_SCORE = 60;
const TOP_N = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Fetch candidate intel items across all users
    const { data: items, error } = await admin
      .from("intel_items")
      .select("id, user_id, title, summary, tags, source, relevance_score, created_at")
      .eq("acted_on", false)
      .is("spawned_campaign_id", null)
      .gte("created_at", since)
      .gte("relevance_score", MIN_SCORE)
      .order("relevance_score", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) return json(500, { error: error.message });

    // Group top N per user
    const perUser = new Map<string, typeof items>();
    for (const it of items ?? []) {
      const list = perUser.get(it.user_id) ?? [];
      if (list.length < TOP_N) {
        list.push(it);
        perUser.set(it.user_id, list);
      }
    }

    const results: Array<{ userId: string; intelId: string; status: string; error?: string; campaignId?: string }> = [];

    for (const [userId, userItems] of perUser) {
      for (const intel of userItems!) {
        try {
          const built = await buildProposal(admin, userId, {
            id: intel.id,
            title: intel.title,
            summary: intel.summary,
            tags: intel.tags,
            source: intel.source,
          });
          if (!built.ok) {
            results.push({ userId, intelId: intel.id, status: "skipped", error: built.error });
            continue;
          }

          const launched = await runLaunch(admin, userId, intel.id, built.proposal, intel.title, {
            autoFromIntel: true,
          });
          if (!launched.ok) {
            results.push({ userId, intelId: intel.id, status: "failed", error: launched.error });
            continue;
          }
          results.push({ userId, intelId: intel.id, status: "launched", campaignId: launched.campaignId });
        } catch (e) {
          results.push({ userId, intelId: intel.id, status: "error", error: (e as Error).message });
        }
      }
    }

    return json(200, {
      processed: results.length,
      launched: results.filter((r) => r.status === "launched").length,
      results,
    });
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
});
