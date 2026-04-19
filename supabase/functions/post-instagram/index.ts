// Posts an image+caption to an Instagram Business account via Meta Graph API.
// Two-step: create media container, then publish.
// credentials = { page_access_token, ig_user_id }

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
  caption: string;
  imageUrl: string; // public URL
  channelAccountId?: string;
  leadId?: string;
  campaignId?: string;
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
    if (!b.caption?.trim() || !b.imageUrl?.trim()) return json(400, { error: "caption and imageUrl required" });

    const { data: accounts } = b.channelAccountId
      ? await supabase.from("channel_accounts").select("*").eq("id", b.channelAccountId).limit(1)
      : await supabase.from("channel_accounts").select("*")
          .eq("user_id", user.id).eq("channel", "instagram").eq("status", "active")
          .order("created_at", { ascending: true }).limit(1);
    const acct = accounts?.[0];
    if (!acct) return json(400, { error: "No active Instagram account connected. Add one in Channels." });

    const creds = acct.credentials as { page_access_token?: string; ig_user_id?: string };
    if (!creds.page_access_token || !creds.ig_user_id) {
      return json(400, { error: "Instagram account missing page_access_token or ig_user_id" });
    }

    // 1. Create media container
    const containerForm = new URLSearchParams({
      image_url: b.imageUrl, caption: b.caption, access_token: creds.page_access_token,
    });
    const cr = await fetch(`https://graph.facebook.com/v20.0/${creds.ig_user_id}/media`, {
      method: "POST", body: containerForm,
    });
    const cd = await cr.json().catch(() => ({}));
    if (!cr.ok || !cd.id) return json(cr.status, { error: cd?.error?.message || "Failed to create media", details: cd });

    // 2. Publish
    const pubForm = new URLSearchParams({ creation_id: cd.id, access_token: creds.page_access_token });
    const pr = await fetch(`https://graph.facebook.com/v20.0/${creds.ig_user_id}/media_publish`, {
      method: "POST", body: pubForm,
    });
    const pd = await pr.json().catch(() => ({}));
    if (!pr.ok) {
      await supabase.from("channel_messages").insert({
        user_id: user.id, channel_account_id: acct.id, lead_id: b.leadId ?? null, campaign_id: b.campaignId ?? null,
        channel: "instagram", direction: "outbound", body: b.caption,
        status: "failed", error: JSON.stringify(pd),
      });
      return json(pr.status, { error: pd?.error?.message || `Instagram ${pr.status}`, details: pd });
    }

    await supabase.from("channel_messages").insert({
      user_id: user.id, channel_account_id: acct.id, lead_id: b.leadId ?? null, campaign_id: b.campaignId ?? null,
      channel: "instagram", direction: "outbound", body: b.caption,
      provider_message_id: pd.id, status: "sent", payload: pd,
    });
    return json(200, { ok: true, providerId: pd.id });
  } catch (e) {
    console.error("post-instagram error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown" });
  }
});
