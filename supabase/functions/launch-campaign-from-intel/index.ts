// HTTP entrypoint for launching an outreach campaign from a single intel story (manual button).
// Shared helpers live in `../_shared/launch.ts` and are also used by the daily cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildProposal, runLaunch, Proposal } from "../_shared/launch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth) return json(401, { error: "Missing Authorization" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) return json(401, { error: "Unauthorized" });
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const { intelItemId, dryRun = false, proposal: clientProposal } = body as {
      intelItemId?: string;
      dryRun?: boolean;
      proposal?: Proposal;
    };

    if (!intelItemId) return json(400, { error: "intelItemId required" });

    const { data: intel, error: intelErr } = await supabase
      .from("intel_items")
      .select("id, title, summary, tags, source, url, matched_offerings")
      .eq("id", intelItemId)
      .maybeSingle();
    if (intelErr || !intel) return json(404, { error: "Intel not found" });

    let proposal: Proposal;

    if (clientProposal && !dryRun) {
      proposal = clientProposal;
    } else {
      const built = await buildProposal(supabase, userId, intel);
      if (!built.ok) return json(built.status, { error: built.error });
      proposal = built.proposal;
    }

    if (dryRun) {
      return json(200, { proposal });
    }

    const result = await runLaunch(supabase, userId, intelItemId, proposal, intel.title);
    if (!result.ok) return json(result.status, { error: result.error });

    return json(200, {
      campaignId: result.campaignId,
      runId: result.runId,
      offeringId: result.offeringId,
      offeringCreated: result.offeringCreated,
    });
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
});
