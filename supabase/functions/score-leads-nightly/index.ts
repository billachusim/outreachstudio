// Recompute leads.score for every lead. Cron-driven.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null);
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    // Use a single SQL via rpc-less approach: fetch ids in pages and update.
    let updated = 0;
    let from = 0;
    const pageSize = 500;
    while (true) {
      const { data: rows, error } = await supabase
        .from("leads").select("id").range(from, from + pageSize - 1);
      if (error) throw error;
      if (!rows || rows.length === 0) break;
      // Compute one-by-one via the SQL function
      for (const r of rows) {
        const { data: s } = await supabase.rpc("compute_lead_score", { _lead_id: r.id });
        if (typeof s === "number") {
          await supabase.from("leads").update({ score: s }).eq("id", r.id);
          updated++;
        }
      }
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    return new Response(JSON.stringify({ ok: true, updated }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("score-leads-nightly", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
