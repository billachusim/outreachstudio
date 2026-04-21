// Deletes intel items older than 14 days that are unactioned and have no
// linked lead or pitch. Runs daily via cron (service auth).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (s: number, p: unknown) =>
  new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error, count } = await supabase
      .from("intel_items")
      .delete({ count: "exact" })
      .lt("created_at", cutoff)
      .eq("acted_on", false)
      .is("linked_lead_id", null)
      .is("linked_pitch_id", null)
      .select("id");
    if (error) return json(500, { error: error.message });
    return json(200, { deleted: count ?? data?.length ?? 0 });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
});
