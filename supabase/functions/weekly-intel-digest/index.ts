// Weekly digest: emails each user a summary of last 7 days of intel —
// what was scored high, what was acted on (pitches/leads), what's still unactioned.
// Sent via Resend through the connector gateway.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (s: number, p: unknown) =>
  new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const GATEWAY = "https://connector-gateway.lovable.dev/resend";

async function sendEmail(to: string, subject: string, html: string, lovableKey: string, resendKey: string) {
  const res = await fetch(`${GATEWAY}/emails`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": resendKey,
    },
    body: JSON.stringify({
      from: "Outreach Studio <onboarding@resend.dev>",
      to: [to],
      subject,
      html,
    }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!LOVABLE_API_KEY) return json(500, { error: "LOVABLE_API_KEY missing" });
    if (!RESEND_API_KEY) return json(500, { error: "RESEND_API_KEY missing" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: users } = await supabase.auth.admin.listUsers();
    const userList = users?.users ?? [];

    let sent = 0;
    for (const u of userList) {
      if (!u.email) continue;
      const { data: items } = await supabase
        .from("intel_items").select("title, url, source, relevance_score, acted_on, linked_lead_id, linked_pitch_id, created_at")
        .eq("user_id", u.id).gte("created_at", since)
        .order("relevance_score", { ascending: false }).limit(50);
      if (!items || items.length === 0) continue;

      const acted = items.filter((i: any) => i.acted_on || i.linked_lead_id || i.linked_pitch_id);
      const top = items.slice(0, 5);
      const unactioned = items.filter((i: any) => !i.acted_on && !i.linked_lead_id && !i.linked_pitch_id).slice(0, 5);

      const li = (i: any) =>
        `<li><strong>[${i.relevance_score ?? 0}]</strong> <a href="${i.url ?? "#"}">${i.title}</a> <em style="color:#888">— ${i.source}</em></li>`;

      const html = `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:auto;color:#222">
<h2>Your week in Intel</h2>
<p>${items.length} stories scanned · ${acted.length} acted on · ${unactioned.length} still unactioned.</p>

<h3 style="margin-top:24px">🔥 Top 5 stories</h3>
<ul>${top.map(li).join("")}</ul>

${unactioned.length > 0 ? `
<h3 style="margin-top:24px">⏰ Still unactioned</h3>
<ul>${unactioned.map(li).join("")}</ul>
<p><a href="https://outreachstudio.lovable.app/intel">Open Intel →</a></p>
` : ""}

<hr style="border:0;border-top:1px solid #eee;margin:24px 0">
<p style="font-size:12px;color:#888">You're receiving this because you have intel items in Outreach Studio.</p>
</div>`;

      const r = await sendEmail(u.email, `Intel digest · ${items.length} stories this week`, html, LOVABLE_API_KEY, RESEND_API_KEY);
      if (r.ok) sent++;
      else console.error("digest email failed", u.email, r.status, r.body);
    }

    return json(200, { sent });
  } catch (e) {
    console.error("weekly-intel-digest error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
});
