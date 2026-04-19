// Posts to a Facebook Page or comments on a post via Meta Graph API.
// credentials = { page_access_token, page_id }
// Use action: 'post' (default) to publish a feed post on the Page,
//   or action: 'comment' with objectId to comment on a post.

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
  message: string;
  link?: string;
  action?: "post" | "comment";
  objectId?: string; // post ID when commenting
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
    if (!b.message?.trim()) return json(400, { error: "message required" });
    const action = b.action ?? "post";
    if (action === "comment" && !b.objectId) return json(400, { error: "objectId required for comment" });

    const { data: accounts } = b.channelAccountId
      ? await supabase.from("channel_accounts").select("*").eq("id", b.channelAccountId).limit(1)
      : await supabase.from("channel_accounts").select("*")
          .eq("user_id", user.id).eq("channel", "facebook").eq("status", "active")
          .order("created_at", { ascending: true }).limit(1);
    const acct = accounts?.[0];
    if (!acct) return json(400, { error: "No active Facebook Page connected. Add one in Channels." });

    const creds = acct.credentials as { page_access_token?: string; page_id?: string };
    if (!creds.page_access_token || !creds.page_id) {
      return json(400, { error: "Facebook account missing page_access_token or page_id" });
    }

    const target = action === "comment" ? b.objectId : `${creds.page_id}/feed`;
    const url = `https://graph.facebook.com/v20.0/${target}/${action === "comment" ? "comments" : ""}`;

    const form = new URLSearchParams();
    form.set("message", b.message);
    if (b.link && action === "post") form.set("link", b.link);
    form.set("access_token", creds.page_access_token);

    const resp = await fetch(url, { method: "POST", body: form });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      await supabase.from("channel_messages").insert({
        user_id: user.id, channel_account_id: acct.id, lead_id: b.leadId ?? null, campaign_id: b.campaignId ?? null,
        channel: "facebook", direction: "outbound", body: b.message,
        status: "failed", error: JSON.stringify(data),
      });
      return json(resp.status, { error: data?.error?.message || `Facebook ${resp.status}`, details: data });
    }

    const providerId = data?.id ?? null;
    await supabase.from("channel_messages").insert({
      user_id: user.id, channel_account_id: acct.id, lead_id: b.leadId ?? null, campaign_id: b.campaignId ?? null,
      channel: "facebook", direction: "outbound", body: b.message,
      provider_message_id: providerId, status: "sent", payload: data,
    });

    return json(200, { ok: true, providerId, action });
  } catch (e) {
    console.error("post-facebook error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown" });
  }
});
