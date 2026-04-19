// Sends a WhatsApp message via Meta Cloud API (Graph v20).
// Requires a connected channel_account with credentials = { access_token, phone_number_id }.
// Logs every send into channel_messages.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface Body {
  leadId?: string;
  to?: string; // E.164, e.g. +2348012345678
  body: string;
  templateName?: string; // if provided, sends a template instead of free-form text
  templateLang?: string; // default 'en_US'
  channelAccountId?: string;
  campaignId?: string;
}

function normalizePhone(p: string): string {
  return p.replace(/[^\d+]/g, "").replace(/^\+/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Missing Authorization header" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: uerr } = await supabase.auth.getUser();
    if (uerr || !user) return json(401, { error: "Unauthorized" });

    const b = (await req.json()) as Body;
    if (!b.body?.trim()) return json(400, { error: "body required" });

    // Resolve recipient: explicit `to` or pull from lead
    let toRaw = b.to ?? "";
    let leadId = b.leadId ?? null;
    if (!toRaw && leadId) {
      const { data: lead } = await supabase
        .from("leads").select("phone").eq("id", leadId).maybeSingle();
      if (!lead?.phone) return json(400, { error: "Lead has no phone" });
      toRaw = lead.phone;
    }
    if (!toRaw) return json(400, { error: "to or leadId required" });
    const to = normalizePhone(toRaw);

    // Resolve channel account
    const acctQuery = supabase
      .from("channel_accounts")
      .select("id, credentials, display_name")
      .eq("user_id", user.id).eq("channel", "whatsapp").eq("status", "active")
      .order("created_at", { ascending: true }).limit(1);
    const { data: accounts } = b.channelAccountId
      ? await supabase.from("channel_accounts").select("id, credentials, display_name").eq("id", b.channelAccountId).limit(1)
      : await acctQuery;
    const acct = accounts?.[0];
    if (!acct) return json(400, { error: "No active WhatsApp account connected. Add one in Channels." });

    const creds = acct.credentials as { access_token?: string; phone_number_id?: string };
    if (!creds.access_token || !creds.phone_number_id) {
      return json(400, { error: "WhatsApp account missing access_token or phone_number_id" });
    }

    // Build payload — template vs text
    const payload: Record<string, unknown> = {
      messaging_product: "whatsapp",
      to,
      ...(b.templateName
        ? {
            type: "template",
            template: {
              name: b.templateName,
              language: { code: b.templateLang ?? "en_US" },
              components: [{ type: "body", parameters: [{ type: "text", text: b.body }] }],
            },
          }
        : { type: "text", text: { preview_url: false, body: b.body } }),
    };

    const resp = await fetch(
      `https://graph.facebook.com/v20.0/${creds.phone_number_id}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      await supabase.from("channel_messages").insert({
        user_id: user.id, channel_account_id: acct.id, lead_id: leadId, campaign_id: b.campaignId ?? null,
        channel: "whatsapp", direction: "outbound", to_address: to, body: b.body,
        status: "failed", error: JSON.stringify(data), payload,
      });
      return json(resp.status, { error: data?.error?.message || `WhatsApp API ${resp.status}`, details: data });
    }

    const providerId = data?.messages?.[0]?.id ?? null;
    await supabase.from("channel_messages").insert({
      user_id: user.id, channel_account_id: acct.id, lead_id: leadId, campaign_id: b.campaignId ?? null,
      channel: "whatsapp", direction: "outbound", to_address: to, body: b.body,
      provider_message_id: providerId, status: "sent", payload,
    });
    if (leadId) await supabase.from("leads").update({ status: "sent" }).eq("id", leadId);

    return json(200, { ok: true, providerId, to });
  } catch (e) {
    console.error("send-whatsapp error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown" });
  }
});
