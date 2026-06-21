// Posts a tweet to X using the user's connected X account credentials.
// Stores OAuth1 user-context creds in channel_accounts.credentials.
// credentials = { consumer_key, consumer_secret, access_token, access_token_secret }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createHmac } from "node:crypto";

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
  text: string;
  channelAccountId?: string;
  inReplyToTweetId?: string;
  leadId?: string;
  campaignId?: string;
}

function pctEncode(s: string) {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function buildOAuth1Header(method: string, url: string, params: Record<string, string>, creds: {
  consumer_key: string; consumer_secret: string; access_token: string; access_token_secret: string;
}) {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.consumer_key,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.access_token,
    oauth_version: "1.0",
  };
  const all = { ...oauth, ...params };
  const baseStr = Object.keys(all).sort()
    .map((k) => `${pctEncode(k)}=${pctEncode(all[k])}`).join("&");
  const sigBase = `${method.toUpperCase()}&${pctEncode(url)}&${pctEncode(baseStr)}`;
  const signingKey = `${pctEncode(creds.consumer_secret)}&${pctEncode(creds.access_token_secret)}`;
  const signature = createHmac("sha1", signingKey).update(sigBase).digest("base64");
  oauth.oauth_signature = signature;
  return "OAuth " + Object.keys(oauth).sort()
    .map((k) => `${pctEncode(k)}="${pctEncode(oauth[k])}"`).join(", ");
}

function getXErrorMessage(data: Record<string, unknown>, status: number) {
  const details = data?.details as Record<string, unknown> | undefined;
  const reason = details?.reason ?? data?.reason;
  if (status === 403 && reason === "client-not-enrolled") {
    return "Your X app is still a standalone app. In the X Developer Portal, create or open a Project, attach this app to it, then regenerate the Access Token + Secret and reconnect X in Channels.";
  }
  if (status === 403) {
    return "X rejected the post. Check that your app is attached to a Project, has Read and Write permissions, and that you regenerated the Access Token + Secret after changing permissions.";
  }
  return String(data?.detail || data?.title || `X API ${status}`);
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
    if (!b.text?.trim()) return json(400, { error: "text required" });
    if (b.text.length > 280) return json(400, { error: "Tweet exceeds 280 chars" });

    const { data: accounts } = b.channelAccountId
      ? await supabase.from("channel_accounts").select("*").eq("id", b.channelAccountId).limit(1)
      : await supabase.from("channel_accounts").select("*")
          .eq("user_id", user.id).eq("channel", "x").eq("status", "active")
          .order("created_at", { ascending: true }).limit(1);
    const acct = accounts?.[0];
    if (!acct) return json(400, { error: "No active X account connected. Add one in Channels." });

    const creds = acct.credentials as Record<string, string>;
    for (const k of ["consumer_key","consumer_secret","access_token","access_token_secret"]) {
      if (!creds[k]) return json(400, { error: `X account missing ${k}` });
    }

    const url = "https://api.x.com/2/tweets";
    const oauthHeader = buildOAuth1Header("POST", url, {}, creds as never);

    const payload: Record<string, unknown> = { text: b.text };
    if (b.inReplyToTweetId) payload.reply = { in_reply_to_tweet_id: b.inReplyToTweetId };

    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: oauthHeader, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const message = getXErrorMessage(data as Record<string, unknown>, resp.status);
      await supabase.from("channel_messages").insert({
        user_id: user.id, channel_account_id: acct.id, lead_id: b.leadId ?? null, campaign_id: b.campaignId ?? null,
        channel: "x", direction: "outbound", body: b.text, status: "failed", error: message,
      });
      return json(200, { ok: false, error: message, details: data, upstreamStatus: resp.status });
    }

    const providerId = data?.data?.id ?? null;
    await supabase.from("channel_messages").insert({
      user_id: user.id, channel_account_id: acct.id, lead_id: b.leadId ?? null, campaign_id: b.campaignId ?? null,
      channel: "x", direction: "outbound", body: b.text,
      provider_message_id: providerId, status: "sent", payload: data,
    });

    return json(200, { ok: true, providerId, url: providerId ? `https://x.com/${acct.display_name}/status/${providerId}` : null });
  } catch (e) {
    console.error("post-x error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown" });
  }
});
